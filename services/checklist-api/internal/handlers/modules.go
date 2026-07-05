package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
)

type attachReq struct {
	TemplateID string `json:"template_id"`
}

// POST /api/checklists/projects/{id}/modules — attach a template to a project.
// Snapshots the template's items into project_items so later template edits
// don't rewrite in-flight audits.
func (h *Handler) AttachModule(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	var req attachReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.TemplateID == "" {
		writeErr(w, http.StatusBadRequest, "template_id required")
		return
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	// Next position = max(existing) + 1 so drag order defaults to append.
	var nextPos int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(position), -1) + 1
		  FROM project_modules WHERE project_id = $1`, projectID).Scan(&nextPos); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	uid := nullIfEmpty(mw.UserID(ctx))
	var pmID string
	err = tx.QueryRow(ctx, `
		INSERT INTO project_modules (project_id, template_id, position, added_by)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (project_id, template_id) DO NOTHING
		RETURNING id`, projectID, req.TemplateID, nextPos, uid).Scan(&pmID)
	if err != nil {
		writeErr(w, http.StatusConflict, "module already attached")
		return
	}

	// Snapshot items — critical: never JOIN back to template later.
	if _, err := tx.Exec(ctx, `
		INSERT INTO project_items (project_module_id, text_en, text_th, sort_order, required)
		SELECT $1, text_en, text_th, sort_order, required
		  FROM checklist_template_items
		 WHERE template_id = $2`,
		pmID, req.TemplateID); err != nil {
		writeErr(w, http.StatusInternalServerError, "snapshot error: "+err.Error())
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": pmID, "project_id": projectID, "template_id": req.TemplateID, "position": nextPos,
	})
}

// DELETE /api/checklists/projects/{id}/modules/{pmId}
func (h *Handler) DetachModule(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	pmID := chi.URLParam(r, "pmId")
	res, err := h.DB.Exec(r.Context(),
		`DELETE FROM project_modules WHERE id = $1 AND project_id = $2`, pmID, projectID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type reorderReq struct {
	Order []string `json:"order"`
}

// PATCH /api/checklists/projects/{id}/modules/reorder
// Body: {"order": [pmId, pmId, ...]}
func (h *Handler) ReorderModules(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	var req reorderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)
	for i, pmID := range req.Order {
		if _, err := tx.Exec(ctx, `
			UPDATE project_modules SET position = $1
			 WHERE id = $2 AND project_id = $3`, i, pmID, projectID); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
