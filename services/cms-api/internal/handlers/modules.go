package handlers

// modules.go — module-toggle endpoints powering the per-section on/off system.
//
// Routes:
//   GET   /api/cms/modules                       — public, returns enabled map
//   GET   /api/cms/admin/modules                 — admin/editor, returns full rows
//   PATCH /api/cms/admin/modules/{key}           — admin-only, toggles enabled
//
// Toggle rules enforced here:
//   • role 'editor' can read but not toggle
//   • modules with core=true cannot be disabled (409 Conflict)
//   • every PATCH writes an audit_log row (resource_type='module')

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// Module keys are namespaced like 'public.blog' / 'admin.dsr' / 'api.consent'.
// The area prefix matches the modules.area column.
var moduleKeyRE = regexp.MustCompile(`^(public|portal|admin|api)\.[a-z][a-z0-9_]*$`)

// publicModule is the slim shape returned to anonymous callers — only what
// frontends need to decide whether to render a section.
type publicModule struct {
	Key     string `json:"key"`
	Enabled bool   `json:"enabled"`
}

// adminModule includes the operator-facing fields (name, description, core)
// so the admin UI can render a labelled toggle list.
type adminModule struct {
	Key         string  `json:"key"`
	Area        string  `json:"area"`
	NameEN      string  `json:"name_en"`
	NameTH      string  `json:"name_th"`
	Description *string `json:"description,omitempty"`
	Enabled     bool    `json:"enabled"`
	Core        bool    `json:"core"`
	SortOrder   int     `json:"sort_order"`
	UpdatedAt   string  `json:"updated_at"`
	UpdatedBy   *string `json:"updated_by,omitempty"`
}

// ListModules — public. Returns the minimal {key, enabled} pairs the frontend
// needs at render time. No auth, no cache header (Phase 3 will add per-request
// React.cache; revisit edge caching once measured).
func (h *CMSHandler) ListModules(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(),
		`SELECT key, enabled FROM modules ORDER BY area, sort_order`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []publicModule{}
	for rows.Next() {
		var m publicModule
		if err := rows.Scan(&m.Key, &m.Enabled); err != nil {
			continue
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, out)
}

// AdminListModules — admin or editor. Full rows for the toggle UI.
func (h *CMSHandler) AdminListModules(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT key, area, name_en, name_th, description, enabled, core, sort_order,
		       updated_at::text, updated_by::text
		FROM modules
		ORDER BY area, sort_order`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []adminModule{}
	for rows.Next() {
		var m adminModule
		if err := rows.Scan(
			&m.Key, &m.Area, &m.NameEN, &m.NameTH, &m.Description,
			&m.Enabled, &m.Core, &m.SortOrder, &m.UpdatedAt, &m.UpdatedBy,
		); err != nil {
			continue
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, out)
}

type toggleReq struct {
	Enabled *bool `json:"enabled"` // nil = no-op; only PATCH-able field
}

// AdminToggleModule — admin-only. Editors are forbidden from toggling so the
// operational control plane stays narrow. Writes the change atomically with an
// audit_log row (resource_type='module').
func (h *CMSHandler) AdminToggleModule(w http.ResponseWriter, r *http.Request) {
	role, _ := r.Context().Value(CtxRole).(string)
	if role != "admin" {
		writeErr(w, http.StatusForbidden, "admin required to toggle modules")
		return
	}

	key := strings.TrimSpace(chi.URLParam(r, "key"))
	if !moduleKeyRE.MatchString(key) {
		writeErr(w, http.StatusBadRequest, "invalid module key")
		return
	}

	var req toggleReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Enabled == nil {
		writeErr(w, http.StatusBadRequest, "enabled field required")
		return
	}

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Read current state for the audit diff and the core check.
	var (
		beforeEnabled, core bool
	)
	err = tx.QueryRow(ctx, `SELECT enabled, core FROM modules WHERE key = $1`, key).
		Scan(&beforeEnabled, &core)
	if err != nil {
		writeErr(w, http.StatusNotFound, "module not found")
		return
	}

	// Refuse to disable core modules; allow enabling a core module (no-op
	// from a semantics standpoint but harmless to record).
	if core && !*req.Enabled {
		writeErr(w, http.StatusConflict, "module is core and cannot be disabled")
		return
	}

	// No-op short-circuit: don't write an audit row if nothing changes.
	if beforeEnabled == *req.Enabled {
		_ = tx.Rollback(ctx)
		h.writeSingleModule(w, r, key)
		return
	}

	actorID, _ := ctx.Value(CtxUserID).(string)

	if _, err := tx.Exec(ctx, `
		UPDATE modules
		   SET enabled    = $2,
		       updated_by = NULLIF($3,'')::uuid,
		       updated_at = NOW()
		 WHERE key = $1`,
		key, *req.Enabled, actorID,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}

	if err := writeAudit(ctx, tx, "module", key, actorID, "toggle", map[string]any{
		"enabled": map[string]any{"from": beforeEnabled, "to": *req.Enabled},
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit failed")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}

	h.writeSingleModule(w, r, key)
}

// writeSingleModule fetches and returns one full module row. Used after PATCH
// so the client gets the post-mutation state in the same response.
func (h *CMSHandler) writeSingleModule(w http.ResponseWriter, r *http.Request, key string) {
	var m adminModule
	err := h.DB.QueryRow(r.Context(), `
		SELECT key, area, name_en, name_th, description, enabled, core, sort_order,
		       updated_at::text, updated_by::text
		FROM modules WHERE key = $1`, key,
	).Scan(
		&m.Key, &m.Area, &m.NameEN, &m.NameTH, &m.Description,
		&m.Enabled, &m.Core, &m.SortOrder, &m.UpdatedAt, &m.UpdatedBy,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			writeErr(w, http.StatusNotFound, "module not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "read failed")
		return
	}
	writeJSON(w, http.StatusOK, m)
}
