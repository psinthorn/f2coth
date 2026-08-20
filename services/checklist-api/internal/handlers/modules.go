package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/checklist-api/internal/models"
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
	// Snapshot the template's display fields onto the section row so later
	// template edits (or a rename of this project's copy) stay independent.
	var pmID string
	err = tx.QueryRow(ctx, `
		INSERT INTO project_modules (project_id, template_id, position, added_by, code, name_en, name_th, icon, is_custom)
		SELECT $1, $2, $3, $4, t.code, t.name_en, t.name_th, t.icon, FALSE
		  FROM checklist_templates t WHERE t.id = $2
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

// ── Sections (custom create + rename) ────────────────────────────────────
// Attaching a template is AttachModule above; these cover ad-hoc sections
// that aren't in the library and per-project renames.

type sectionReq struct {
	NameEN        string `json:"name_en"`
	NameTH        string `json:"name_th"`
	SaveToLibrary bool   `json:"save_to_library"`
}

// POST /api/checklists/projects/{id}/sections — create a custom section.
// When save_to_library is set, a matching (empty) template is created too so
// the section can be re-attached to future projects from the library.
func (h *Handler) CreateSection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	var req sectionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.NameEN == "" || req.NameTH == "" {
		writeErr(w, http.StatusBadRequest, "name_en and name_th required")
		return
	}
	ctx := r.Context()
	if h.exists(ctx, `
		SELECT EXISTS(SELECT 1 FROM project_modules
		 WHERE project_id = $1 AND (lower(trim(name_en)) = lower(trim($2)) OR lower(trim(name_th)) = lower(trim($3))))`,
		projectID, req.NameEN, req.NameTH) {
		writeErr(w, http.StatusConflict, "A section with this name already exists in this project.")
		return
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	var nextPos int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(position), -1) + 1
		  FROM project_modules WHERE project_id = $1`, projectID).Scan(&nextPos); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	var templateID *string
	code := ""
	if req.SaveToLibrary {
		var tid, tcode string
		if err := tx.QueryRow(ctx, `
			INSERT INTO checklist_templates (code, name_en, name_th, sort_order, is_active)
			VALUES ('C-' || substr(gen_random_uuid()::text, 1, 8), $1, $2,
			        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM checklist_templates), TRUE)
			RETURNING id, code`, req.NameEN, req.NameTH).Scan(&tid, &tcode); err != nil {
			writeErr(w, http.StatusInternalServerError, "template create: "+err.Error())
			return
		}
		templateID = &tid
		code = tcode
	}

	uid := nullIfEmpty(mw.UserID(ctx))
	var m models.ProjectModule
	if err := tx.QueryRow(ctx, `
		INSERT INTO project_modules (project_id, template_id, position, added_by, code, name_en, name_th, is_custom)
		VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
		RETURNING id, project_id, template_id, code, name_en, name_th, icon, position, is_custom, added_by, added_at`,
		projectID, templateID, nextPos, uid, code, req.NameEN, req.NameTH).Scan(
		&m.ID, &m.ProjectID, &m.TemplateID, &m.Code, &m.NameEN, &m.NameTH,
		&m.Icon, &m.Position, &m.IsCustom, &m.AddedBy, &m.AddedAt); err != nil {
		writeErr(w, http.StatusInternalServerError, "insert error: "+err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	m.Subsections = []models.ProjectSubsection{}
	m.Items = []models.ProjectItem{}
	writeJSON(w, http.StatusCreated, m)
}

// PATCH /api/checklists/projects/{id}/sections/{pmId} — rename a section.
// Rename is project-local (never touches the shared template).
func (h *Handler) UpdateSection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	pmID := chi.URLParam(r, "pmId")
	var req sectionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	// Reject a rename that collides with another section in the same project.
	if h.exists(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM project_modules
		 WHERE project_id = $1 AND id <> $2
		   AND (lower(trim(name_en)) = lower(trim(NULLIF($3,''))) OR lower(trim(name_th)) = lower(trim(NULLIF($4,'')))))`,
		projectID, pmID, req.NameEN, req.NameTH) {
		writeErr(w, http.StatusConflict, "A section with this name already exists in this project.")
		return
	}
	res, err := h.DB.Exec(r.Context(), `
		UPDATE project_modules SET
		  name_en = COALESCE(NULLIF($3,''), name_en),
		  name_th = COALESCE(NULLIF($4,''), name_th)
		WHERE id = $1 AND project_id = $2`, pmID, projectID, req.NameEN, req.NameTH)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "section not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Sub-sections ─────────────────────────────────────────────────────────

type subsectionReq struct {
	NameEN string `json:"name_en"`
	NameTH string `json:"name_th"`
}

// POST /api/checklists/projects/{id}/modules/{pmId}/subsections
func (h *Handler) CreateSubsection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	pmID := chi.URLParam(r, "pmId")
	var req subsectionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.NameEN == "" || req.NameTH == "" {
		writeErr(w, http.StatusBadRequest, "name_en and name_th required")
		return
	}
	ctx := r.Context()
	// Guard: the section must belong to this project.
	var ok bool
	if err := h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM project_modules WHERE id = $1 AND project_id = $2)`,
		pmID, projectID).Scan(&ok); err != nil || !ok {
		writeErr(w, http.StatusNotFound, "section not found on this project")
		return
	}
	if h.exists(ctx, `
		SELECT EXISTS(SELECT 1 FROM project_subsections
		 WHERE project_module_id = $1 AND (lower(trim(name_en)) = lower(trim($2)) OR lower(trim(name_th)) = lower(trim($3))))`,
		pmID, req.NameEN, req.NameTH) {
		writeErr(w, http.StatusConflict, "A sub-section with this name already exists in this section.")
		return
	}
	var nextSort int
	if err := h.DB.QueryRow(ctx, `
		SELECT COALESCE(MAX(sort_order), -1) + 1
		  FROM project_subsections WHERE project_module_id = $1`, pmID).Scan(&nextSort); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	var s models.ProjectSubsection
	if err := h.DB.QueryRow(ctx, `
		INSERT INTO project_subsections (project_module_id, name_en, name_th, sort_order, is_custom)
		VALUES ($1, $2, $3, $4, TRUE)
		RETURNING id, project_module_id, name_en, name_th, sort_order, is_custom`,
		pmID, req.NameEN, req.NameTH, nextSort).Scan(
		&s.ID, &s.ProjectModuleID, &s.NameEN, &s.NameTH, &s.SortOrder, &s.IsCustom); err != nil {
		writeErr(w, http.StatusInternalServerError, "insert error: "+err.Error())
		return
	}
	s.Items = []models.ProjectItem{}
	writeJSON(w, http.StatusCreated, s)
}

