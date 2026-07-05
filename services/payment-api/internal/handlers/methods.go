package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/models"
)

type MethodHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

// PublicList — returns enabled methods only, with server-side secrets
// stripped. Used by the portal pay flow to render the method picker.
func (h *MethodHandler) PublicList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.DB.Query(ctx, `
		SELECT method, enabled, mode, display_name_en, display_name_th,
		       instructions_en, instructions_th, config, sort_order, updated_at
		  FROM payment_methods_config
		 WHERE enabled = true
		 ORDER BY sort_order, method`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []models.PaymentMethodConfig{}
	for rows.Next() {
		var m models.PaymentMethodConfig
		if err := rows.Scan(&m.Method, &m.Enabled, &m.Mode, &m.DisplayNameEN, &m.DisplayNameTH,
			&m.InstructionsEN, &m.InstructionsTH, &m.Config, &m.SortOrder, &m.UpdatedAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		// Redact server-only fields per method
		var cfg map[string]any
		_ = json.Unmarshal(m.Config, &cfg)
		cfg = redactPublic(m.Method, cfg)
		m.Config, _ = json.Marshal(cfg)
		out = append(out, m)
	}
	writeJSON(w, 200, out)
}

// AdminList — all methods. For paypal, client_secret is replaced with
// client_secret_set: bool so the admin UI can show whether a secret is
// configured without ever transmitting the value back to the browser.
func (h *MethodHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := h.DB.Query(ctx, `
		SELECT method, enabled, mode, display_name_en, display_name_th,
		       instructions_en, instructions_th, config, sort_order, updated_at
		  FROM payment_methods_config
		 ORDER BY sort_order, method`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []models.PaymentMethodConfig{}
	for rows.Next() {
		var m models.PaymentMethodConfig
		if err := rows.Scan(&m.Method, &m.Enabled, &m.Mode, &m.DisplayNameEN, &m.DisplayNameTH,
			&m.InstructionsEN, &m.InstructionsTH, &m.Config, &m.SortOrder, &m.UpdatedAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		var cfg map[string]any
		_ = json.Unmarshal(m.Config, &cfg)
		cfg = redactAdmin(m.Method, cfg)
		m.Config, _ = json.Marshal(cfg)
		out = append(out, m)
	}
	writeJSON(w, 200, out)
}

type adminUpdateMethodReq struct {
	Enabled        *bool           `json:"enabled"`
	Mode           *string         `json:"mode"`
	DisplayNameEN  *string         `json:"display_name_en"`
	DisplayNameTH  *string         `json:"display_name_th"`
	InstructionsEN *string         `json:"instructions_en"`
	InstructionsTH *string         `json:"instructions_th"`
	Config         json.RawMessage `json:"config"`
	SortOrder      *int            `json:"sort_order"`
}

func (h *MethodHandler) AdminUpdate(w http.ResponseWriter, r *http.Request) {
	method := chi.URLParam(r, "method")
	if !validMethod(method) {
		writeErr(w, 400, "invalid method")
		return
	}
	var req adminUpdateMethodReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.Mode != nil && *req.Mode != "sandbox" && *req.Mode != "production" {
		writeErr(w, 400, "mode must be 'sandbox' or 'production'")
		return
	}
	uid := userID(r)
	var actor any
	if uid != "" {
		actor = uid
	}

	ctx, cancel := makeCtx()
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// Capture previous mode + config so we can audit + smart-merge.
	var prevMode string
	var prevCfg json.RawMessage
	_ = tx.QueryRow(ctx,
		`SELECT mode, config FROM payment_methods_config WHERE method=$1 FOR UPDATE`, method).
		Scan(&prevMode, &prevCfg)

	// Merge incoming config into the previous one so admins can update
	// e.g. just sandbox.client_id without zeroing the live credentials,
	// and an omitted/empty client_secret preserves the existing value
	// (the GET endpoint never returns it back, so the form can only send
	// "" → meaning leave alone).
	mergedCfg := mergeConfig(method, prevCfg, req.Config)

	tag, err := tx.Exec(ctx, `
		UPDATE payment_methods_config
		   SET enabled         = COALESCE($1, enabled),
		       mode            = COALESCE($2, mode),
		       display_name_en = COALESCE($3, display_name_en),
		       display_name_th = COALESCE($4, display_name_th),
		       instructions_en = COALESCE($5, instructions_en),
		       instructions_th = COALESCE($6, instructions_th),
		       config          = COALESCE($7::jsonb, config),
		       sort_order      = COALESCE($8, sort_order),
		       updated_by      = $9
		 WHERE method=$10`,
		req.Enabled, req.Mode, req.DisplayNameEN, req.DisplayNameTH,
		req.InstructionsEN, req.InstructionsTH,
		mergedCfg, req.SortOrder, actor, method)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "method not found")
		return
	}

	if req.Mode != nil && prevMode != "" && prevMode != *req.Mode {
		changes, _ := json.Marshal(map[string]any{"from": prevMode, "to": *req.Mode})
		_, _ = tx.Exec(ctx, `
			INSERT INTO audit_log (resource_type, resource_id, actor_id, action, changes)
			VALUES ('payment_method_mode', $1, $2, 'change_mode', $3::jsonb)`,
			method, actor, string(changes))
	}
	// Credential rotation audit. We never write the values themselves
	// to the log — only a fingerprint listing which fields changed.
	if method == "paypal" && len(req.Config) > 0 {
		if fields := paypalChangedFields(prevCfg, req.Config); len(fields) > 0 {
			changes, _ := json.Marshal(map[string]any{"fields": fields})
			_, _ = tx.Exec(ctx, `
				INSERT INTO audit_log (resource_type, resource_id, actor_id, action, changes)
				VALUES ('payment_method_credentials', $1, $2, 'rotate', $3::jsonb)`,
				method, actor, string(changes))
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	invalidateMethodModeCache()
	if method == "paypal" {
		invalidatePayPalCredsCache()
	}
	writeJSON(w, 200, map[string]string{"status": "updated"})
}

func redactPublic(method string, cfg map[string]any) map[string]any {
	if cfg == nil {
		return nil
	}
	if method != "paypal" {
		out := make(map[string]any, len(cfg))
		for k, v := range cfg {
			out[k] = v
		}
		return out
	}
	// Public view of paypal — return ONLY the active mode's public
	// client_id (the value PayPal JS SDK needs). Everything else stays
	// server-side.
	out := map[string]any{}
	for _, env := range []string{"sandbox", "live"} {
		if env == "live" {
			continue
		}
		if sub, ok := cfg[env].(map[string]any); ok {
			out[env] = map[string]any{"client_id": sub["client_id"]}
		}
	}
	return out
}

// redactAdmin scrubs server-only secrets before the admin GET response.
// For paypal we strip client_secret and replace it with client_secret_set
// so the form can show a "•••• already set" indicator without ever
// transmitting the value back to the browser.
func redactAdmin(method string, cfg map[string]any) map[string]any {
	if cfg == nil {
		return nil
	}
	out := make(map[string]any, len(cfg))
	for k, v := range cfg {
		out[k] = v
	}
	if method != "paypal" {
		return out
	}
	for _, env := range []string{"sandbox", "live"} {
		sub, ok := out[env].(map[string]any)
		if !ok {
			continue
		}
		copy := make(map[string]any, len(sub))
		for k, v := range sub {
			copy[k] = v
		}
		secret, _ := copy["client_secret"].(string)
		copy["client_secret_set"] = secret != ""
		delete(copy, "client_secret")
		out[env] = copy
	}
	return out
}

// mergeConfig produces the new config JSON for an UPDATE. Behaviour:
//   - If the incoming raw is empty, returns nil (caller's COALESCE keeps
//     the previous value).
//   - For paypal, deep-merges per environment (sandbox/live) and treats
//     an empty client_secret in the request as "keep the existing one".
//   - For every other method, shallow-merges top-level keys (preserves
//     fields not present in the request).
func mergeConfig(method string, prev, incoming json.RawMessage) any {
	if len(incoming) == 0 {
		return nil
	}
	var incomingMap map[string]any
	if err := json.Unmarshal(incoming, &incomingMap); err != nil {
		// Malformed — fall through to the raw replacement so Postgres
		// surfaces the error rather than silently swallowing it.
		return string(incoming)
	}
	var prevMap map[string]any
	if len(prev) > 0 {
		_ = json.Unmarshal(prev, &prevMap)
	}
	if prevMap == nil {
		prevMap = map[string]any{}
	}

	switch method {
	case "paypal":
		for _, env := range []string{"sandbox", "live"} {
			incSub, ok := incomingMap[env].(map[string]any)
			if !ok {
				continue
			}
			prevSub, _ := prevMap[env].(map[string]any)
			if prevSub == nil {
				prevSub = map[string]any{}
			}
			for k, v := range incSub {
				if k == "client_secret" {
					if s, _ := v.(string); s == "" {
						continue // preserve existing
					}
				}
				prevSub[k] = v
			}
			prevMap[env] = prevSub
		}
	default:
		for k, v := range incomingMap {
			prevMap[k] = v
		}
	}

	raw, _ := json.Marshal(prevMap)
	return string(raw)
}

// paypalChangedFields returns the dotted list of paypal credential
// fields that the incoming patch actually modifies. Used purely for the
// audit_log entry — never includes secret values.
func paypalChangedFields(prev, incoming json.RawMessage) []string {
	if len(incoming) == 0 {
		return nil
	}
	var inc, p map[string]any
	_ = json.Unmarshal(incoming, &inc)
	_ = json.Unmarshal(prev, &p)
	if inc == nil {
		return nil
	}
	if p == nil {
		p = map[string]any{}
	}
	out := []string{}
	for _, env := range []string{"sandbox", "live"} {
		incSub, ok := inc[env].(map[string]any)
		if !ok {
			continue
		}
		prevSub, _ := p[env].(map[string]any)
		if prevSub == nil {
			prevSub = map[string]any{}
		}
		for k, v := range incSub {
			if k == "client_secret" {
				if s, _ := v.(string); s == "" {
					continue
				}
				out = append(out, env+".client_secret")
				continue
			}
			if fmt.Sprint(prevSub[k]) != fmt.Sprint(v) {
				out = append(out, env+"."+k)
			}
		}
	}
	return out
}
