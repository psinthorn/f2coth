package handlers

// admin_services.go — CRUD for the `services` catalogue used on the
// homepage core-services grid and the /services page. Editors get raw
// {en, th} pairs; public read (cms.go) COALESCEs on the request locale.
//
// Routes (/api/cms/admin/services):
//   GET    /         — list all (incl. unpublished)
//   POST   /         — create
//   GET    /{slug}   — get single
//   PATCH  /{slug}   — partial update
//   DELETE /{slug}   — hard delete

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type AdminService struct {
	ID           string            `json:"id"`
	Slug         string            `json:"slug"`
	Title        map[string]string `json:"title"`
	ShortSummary map[string]string `json:"short_summary"`
	Description  map[string]string `json:"description"`
	Icon         *string           `json:"icon,omitempty"`
	Category     string            `json:"category"`
	SortOrder    int               `json:"sort_order"`
	IsPublished  bool              `json:"is_published"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

type serviceWriteReq struct {
	Slug           string  `json:"slug"`
	TitleEN        string  `json:"title_en"`
	TitleTH        string  `json:"title_th"`
	ShortSummaryEN string  `json:"short_summary_en"`
	ShortSummaryTH string  `json:"short_summary_th"`
	DescriptionEN  string  `json:"description_en"`
	DescriptionTH  string  `json:"description_th"`
	Icon           *string `json:"icon"`
	Category       string  `json:"category"`
	SortOrder      *int    `json:"sort_order"`
	IsPublished    *bool   `json:"is_published"`
}

const adminServiceSelect = `
SELECT id, slug, title, short_summary, description,
       icon, category, sort_order, is_published, created_at, updated_at
FROM services`

func scanAdminService(row interface {
	Scan(...any) error
}) (AdminService, error) {
	var s AdminService
	var titleRaw, summaryRaw, descRaw []byte
	err := row.Scan(&s.ID, &s.Slug, &titleRaw, &summaryRaw, &descRaw,
		&s.Icon, &s.Category, &s.SortOrder, &s.IsPublished, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return s, err
	}
	s.Title = map[string]string{}
	s.ShortSummary = map[string]string{}
	s.Description = map[string]string{}
	_ = json.Unmarshal(titleRaw, &s.Title)
	_ = json.Unmarshal(summaryRaw, &s.ShortSummary)
	_ = json.Unmarshal(descRaw, &s.Description)
	return s, nil
}

// GET /api/cms/admin/services
func (h *CMSHandler) AdminListServices(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(),
		adminServiceSelect+` ORDER BY sort_order, slug LIMIT 200`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]AdminService, 0, 16)
	for rows.Next() {
		s, err := scanAdminService(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": out})
}

// GET /api/cms/admin/services/{slug}
func (h *CMSHandler) AdminGetService(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row := h.DB.QueryRow(r.Context(), adminServiceSelect+` WHERE slug = $1`, slug)
	s, err := scanAdminService(row)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "service not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// POST /api/cms/admin/services
func (h *CMSHandler) AdminCreateService(w http.ResponseWriter, r *http.Request) {
	var req serviceWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.TitleEN = strings.TrimSpace(req.TitleEN)
	if req.Slug == "" || req.TitleEN == "" {
		writeErr(w, http.StatusBadRequest, "slug and title_en are required")
		return
	}
	if req.Category == "" {
		req.Category = "core"
	}
	if req.Category != "core" && req.Category != "support" && req.Category != "opportunistic" && req.Category != "marketing" {
		writeErr(w, http.StatusBadRequest, "category must be core|support|marketing|opportunistic")
		return
	}
	sortOrder := 0
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	isPublished := true
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}

	titleJSON, _ := json.Marshal(map[string]string{"en": req.TitleEN, "th": req.TitleTH})
	summaryJSON, _ := json.Marshal(map[string]string{"en": req.ShortSummaryEN, "th": req.ShortSummaryTH})
	descJSON, _ := json.Marshal(map[string]string{"en": req.DescriptionEN, "th": req.DescriptionTH})

	var id string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order, is_published)
		VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
		RETURNING id`,
		req.Slug, titleJSON, summaryJSON, descJSON,
		req.Icon, req.Category, sortOrder, isPublished,
	).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "create failed")
		return
	}
	row := h.DB.QueryRow(r.Context(), adminServiceSelect+` WHERE id = $1`, id)
	s, _ := scanAdminService(row)
	writeJSON(w, http.StatusCreated, s)
}

// PATCH /api/cms/admin/services/{slug}
func (h *CMSHandler) AdminUpdateService(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var req serviceWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	pRow := h.DB.QueryRow(r.Context(), adminServiceSelect+` WHERE slug = $1`, slug)
	cur, err := scanAdminService(pRow)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "service not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	newTitle := cur.Title
	if req.TitleEN != "" {
		newTitle["en"] = req.TitleEN
	}
	if req.TitleTH != "" {
		newTitle["th"] = req.TitleTH
	}
	newSummary := cur.ShortSummary
	if req.ShortSummaryEN != "" {
		newSummary["en"] = req.ShortSummaryEN
	}
	if req.ShortSummaryTH != "" {
		newSummary["th"] = req.ShortSummaryTH
	}
	newDesc := cur.Description
	if req.DescriptionEN != "" {
		newDesc["en"] = req.DescriptionEN
	}
	if req.DescriptionTH != "" {
		newDesc["th"] = req.DescriptionTH
	}
	icon := cur.Icon
	if req.Icon != nil {
		icon = req.Icon
	}
	category := cur.Category
	if req.Category != "" {
		if req.Category != "core" && req.Category != "support" && req.Category != "opportunistic" && req.Category != "marketing" {
			writeErr(w, http.StatusBadRequest, "category must be core|support|marketing|opportunistic")
			return
		}
		category = req.Category
	}
	sortOrder := cur.SortOrder
	if req.SortOrder != nil {
		sortOrder = *req.SortOrder
	}
	isPublished := cur.IsPublished
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}
	newSlug := cur.Slug
	if req.Slug != "" {
		newSlug = strings.TrimSpace(strings.ToLower(req.Slug))
	}

	titleJSON, _ := json.Marshal(newTitle)
	summaryJSON, _ := json.Marshal(newSummary)
	descJSON, _ := json.Marshal(newDesc)

	_, err = h.DB.Exec(r.Context(), `
		UPDATE services SET
			slug         = $2,
			title        = $3::jsonb,
			short_summary= $4::jsonb,
			description  = $5::jsonb,
			icon         = $6,
			category     = $7,
			sort_order   = $8,
			is_published = $9
		WHERE slug = $1`,
		slug, newSlug, titleJSON, summaryJSON, descJSON,
		icon, category, sortOrder, isPublished,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	row := h.DB.QueryRow(r.Context(), adminServiceSelect+` WHERE slug = $1`, newSlug)
	s, _ := scanAdminService(row)
	writeJSON(w, http.StatusOK, s)
}

// DELETE /api/cms/admin/services/{slug}
func (h *CMSHandler) AdminDeleteService(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM services WHERE slug = $1`, slug)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "service not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
