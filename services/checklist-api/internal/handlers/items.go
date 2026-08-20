package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/checklist-api/internal/models"
)

type itemPatchReq struct {
	Status   *string `json:"status"`
	Note     *string `json:"note"`
	PhotoURL *string `json:"photo_url"`
	// Text edits — only meaningful for custom items; the UI hides these
	// controls on template-derived rows. Empty strings are ignored server
	// side (COALESCE/NULLIF) so a caller can send text without a status.
	TextEN *string `json:"text_en"`
	TextTH *string `json:"text_th"`
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

	// Reject a text rename that collides with a sibling in the same container.
	if (req.TextEN != nil && *req.TextEN != "") || (req.TextTH != nil && *req.TextTH != "") {
		if h.exists(r.Context(), `
			SELECT EXISTS(
			  SELECT 1 FROM project_items sib, project_items self
			   WHERE self.id = $1
			     AND sib.id <> self.id
			     AND sib.project_module_id = self.project_module_id
			     AND sib.subsection_id IS NOT DISTINCT FROM self.subsection_id
			     AND (lower(trim(sib.text_en)) = lower(trim(NULLIF($2,''))) OR lower(trim(sib.text_th)) = lower(trim(NULLIF($3,'')))))`,
			id, derefStr(req.TextEN), derefStr(req.TextTH)) {
			writeErr(w, http.StatusConflict, "An item with this text already exists here.")
			return
		}
	}

	// Grab the current status so we can log the transition — only write to
	// audit_log if the status is actually changing.
	var prevStatus string
	_ = h.DB.QueryRow(r.Context(),
		`SELECT status FROM project_items WHERE id = $1`, id).Scan(&prevStatus)

	// checked_at/by are set whenever status flips off pending (pass/fail/na).
	// Reverting to pending clears them.
	// Text edits are gated to custom items so the standard audit checklist
	// can't be silently reworded. Template-derived rows ignore text_en/text_th.
	_, err := h.DB.Exec(r.Context(), `
		UPDATE project_items SET
		  status    = COALESCE($2, status),
		  note      = COALESCE($3, note),
		  photo_url = COALESCE($4, photo_url),
		  text_en   = CASE WHEN is_custom THEN COALESCE(NULLIF($6,''), text_en) ELSE text_en END,
		  text_th   = CASE WHEN is_custom THEN COALESCE(NULLIF($7,''), text_th) ELSE text_th END,
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
		WHERE id = $1`, id, req.Status, req.Note, req.PhotoURL, uid, req.TextEN, req.TextTH)
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

type addItemReq struct {
	TextEN        string  `json:"text_en"`
	TextTH        string  `json:"text_th"`
	Required      *bool   `json:"required"`
	SaveToLibrary bool    `json:"save_to_library"`
	SubsectionID  *string `json:"subsection_id"` // optional: place the item under a sub-section
}

// POST /api/checklists/projects/{id}/modules/{pmId}/items
//
// Adds a one-off ("custom") item to an attached module. When save_to_library
// is set the item is also written to the module's template so future projects
// that attach it inherit the item. Item text lands at the end of the module.
func (h *Handler) AddItem(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	pmID := chi.URLParam(r, "pmId")
	var req addItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.TextEN == "" || req.TextTH == "" {
		writeErr(w, http.StatusBadRequest, "text_en and text_th required")
		return
	}
	required := true
	if req.Required != nil {
		required = *req.Required
	}

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	// Verify the module belongs to this project (guards against cross-project
	// item injection) and grab its template for the optional library write.
	// template_id is nullable — custom sections have none, so save-to-library
	// is simply skipped for them.
	var templateID *string
	err = tx.QueryRow(ctx, `
		SELECT template_id FROM project_modules WHERE id = $1 AND project_id = $2`,
		pmID, projectID).Scan(&templateID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "module not found on this project")
		return
	}

	// If placing under a sub-section, verify it belongs to this section.
	if req.SubsectionID != nil && *req.SubsectionID != "" {
		var ok bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM project_subsections WHERE id = $1 AND project_module_id = $2)`,
			*req.SubsectionID, pmID).Scan(&ok); err != nil || !ok {
			writeErr(w, http.StatusBadRequest, "sub-section not found on this section")
			return
		}
	} else {
		req.SubsectionID = nil
	}

	// Reject a duplicate item within the same container (section-direct rows
	// share a container keyed by NULL subsection). IS NOT DISTINCT FROM makes
	// the NULL comparison work.
	if h.exists(ctx, `
		SELECT EXISTS(SELECT 1 FROM project_items
		 WHERE project_module_id = $1 AND subsection_id IS NOT DISTINCT FROM $2
		   AND (lower(trim(text_en)) = lower(trim($3)) OR lower(trim(text_th)) = lower(trim($4))))`,
		pmID, req.SubsectionID, req.TextEN, req.TextTH) {
		writeErr(w, http.StatusConflict, "An item with this text already exists here.")
		return
	}

	// Append after the current last item in the module.
	var nextSort int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(sort_order), -1) + 1
		  FROM project_items WHERE project_module_id = $1`, pmID).Scan(&nextSort); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	var it models.ProjectItem
	err = tx.QueryRow(ctx, `
		INSERT INTO project_items (project_module_id, subsection_id, text_en, text_th, sort_order, required, is_custom)
		VALUES ($1, $2, $3, $4, $5, $6, TRUE)
		RETURNING id, project_module_id, subsection_id, text_en, text_th, sort_order, required,
		          status, note, photo_url, checked_by, checked_at, is_custom, updated_at`,
		pmID, req.SubsectionID, req.TextEN, req.TextTH, nextSort, required).Scan(
		&it.ID, &it.ProjectModuleID, &it.SubsectionID, &it.TextEN, &it.TextTH, &it.SortOrder, &it.Required,
		&it.Status, &it.Note, &it.PhotoURL, &it.CheckedBy, &it.CheckedAt, &it.IsCustom, &it.UpdatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "insert error: "+err.Error())
		return
	}

	if req.SaveToLibrary && templateID != nil {
		// Append to the template too. Existing attached projects are untouched
		// (snapshot semantics) — only future attaches pick it up. Custom
		// sections have no template, so this is silently skipped for them.
		if _, err := tx.Exec(ctx, `
			INSERT INTO checklist_template_items (template_id, text_en, text_th, sort_order, required)
			SELECT $1, $2, $3, COALESCE(MAX(sort_order), -1) + 1, $4
			  FROM checklist_template_items WHERE template_id = $1`,
			*templateID, req.TextEN, req.TextTH, required); err != nil {
			writeErr(w, http.StatusInternalServerError, "library insert error: "+err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusCreated, it)
}

type reorderItemsReq struct {
	ModuleID     string   `json:"module_id"`
	SubsectionID *string  `json:"subsection_id"`
	Order        []string `json:"order"`
}

// PATCH /api/checklists/projects/{id}/items/reorder
//
// Sets the destination container (module + optional sub-section) and 0-based
// sort_order for every item in `order`. Handles both plain reordering and
// moving items between sub-sections / up to the section in one call — the
// caller sends the destination container's full ordered id list. The old
// container is left as-is (sort_order gaps are harmless).
func (h *Handler) ReorderItems(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	var req reorderItemsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	ctx := r.Context()

	// Destination section must belong to this project.
	var ok bool
	if err := h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM project_modules WHERE id = $1 AND project_id = $2)`,
		req.ModuleID, projectID).Scan(&ok); err != nil || !ok {
		writeErr(w, http.StatusNotFound, "section not found on this project")
		return
	}
	// If a sub-section is given, it must belong to that section.
	if req.SubsectionID != nil && *req.SubsectionID != "" {
		if err := h.DB.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM project_subsections WHERE id = $1 AND project_module_id = $2)`,
			*req.SubsectionID, req.ModuleID).Scan(&ok); err != nil || !ok {
			writeErr(w, http.StatusBadRequest, "sub-section not found on this section")
			return
		}
	} else {
		req.SubsectionID = nil
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)
	for i, id := range req.Order {
		// The subquery guard keeps writes inside this project even when an
		// item crosses sections.
		if _, err := tx.Exec(ctx, `
			UPDATE project_items
			   SET project_module_id = $2, subsection_id = $3, sort_order = $4
			 WHERE id = $1
			   AND project_module_id IN (SELECT id FROM project_modules WHERE project_id = $5)`,
			id, req.ModuleID, req.SubsectionID, i, projectID); err != nil {
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

// DELETE /api/checklists/items/{id}
//
// Only custom items may be deleted — template-derived rows are part of the
// standard audit and are delete-protected so the checklist can't be pruned.
func (h *Handler) DeleteItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.DB.Exec(r.Context(),
		`DELETE FROM project_items WHERE id = $1 AND is_custom = TRUE`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusForbidden, "only custom items can be deleted")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
