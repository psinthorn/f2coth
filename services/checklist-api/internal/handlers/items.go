package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
)

type itemPatchReq struct {
	Status   *string `json:"status"`
	Note     *string `json:"note"`
	PhotoURL *string `json:"photo_url"`
}

var validStatus = map[string]bool{"pending": true, "pass": true, "fail": true, "na": true}

// PATCH /api/checklists/items/{id}
//
// Writes an audit_log row for any status change so the customer-facing
// trail shows who signed off (or unwound) what and when. Uses the generic
// audit_log table (migration 019). Same pattern as auth-api's DSR writes.
func (h *Handler) UpdateItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req itemPatchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Status != nil && !validStatus[*req.Status] {
		writeErr(w, http.StatusBadRequest, "invalid status")
		return
	}
	uid := nullIfEmpty(mw.UserID(r.Context()))

	// Grab the current status so we can log the transition — only write to
	// audit_log if the status is actually changing.
	var prevStatus string
	_ = h.DB.QueryRow(r.Context(),
		`SELECT status FROM project_items WHERE id = $1`, id).Scan(&prevStatus)

	// checked_at/by are set whenever status flips off pending (pass/fail/na).
	// Reverting to pending clears them.
	_, err := h.DB.Exec(r.Context(), `
		UPDATE project_items SET
		  status    = COALESCE($2, status),
		  note      = COALESCE($3, note),
		  photo_url = COALESCE($4, photo_url),
		  checked_by = CASE
		    WHEN $2 IS NULL THEN checked_by
		    WHEN $2 = 'pending' THEN NULL
		    ELSE $5::uuid
		  END,
		  checked_at = CASE
		    WHEN $2 IS NULL THEN checked_at
		    WHEN $2 = 'pending' THEN NULL
		    ELSE NOW()
		  END
		WHERE id = $1`, id, req.Status, req.Note, req.PhotoURL, uid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}

	// Fire-and-forget audit — a failed insert here shouldn't fail the PATCH.
	if req.Status != nil && *req.Status != prevStatus {
		changes, _ := json.Marshal(map[string]any{
			"from": prevStatus,
			"to":   *req.Status,
			"note": derefStr(req.Note),
		})
		_, _ = h.DB.Exec(r.Context(), `
			INSERT INTO audit_log (resource_type, resource_id, actor_id, action, changes)
			VALUES ('project_item', $1, $2::uuid, $3, $4::jsonb)`,
			id, uid, "status_change", changes)
	}

	w.WriteHeader(http.StatusNoContent)
}
