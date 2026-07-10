package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/contract-api/internal/models"
)

// GET /api/contracts/templates?active=1 — list templates.
func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	q := `SELECT id, code, name, version, doc_prefix, merge_schema, is_active, created_at, updated_at
	        FROM contract_templates`
	args := []any{}
	if r.URL.Query().Get("active") == "1" {
		q += ` WHERE is_active = true`
	}
	q += ` ORDER BY name`
	rows, err := h.DB.Query(r.Context(), q, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []models.Template{}
	for rows.Next() {
		var t models.Template
		if err := rows.Scan(&t.ID, &t.Code, &t.Name, &t.Version, &t.DocPrefix,
			&t.MergeSchema, &t.IsActive, &t.CreatedAt, &t.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": out})
}

// GET /api/contracts/templates/{id}
func (h *Handler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	var t models.Template
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, code, name, version, doc_prefix, merge_schema, is_active, created_at, updated_at
		  FROM contract_templates WHERE id = $1`, chi.URLParam(r, "id")).Scan(
		&t.ID, &t.Code, &t.Name, &t.Version, &t.DocPrefix, &t.MergeSchema,
		&t.IsActive, &t.CreatedAt, &t.UpdatedAt)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, t)
}

type templateWriteReq struct {
	Code        string          `json:"code"`
	Name        string          `json:"name"`
	Version     string          `json:"version"`
	DocPrefix   string          `json:"doc_prefix"`
	MergeSchema json.RawMessage `json:"merge_schema"`
	IsActive    *bool           `json:"is_active"`
}

// POST /api/contracts/templates (admin) — code must have a docgen builder.
func (h *Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	var req templateWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Code == "" || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "code and name required")
		return
	}
	if !h.templateCodeRenderable(r, req.Code) {
		writeErr(w, http.StatusUnprocessableEntity,
			"no docgen builder registered for code '"+req.Code+"' — layouts are code-defined")
		return
	}
	if req.Version == "" {
		req.Version = "1.0"
	}
	if req.DocPrefix == "" {
		req.DocPrefix = "F2-DOC"
	}
	if len(req.MergeSchema) == 0 {
		req.MergeSchema = json.RawMessage(`{"fields":[]}`)
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	var id string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO contract_templates (code, name, version, doc_prefix, merge_schema, is_active)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		req.Code, req.Name, req.Version, req.DocPrefix, req.MergeSchema, active).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// PATCH /api/contracts/templates/{id} (admin) — edit name/version/prefix/
// schema/active. Code is immutable (it binds to a builder); changing it would
// orphan existing contracts, so it's intentionally not updatable here.
func (h *Handler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	var req templateWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	ct, err := h.DB.Exec(r.Context(), `
		UPDATE contract_templates
		   SET name = COALESCE(NULLIF($2,''), name),
		       version = COALESCE(NULLIF($3,''), version),
		       doc_prefix = COALESCE(NULLIF($4,''), doc_prefix),
		       merge_schema = COALESCE($5, merge_schema),
		       is_active = $6
		 WHERE id = $1`,
		chi.URLParam(r, "id"), req.Name, req.Version, req.DocPrefix,
		nullableJSON(req.MergeSchema), active)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// templateCodeRenderable asks docgen whether a builder exists for code. Fails
// CLOSED (rejects) if docgen is unreachable — we must not persist a template
// we can't render. This is what keeps layouts code-defined.
func (h *Handler) templateCodeRenderable(r *http.Request, code string) bool {
	codes, err := h.Docgen.Templates(r.Context())
	if err != nil {
		return false
	}
	for _, c := range codes {
		if c == code {
			return true
		}
	}
	return false
}

func nullableJSON(m json.RawMessage) any {
	if len(m) == 0 {
		return nil
	}
	return m
}
