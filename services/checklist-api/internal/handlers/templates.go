package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/checklist-api/internal/models"
)

// GET /api/checklists/templates — list all templates with item counts.
func (h *Handler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT t.id, t.code, t.name_en, t.name_th, t.icon, t.sort_order,
		       t.is_active, t.created_at, t.updated_at,
		       COUNT(i.id) AS item_count
		  FROM checklist_templates t
		  LEFT JOIN checklist_template_items i ON i.template_id = t.id
		 GROUP BY t.id
		 ORDER BY t.sort_order, t.code`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := []models.Template{}
	for rows.Next() {
		var t models.Template
		if err := rows.Scan(&t.ID, &t.Code, &t.NameEN, &t.NameTH, &t.Icon,
			&t.SortOrder, &t.IsActive, &t.CreatedAt, &t.UpdatedAt, &t.ItemCount); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": out})
}

// GET /api/checklists/templates/{id} — template + its items.
func (h *Handler) GetTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var t models.Template
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, code, name_en, name_th, icon, sort_order, is_active, created_at, updated_at
		  FROM checklist_templates WHERE id = $1`, id).Scan(
		&t.ID, &t.Code, &t.NameEN, &t.NameTH, &t.Icon, &t.SortOrder,
		&t.IsActive, &t.CreatedAt, &t.UpdatedAt)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "template not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, template_id, text_en, text_th, sort_order, required, created_at
		  FROM checklist_template_items WHERE template_id = $1
		 ORDER BY sort_order`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	items := []models.TemplateItem{}
	for rows.Next() {
		var it models.TemplateItem
		if err := rows.Scan(&it.ID, &it.TemplateID, &it.TextEN, &it.TextTH,
			&it.SortOrder, &it.Required, &it.CreatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		items = append(items, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"template": t, "items": items})
}

type templateWriteReq struct {
	Code      string  `json:"code"`
	NameEN    string  `json:"name_en"`
	NameTH    string  `json:"name_th"`
	Icon      *string `json:"icon"`
	SortOrder *int    `json:"sort_order"`
	IsActive  *bool   `json:"is_active"`
}

// POST /api/checklists/admin/templates — create a template (admin only).
func (h *Handler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	var req templateWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Code == "" || req.NameEN == "" || req.NameTH == "" {
		writeErr(w, http.StatusBadRequest, "code, name_en, name_th required")
		return
	}
	sort := 0
	if req.SortOrder != nil {
		sort = *req.SortOrder
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	var t models.Template
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO checklist_templates (code, name_en, name_th, icon, sort_order, is_active)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING id, code, name_en, name_th, icon, sort_order, is_active, created_at, updated_at`,
		req.Code, req.NameEN, req.NameTH, req.Icon, sort, active).Scan(
		&t.ID, &t.Code, &t.NameEN, &t.NameTH, &t.Icon, &t.SortOrder,
		&t.IsActive, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, t)
}

// PATCH /api/checklists/admin/templates/{id}
func (h *Handler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req templateWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err := h.DB.Exec(r.Context(), `
		UPDATE checklist_templates SET
		  code       = COALESCE(NULLIF($2,''), code),
		  name_en    = COALESCE(NULLIF($3,''), name_en),
		  name_th    = COALESCE(NULLIF($4,''), name_th),
		  icon       = COALESCE($5, icon),
		  sort_order = COALESCE($6, sort_order),
		  is_active  = COALESCE($7, is_active)
		WHERE id = $1`,
		id, req.Code, req.NameEN, req.NameTH, req.Icon, req.SortOrder, req.IsActive)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/checklists/admin/templates/{id}
func (h *Handler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_, err := h.DB.Exec(r.Context(), `DELETE FROM checklist_templates WHERE id = $1`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/checklists/admin/templates/import — accepts the seed JSON format:
//
//	{"modules":[{"code":"A","name_en":"","name_th":"","sort":1,
//	             "items":[{"text_en":"","text_th":"","sort":1,"required":true}, …]}]}
//
// Idempotent by code — existing templates are updated, missing items appended.
type importReq struct {
	Modules []struct {
		Code   string `json:"code"`
		NameEN string `json:"name_en"`
		NameTH string `json:"name_th"`
		Icon   string `json:"icon"`
		Sort   int    `json:"sort"`
		Items  []struct {
			TextEN   string `json:"text_en"`
			TextTH   string `json:"text_th"`
			Sort     int    `json:"sort"`
			Required bool   `json:"required"`
		} `json:"items"`
	} `json:"modules"`
}

func (h *Handler) ImportTemplates(w http.ResponseWriter, r *http.Request) {
	var req importReq
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

	created, updated, items := 0, 0, 0
	for _, m := range req.Modules {
		if m.Code == "" {
			continue
		}
		var id string
		err := tx.QueryRow(ctx, `
			INSERT INTO checklist_templates (code, name_en, name_th, icon, sort_order, is_active)
			VALUES ($1,$2,$3,NULLIF($4,''),$5,true)
			ON CONFLICT (code) DO UPDATE
			  SET name_en = EXCLUDED.name_en,
			      name_th = EXCLUDED.name_th,
			      icon    = COALESCE(EXCLUDED.icon, checklist_templates.icon),
			      sort_order = EXCLUDED.sort_order,
			      updated_at = NOW()
			RETURNING id, (xmax = 0) AS inserted`,
			m.Code, m.NameEN, m.NameTH, m.Icon, m.Sort).Scan(&id, new(bool))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "template upsert: "+err.Error())
			return
		}
		// Count as created if no items exist yet for this template (rough heuristic
		// keeps the response useful without another SELECT round-trip).
		var existing int
		_ = tx.QueryRow(ctx, `SELECT COUNT(*) FROM checklist_template_items WHERE template_id=$1`, id).Scan(&existing)
		if existing == 0 {
			created++
		} else {
			updated++
		}
		for _, it := range m.Items {
			_, err := tx.Exec(ctx, `
				INSERT INTO checklist_template_items (template_id, text_en, text_th, sort_order, required)
				SELECT $1,$2,$3,$4,$5
				 WHERE NOT EXISTS (
				   SELECT 1 FROM checklist_template_items
				    WHERE template_id=$1 AND sort_order=$4
				 )`,
				id, it.TextEN, it.TextTH, it.Sort, it.Required)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "item insert: "+err.Error())
				return
			}
			items++
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"created": created, "updated": updated, "items": items,
	})
}
