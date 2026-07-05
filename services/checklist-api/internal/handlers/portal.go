package handlers

// Portal-facing (customer) read-only endpoints. Every route in this file
// must run under RequireCustomer middleware — it stashes the caller's
// customer_id in ctx and we scope every query to that id so contacts
// can only ever see their own company's projects.
//
// visible_to_customer=false hides a project even from a matched
// customer_id, so admins can pause the client view without detaching
// or renaming anything.

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/checklist-api/internal/models"
)

// GET /api/checklists/portal/projects
func (h *Handler) PortalListProjects(w http.ResponseWriter, r *http.Request) {
	cid := mw.CustomerID(r.Context())
	if cid == "" {
		writeErr(w, http.StatusForbidden, "no customer_id in token")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT p.id, p.client_name, p.name, p.status, p.start_date, p.end_date,
		       p.iacc_company_id, p.customer_id, c.name, p.visible_to_customer,
		       p.created_at, p.updated_at,
		       COALESCE(SUM(CASE WHEN pi.status IN ('pass','fail','na') THEN 1 ELSE 0 END), 0) AS done_count,
		       COALESCE(COUNT(pi.id), 0) AS total_count,
		       COALESCE(SUM(CASE WHEN pi.status = 'fail' THEN 1 ELSE 0 END), 0) AS fail_count
		  FROM projects p
		  LEFT JOIN customers c        ON c.id = p.customer_id
		  LEFT JOIN project_modules pm ON pm.project_id = p.id
		  LEFT JOIN project_items pi   ON pi.project_module_id = pm.id
		 WHERE p.customer_id = $1 AND p.visible_to_customer = TRUE
		 GROUP BY p.id, c.name
		 ORDER BY p.created_at DESC`, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []models.Project{}
	for rows.Next() {
		var p models.Project
		if err := rows.Scan(&p.ID, &p.ClientName, &p.Name, &p.Status,
			&p.StartDate, &p.EndDate, &p.IACCCompanyID, &p.CustomerID, &p.CustomerName,
			&p.VisibleToCustomer, &p.CreatedAt, &p.UpdatedAt,
			&p.DoneCount, &p.TotalCount, &p.FailCount); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": out})
}

// ensurePortalAccess loads the project and checks it belongs to the
// authenticated customer AND is visible. Returns 404 for both mismatch and
// missing so we don't leak the existence of hidden projects.
func (h *Handler) ensurePortalAccess(r *http.Request, id string) (models.Project, int, string) {
	cid := mw.CustomerID(r.Context())
	if cid == "" {
		return models.Project{}, http.StatusForbidden, "no customer_id in token"
	}
	p, err := loadProject(r.Context(), h, id)
	if err == pgx.ErrNoRows {
		return models.Project{}, http.StatusNotFound, "project not found"
	}
	if err != nil {
		return models.Project{}, http.StatusInternalServerError, "db error"
	}
	if p.CustomerID == nil || *p.CustomerID != cid || !p.VisibleToCustomer {
		return models.Project{}, http.StatusNotFound, "project not found"
	}
	return p, 0, ""
}

// GET /api/checklists/portal/projects/{id}
func (h *Handler) PortalGetProject(w http.ResponseWriter, r *http.Request) {
	p, status, msg := h.ensurePortalAccess(r, chi.URLParam(r, "id"))
	if status != 0 {
		writeErr(w, status, msg)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// GET /api/checklists/portal/projects/{id}/board
func (h *Handler) PortalGetBoard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, status, msg := h.ensurePortalAccess(r, id)
	if status != 0 {
		writeErr(w, status, msg)
		return
	}
	// Reuse the same module + item loading as the admin board — the shape
	// is identical, only the visibility gate is different.
	mods, err := loadBoardModules(r.Context(), h, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": p, "modules": mods})
}

// GET /api/checklists/portal/projects/{id}/progress
func (h *Handler) PortalGetProgress(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, status, msg := h.ensurePortalAccess(r, id); status != 0 {
		writeErr(w, status, msg)
		return
	}
	writeProjectProgress(w, r, h, id)
}
