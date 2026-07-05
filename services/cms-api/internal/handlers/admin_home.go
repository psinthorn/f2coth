package handlers

// admin_home.go — CRUD for the landing page copy blocks stored in
// home_page_content (see migration 033). Public read endpoint returns
// locale-resolved key/value map; admin endpoints return the raw {en, th}
// pairs for bilingual editing.
//
// Routes:
//   GET  /api/cms/home                    — public, locale-resolved {key: string}
//   GET  /api/cms/admin/home              — admin, {key: {en, th}}
//   PUT  /api/cms/admin/home              — admin, bulk upsert {key: {en, th}}

import (
	"encoding/json"
	"net/http"
	"time"

	mw "github.com/f2cothai/f2-website/services/cms-api/internal/middleware"
)

// ── Public ───────────────────────────────────────────────────────────────────

// GET /api/cms/home
func (h *CMSHandler) GetHomeContent(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(), `
		SELECT key, COALESCE(value->>$1, value->>'en') AS value
		FROM home_page_content`, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out[k] = v
	}
	writeJSON(w, http.StatusOK, out)
}

// ── Admin ────────────────────────────────────────────────────────────────────

// GET /api/cms/admin/home
func (h *CMSHandler) AdminListHomeContent(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(),
		`SELECT key, value, updated_at FROM home_page_content ORDER BY key`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	type item struct {
		Key       string            `json:"key"`
		Value     map[string]string `json:"value"`
		UpdatedAt time.Time         `json:"updated_at"`
	}
	out := make([]item, 0, 32)
	for rows.Next() {
		var it item
		var raw []byte
		if err := rows.Scan(&it.Key, &raw, &it.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		it.Value = map[string]string{}
		_ = json.Unmarshal(raw, &it.Value)
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

// PUT /api/cms/admin/home
// Bulk upsert. Body: {"items":[{"key":"hero.headline","value":{"en":"...","th":"..."}}, ...]}
func (h *CMSHandler) AdminUpsertHomeContent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items []struct {
			Key   string            `json:"key"`
			Value map[string]string `json:"value"`
		} `json:"items"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if len(req.Items) == 0 {
		writeErr(w, http.StatusBadRequest, "items required")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(r.Context())

	for _, it := range req.Items {
		if it.Key == "" || it.Value == nil {
			writeErr(w, http.StatusBadRequest, "each item needs key and value")
			return
		}
		if _, ok := it.Value["en"]; !ok {
			writeErr(w, http.StatusBadRequest, "each item.value must include 'en'")
			return
		}
		if _, ok := it.Value["th"]; !ok {
			it.Value["th"] = it.Value["en"]
		}
		payload, _ := json.Marshal(it.Value)
		_, err := tx.Exec(r.Context(), `
			INSERT INTO home_page_content (key, value) VALUES ($1, $2::jsonb)
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
			it.Key, payload)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "upsert failed")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "count": len(req.Items)})
}
