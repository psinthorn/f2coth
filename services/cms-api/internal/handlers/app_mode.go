package handlers

// app_mode.go — global site-mode indicator (production / trial / maintenance).
// One row, one setting. Public GET returns the locale-resolved message so
// public + portal + admin banners all agree. Admin PUT swaps the mode.
//
// Routes:
//   GET  /api/cms/app-mode         — public, {mode, message}
//   GET  /api/cms/admin/app-mode   — admin, {mode, message_en, message_th, updated_at}
//   PUT  /api/cms/admin/app-mode   — admin, upsert full state

import (
	"encoding/json"
	"net/http"
	"time"

	mw "github.com/f2cothai/f2-website/services/cms-api/internal/middleware"
)

// Public
func (h *CMSHandler) GetAppMode(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	var mode, messageEN, messageTH string
	err := h.DB.QueryRow(r.Context(),
		`SELECT mode, message_en, message_th FROM app_config WHERE id = 1`,
	).Scan(&mode, &messageEN, &messageTH)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	message := messageEN
	if loc == "th" && messageTH != "" {
		message = messageTH
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mode":    mode,
		"message": message,
	})
}

// Admin
func (h *CMSHandler) AdminGetAppMode(w http.ResponseWriter, r *http.Request) {
	var mode, messageEN, messageTH string
	var updatedAt time.Time
	err := h.DB.QueryRow(r.Context(),
		`SELECT mode, message_en, message_th, updated_at FROM app_config WHERE id = 1`,
	).Scan(&mode, &messageEN, &messageTH, &updatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mode":       mode,
		"message_en": messageEN,
		"message_th": messageTH,
		"updated_at": updatedAt,
	})
}

func (h *CMSHandler) AdminSetAppMode(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode      string `json:"mode"`
		MessageEN string `json:"message_en"`
		MessageTH string `json:"message_th"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	switch req.Mode {
	case "production", "trial", "maintenance":
	default:
		writeErr(w, http.StatusBadRequest, "mode must be production|trial|maintenance")
		return
	}
	_, err := h.DB.Exec(r.Context(), `
		UPDATE app_config
		SET mode = $1, message_en = $2, message_th = $3
		WHERE id = 1`,
		req.Mode, req.MessageEN, req.MessageTH,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"mode":       req.Mode,
		"message_en": req.MessageEN,
		"message_th": req.MessageTH,
	})
}