// PATCH /api/checklists/subsections/{id} — rename a sub-section.
func (h *Handler) UpdateSubsection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req subsectionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	// Reject a rename that collides with a sibling sub-section in the same section.
	if h.exists(r.Context(), `
		SELECT EXISTS(SELECT 1 FROM project_subsections
		 WHERE project_module_id = (SELECT project_module_id FROM project_subsections WHERE id = $1)
		   AND id <> $1
		   AND (lower(trim(name_en)) = lower(trim(NULLIF($2,''))) OR lower(trim(name_th)) = lower(trim(NULLIF($3,'')))))`,
		id, req.NameEN, req.NameTH) {
		writeErr(w, http.StatusConflict, "A sub-section with this name already exists in this section.")
		return
	}
	res, err := h.DB.Exec(r.Context(), `
		UPDATE project_subsections SET
		  name_en = COALESCE(NULLIF($2,''), name_en),
		  name_th = COALESCE(NULLIF($3,''), name_th)
		WHERE id = $1`, id, req.NameEN, req.NameTH)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "sub-section not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PATCH /api/checklists/projects/{id}/modules/{pmId}/subsections/reorder
// Body: {"order": [subId, subId, ...]} — sets sort_order by index. Scoped to
// the section, so a stray id from another section is silently ignored.
func (h *Handler) ReorderSubsections(w http.ResponseWriter, r *http.Request) {
	pmID := chi.URLParam(r, "pmId")
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
	for i, id := range req.Order {
		if _, err := tx.Exec(ctx, `
			UPDATE project_subsections SET sort_order = $1
			 WHERE id = $2 AND project_module_id = $3`, i, id, pmID); err != nil {
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

// DELETE /api/checklists/subsections/{id}
// Items keep living: the FK is ON DELETE SET NULL, so they move up to the
// section rather than being deleted with the sub-section.
func (h *Handler) DeleteSubsection(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.DB.Exec(r.Context(), `DELETE FROM project_subsections WHERE id = $1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "sub-section not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
