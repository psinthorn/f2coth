package handlers

// admin_pages.go — CRUD for the `pages` table used by About / Privacy /
// Terms / DPA and any custom static pages. Editors get raw {en, th} pairs
// for each translatable column; the public GetPage handler in cms.go
// resolves them via COALESCE for the requested locale.
//
// Routes (/api/cms/admin/pages):
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

type AdminPage struct {
	ID             string            `json:"id"`
	Slug           string            `json:"slug"`
	Title          map[string]string `json:"title"`
	BodyMD         map[string]string `json:"body_md"`
	SEOTitle       map[string]string `json:"seo_title"`
	SEODescription map[string]string `json:"seo_description"`
	IsPublished    bool              `json:"is_published"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}

type pageWriteReq struct {
	Slug             string `json:"slug"`
	TitleEN          string `json:"title_en"`
	TitleTH          string `json:"title_th"`
	BodyMDEN         string `json:"body_md_en"`
	BodyMDTH         string `json:"body_md_th"`
	SEOTitleEN       string `json:"seo_title_en"`
	SEOTitleTH       string `json:"seo_title_th"`
	SEODescriptionEN string `json:"seo_description_en"`
	SEODescriptionTH string `json:"seo_description_th"`
	IsPublished      *bool  `json:"is_published"`
}

const adminPageSelect = `
SELECT id, slug, title, body_md, seo_title, seo_description,
       is_published, created_at, updated_at
FROM pages`

func scanAdminPage(row interface {
	Scan(...any) error
}) (AdminPage, error) {
	var p AdminPage
	var titleRaw, bodyRaw, seoTitleRaw, seoDescRaw []byte
	err := row.Scan(&p.ID, &p.Slug, &titleRaw, &bodyRaw, &seoTitleRaw, &seoDescRaw,
		&p.IsPublished, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return p, err
	}
	p.Title = map[string]string{}
	p.BodyMD = map[string]string{}
	p.SEOTitle = map[string]string{}
	p.SEODescription = map[string]string{}
	_ = json.Unmarshal(titleRaw, &p.Title)
	_ = json.Unmarshal(bodyRaw, &p.BodyMD)
	_ = json.Unmarshal(seoTitleRaw, &p.SEOTitle)
	_ = json.Unmarshal(seoDescRaw, &p.SEODescription)
	return p, nil
}

// GET /api/cms/admin/pages
func (h *CMSHandler) AdminListPages(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), adminPageSelect+` ORDER BY slug LIMIT 200`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]AdminPage, 0, 16)
	for rows.Next() {
		p, err := scanAdminPage(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"pages": out})
}

// GET /api/cms/admin/pages/{slug}
func (h *CMSHandler) AdminGetPage(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row := h.DB.QueryRow(r.Context(), adminPageSelect+` WHERE slug = $1`, slug)
	p, err := scanAdminPage(row)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// POST /api/cms/admin/pages
func (h *CMSHandler) AdminCreatePage(w http.ResponseWriter, r *http.Request) {
	var req pageWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.TitleEN = strings.TrimSpace(req.TitleEN)
	if req.Slug == "" || req.TitleEN == "" {
		writeErr(w, http.StatusBadRequest, "slug and title_en are required")
		return
	}
	isPublished := true
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}

	titleJSON, _ := json.Marshal(map[string]string{"en": req.TitleEN, "th": req.TitleTH})
	bodyJSON, _ := json.Marshal(map[string]string{"en": req.BodyMDEN, "th": req.BodyMDTH})
	seoTitleJSON, _ := json.Marshal(map[string]string{"en": req.SEOTitleEN, "th": req.SEOTitleTH})
	seoDescJSON, _ := json.Marshal(map[string]string{"en": req.SEODescriptionEN, "th": req.SEODescriptionTH})

	var id string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO pages (slug, title, body_md, seo_title, seo_description, is_published)
		VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6)
		RETURNING id`,
		req.Slug, titleJSON, bodyJSON, seoTitleJSON, seoDescJSON, isPublished,
	).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "create failed")
		return
	}
	row := h.DB.QueryRow(r.Context(), adminPageSelect+` WHERE id = $1`, id)
	p, _ := scanAdminPage(row)
	writeJSON(w, http.StatusCreated, p)
}

// PATCH /api/cms/admin/pages/{slug}
func (h *CMSHandler) AdminUpdatePage(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var req pageWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	pRow := h.DB.QueryRow(r.Context(), adminPageSelect+` WHERE slug = $1`, slug)
	cur, err := scanAdminPage(pRow)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "page not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// For a page editor, empty-string means "clear this locale" — unlike blog
	// where empty means "unchanged". A CMS page might legitimately have
	// empty body_md for one locale (page renders in the other locale only).
	// So we always overwrite with what the request sent.
	setStr := func(cur map[string]string, en, th string) map[string]string {
		out := map[string]string{"en": en, "th": th}
		// Preserve nil-safety: if request sent empty and DB had a value, and
		// the caller sent both fields blank, that's still a valid "clear"
		// operation. But keep unrelated locales if only one field was sent.
		if en == "" && cur["en"] != "" && th == "" {
			// Both blank AND existing values present → treat as "no change"
			return cur
		}
		return out
	}
	newTitle := setStr(cur.Title, req.TitleEN, req.TitleTH)
	newBody := setStr(cur.BodyMD, req.BodyMDEN, req.BodyMDTH)
	newSEOTitle := setStr(cur.SEOTitle, req.SEOTitleEN, req.SEOTitleTH)
	newSEODesc := setStr(cur.SEODescription, req.SEODescriptionEN, req.SEODescriptionTH)

	isPublished := cur.IsPublished
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}
	newSlug := cur.Slug
	if req.Slug != "" {
		newSlug = strings.TrimSpace(strings.ToLower(req.Slug))
	}

	titleJSON, _ := json.Marshal(newTitle)
	bodyJSON, _ := json.Marshal(newBody)
	seoTitleJSON, _ := json.Marshal(newSEOTitle)
	seoDescJSON, _ := json.Marshal(newSEODesc)

	_, err = h.DB.Exec(r.Context(), `
		UPDATE pages SET
			slug            = $2,
			title           = $3::jsonb,
			body_md         = $4::jsonb,
			seo_title       = $5::jsonb,
			seo_description = $6::jsonb,
			is_published    = $7
		WHERE slug = $1`,
		slug, newSlug, titleJSON, bodyJSON, seoTitleJSON, seoDescJSON, isPublished,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}
	row := h.DB.QueryRow(r.Context(), adminPageSelect+` WHERE slug = $1`, newSlug)
	p, _ := scanAdminPage(row)
	writeJSON(w, http.StatusOK, p)
}

// DELETE /api/cms/admin/pages/{slug}
func (h *CMSHandler) AdminDeletePage(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM pages WHERE slug = $1`, slug)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "page not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
