package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/checklist-api/internal/models"
)

// GET /api/checklists/projects — list all projects with progress totals.
func (h *Handler) ListProjects(w http.ResponseWriter, r *http.Request) {
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
		 GROUP BY p.id, c.name
		 ORDER BY p.created_at DESC`)
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

// GET /api/checklists/projects/{id}
func (h *Handler) GetProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := loadProject(r.Context(), h, id)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func loadProject(ctx context.Context, h *Handler, id string) (models.Project, error) {
	var p models.Project
	err := h.DB.QueryRow(ctx, `
		SELECT p.id, p.client_name, p.name, p.status, p.start_date, p.end_date,
		       p.iacc_company_id, p.customer_id, c.name, p.visible_to_customer,
		       p.created_at, p.updated_at
		  FROM projects p
		  LEFT JOIN customers c ON c.id = p.customer_id
		 WHERE p.id = $1`, id).Scan(
		&p.ID, &p.ClientName, &p.Name, &p.Status, &p.StartDate, &p.EndDate,
		&p.IACCCompanyID, &p.CustomerID, &p.CustomerName, &p.VisibleToCustomer,
		&p.CreatedAt, &p.UpdatedAt)
	return p, err
}

type projectWriteReq struct {
	ClientName        string  `json:"client_name"`
	Name              string  `json:"name"`
	Status            string  `json:"status"`
	StartDate         *string `json:"start_date"`
	EndDate           *string `json:"end_date"`
	IACCCompanyID     *string `json:"iacc_company_id"`
	CustomerID        *string `json:"customer_id"`
	VisibleToCustomer *bool   `json:"visible_to_customer"`
}

// POST /api/checklists/admin/projects
func (h *Handler) CreateProject(w http.ResponseWriter, r *http.Request) {
	var req projectWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.ClientName == "" || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "client_name and name required")
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	visible := true
	if req.VisibleToCustomer != nil {
		visible = *req.VisibleToCustomer
	}
	var id string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO projects (client_name, name, status, start_date, end_date,
		                     iacc_company_id, customer_id, visible_to_customer)
		VALUES ($1,$2,$3, NULLIF($4,'')::date, NULLIF($5,'')::date, $6, $7, $8)
		RETURNING id`,
		req.ClientName, req.Name, req.Status,
		derefStr(req.StartDate), derefStr(req.EndDate), req.IACCCompanyID,
		req.CustomerID, visible).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	p, err := loadProject(r.Context(), h, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "post-create load: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// PATCH /api/checklists/admin/projects/{id}
func (h *Handler) UpdateProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req projectWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err := h.DB.Exec(r.Context(), `
		UPDATE projects SET
		  client_name         = COALESCE(NULLIF($2,''), client_name),
		  name                = COALESCE(NULLIF($3,''), name),
		  status              = COALESCE(NULLIF($4,''), status),
		  start_date          = COALESCE(NULLIF($5,'')::date, start_date),
		  end_date            = COALESCE(NULLIF($6,'')::date, end_date),
		  iacc_company_id     = COALESCE($7, iacc_company_id),
		  customer_id         = COALESCE($8, customer_id),
		  visible_to_customer = COALESCE($9, visible_to_customer)
		WHERE id = $1`,
		id, req.ClientName, req.Name, req.Status,
		derefStr(req.StartDate), derefStr(req.EndDate), req.IACCCompanyID,
		req.CustomerID, req.VisibleToCustomer)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/checklists/admin/projects/{id}
func (h *Handler) DeleteProject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_, err := h.DB.Exec(r.Context(), `DELETE FROM projects WHERE id = $1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/checklists/projects/{id}/board — project + attached modules + items.
// One query per level (project → modules → items) for readability.
func (h *Handler) GetProjectBoard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := loadProject(r.Context(), h, id)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "project not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	mods, err := loadBoardModules(r.Context(), h, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"project": p, "modules": mods})
}

// loadBoardModules returns the ordered attached modules plus their items
// for a project. Shared by admin GetProjectBoard and portal PortalGetBoard.
func loadBoardModules(ctx context.Context, h *Handler, projectID string) ([]models.ProjectModule, error) {
	modRows, err := h.DB.Query(ctx, `
		SELECT pm.id, pm.project_id, pm.template_id,
		       t.code, t.name_en, t.name_th, t.icon,
		       pm.position, pm.added_by, pm.added_at
		  FROM project_modules pm
		  JOIN checklist_templates t ON t.id = pm.template_id
		 WHERE pm.project_id = $1
		 ORDER BY pm.position, pm.added_at`, projectID)
	if err != nil {
		return nil, err
	}
	defer modRows.Close()
	mods := []models.ProjectModule{}
	modIDs := []string{}
	for modRows.Next() {
		var m models.ProjectModule
		if err := modRows.Scan(&m.ID, &m.ProjectID, &m.TemplateID, &m.Code,
			&m.NameEN, &m.NameTH, &m.Icon, &m.Position, &m.AddedBy, &m.AddedAt); err != nil {
			return nil, err
		}
		m.Items = []models.ProjectItem{}
		mods = append(mods, m)
		modIDs = append(modIDs, m.ID)
	}
	if len(modIDs) == 0 {
		return mods, nil
	}
	itemRows, err := h.DB.Query(ctx, `
		SELECT id, project_module_id, text_en, text_th, sort_order, required,
		       status, note, photo_url, checked_by, checked_at, updated_at
		  FROM project_items
		 WHERE project_module_id = ANY($1)
		 ORDER BY sort_order`, modIDs)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()
	idx := map[string]int{}
	for i, m := range mods {
		idx[m.ID] = i
	}
	for itemRows.Next() {
		var it models.ProjectItem
		if err := itemRows.Scan(&it.ID, &it.ProjectModuleID, &it.TextEN, &it.TextTH,
			&it.SortOrder, &it.Required, &it.Status, &it.Note, &it.PhotoURL,
			&it.CheckedBy, &it.CheckedAt, &it.UpdatedAt); err != nil {
			return nil, err
		}
		if i, ok := idx[it.ProjectModuleID]; ok {
			mods[i].Items = append(mods[i].Items, it)
		}
	}
	return mods, nil
}

// GET /api/checklists/projects/{id}/progress
func (h *Handler) GetProjectProgress(w http.ResponseWriter, r *http.Request) {
	writeProjectProgress(w, r, h, chi.URLParam(r, "id"))
}

func writeProjectProgress(w http.ResponseWriter, r *http.Request, h *Handler, projectID string) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT pm.id, t.code, t.name_en, t.name_th,
		       COUNT(pi.id) AS total,
		       COUNT(*) FILTER (WHERE pi.status IN ('pass','fail','na')) AS done,
		       COUNT(*) FILTER (WHERE pi.status = 'fail') AS fail,
		       COUNT(*) FILTER (WHERE pi.status = 'na')   AS na,
		       COUNT(*) FILTER (WHERE pi.status = 'pending') AS pending
		  FROM project_modules pm
		  JOIN checklist_templates t ON t.id = pm.template_id
		  LEFT JOIN project_items pi ON pi.project_module_id = pm.id
		 WHERE pm.project_id = $1
		 GROUP BY pm.id, t.code, t.name_en, t.name_th, pm.position
		 ORDER BY pm.position`, projectID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []models.ProgressPerModule{}
	totals := models.ProgressTotals{}
	for rows.Next() {
		var p models.ProgressPerModule
		if err := rows.Scan(&p.ProjectModuleID, &p.TemplateCode, &p.NameEN, &p.NameTH,
			&p.Total, &p.Done, &p.Fail, &p.NA, &p.Pending); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		totals.Total += p.Total
		totals.Done += p.Done
		totals.Fail += p.Fail
		totals.NA += p.NA
		totals.Pending += p.Pending
		out = append(out, p)
	}
	totals.Pass = totals.Done - totals.Fail - totals.NA
	writeJSON(w, http.StatusOK, map[string]any{"modules": out, "totals": totals})
}

// ── Visit logs ─────────────────────────────────────────────────────────────

// GET /api/checklists/projects/{id}/visits
func (h *Handler) ListVisits(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, project_id, visit_date, summary, billable, amount, created_by, created_at
		  FROM visit_logs WHERE project_id = $1
		 ORDER BY visit_date DESC, created_at DESC`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []models.VisitLog{}
	for rows.Next() {
		var v models.VisitLog
		if err := rows.Scan(&v.ID, &v.ProjectID, &v.VisitDate, &v.Summary,
			&v.Billable, &v.Amount, &v.CreatedBy, &v.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, v)
	}
	writeJSON(w, http.StatusOK, map[string]any{"visits": out})
}

type visitWriteReq struct {
	VisitDate string   `json:"visit_date"`
	Summary   string   `json:"summary"`
	Billable  bool     `json:"billable"`
	Amount    *float64 `json:"amount"`
}

// POST /api/checklists/projects/{id}/visits
func (h *Handler) CreateVisit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req visitWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.VisitDate == "" {
		req.VisitDate = time.Now().Format("2006-01-02")
	}
	uid := nullIfEmpty(mw.UserID(r.Context()))
	var v models.VisitLog
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO visit_logs (project_id, visit_date, summary, billable, amount, created_by)
		VALUES ($1, $2::date, $3, $4, $5, $6)
		RETURNING id, project_id, visit_date, summary, billable, amount, created_by, created_at`,
		id, req.VisitDate, req.Summary, req.Billable, req.Amount, uid).Scan(
		&v.ID, &v.ProjectID, &v.VisitDate, &v.Summary, &v.Billable, &v.Amount,
		&v.CreatedBy, &v.CreatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

// ── helpers ────────────────────────────────────────────────────────────────

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
