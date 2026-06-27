package handlers

// admin_blog.go — CRUD endpoints for blog posts, admin/editor only.
//
// All endpoints require a valid staff JWT with role "admin" or "editor".
// They return and accept the raw JSONB for both locales so the editor can
// manage EN + TH content in one request.
//
// Routes (under /api/cms/admin/blog):
//   GET    /         — list all posts (incl. drafts), newest first
//   POST   /         — create a new post
//   GET    /{slug}   — get single post (all fields, both locales)
//   PATCH  /{slug}   — update any subset of fields
//   DELETE /{slug}   — hard-delete (irreversible; editor UI should confirm)

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
)

// ── Auth middleware ──────────────────────────────────────────────────────────

// RequireAdminOrEditor is a chi middleware that validates the Bearer JWT and
// allows only staff roles "admin" or "editor". Reuses the same HS256 secret
// as auth-api so no new infrastructure is needed.
func (h *CMSHandler) RequireAdminOrEditor(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.JWTSecret == "" {
			writeErr(w, http.StatusServiceUnavailable, "admin endpoints not configured")
			return
		}
		bearer := r.Header.Get("Authorization")
		if !strings.HasPrefix(bearer, "Bearer ") {
			writeErr(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		tokenStr := strings.TrimPrefix(bearer, "Bearer ")
		claims := jwt.MapClaims{}
		tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrTokenSignatureInvalid
			}
			return []byte(h.JWTSecret), nil
		})
		if err != nil || !tok.Valid {
			writeErr(w, http.StatusUnauthorized, "invalid token")
			return
		}
		role, _ := claims["role"].(string)
		if role != "admin" && role != "editor" {
			writeErr(w, http.StatusForbidden, "admin or editor required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Admin types ──────────────────────────────────────────────────────────────

// AdminBlogPost returns the raw JSONB objects for title/excerpt/body_md so
// the admin UI can render both EN and TH fields in one response.
type AdminBlogPost struct {
	ID            string            `json:"id"`
	Slug          string            `json:"slug"`
	Title         map[string]string `json:"title"`
	Excerpt       map[string]string `json:"excerpt"`
	BodyMD        map[string]string `json:"body_md"`
	CoverImageURL *string           `json:"cover_image_url,omitempty"`
	AuthorID      *string           `json:"author_id,omitempty"`
	Tags          []string          `json:"tags"`
	IsPublished   bool              `json:"is_published"`
	PublishedAt   *time.Time        `json:"published_at,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

type blogWriteReq struct {
	Slug          string   `json:"slug"`
	TitleEN       string   `json:"title_en"`
	TitleTH       string   `json:"title_th"`
	ExcerptEN     string   `json:"excerpt_en"`
	ExcerptTH     string   `json:"excerpt_th"`
	BodyMDEN      string   `json:"body_md_en"`
	BodyMDTH      string   `json:"body_md_th"`
	CoverImageURL *string  `json:"cover_image_url"`
	Tags          []string `json:"tags"`
	IsPublished   *bool    `json:"is_published"`
	PublishedAt   *string  `json:"published_at"` // ISO8601 or null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func scanAdminPost(row interface {
	Scan(...any) error
}) (AdminBlogPost, error) {
	var p AdminBlogPost
	var titleRaw, excerptRaw, bodyRaw []byte
	var tagsRaw []byte
	err := row.Scan(
		&p.ID, &p.Slug,
		&titleRaw, &excerptRaw, &bodyRaw,
		&p.CoverImageURL, &p.AuthorID,
		&tagsRaw, &p.IsPublished, &p.PublishedAt,
		&p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		return p, err
	}
	p.Title = map[string]string{}
	p.Excerpt = map[string]string{}
	p.BodyMD = map[string]string{}
	p.Tags = []string{}
	_ = json.Unmarshal(titleRaw, &p.Title)
	_ = json.Unmarshal(excerptRaw, &p.Excerpt)
	_ = json.Unmarshal(bodyRaw, &p.BodyMD)
	_ = json.Unmarshal(tagsRaw, &p.Tags)
	return p, nil
}

const adminBlogSelect = `
SELECT id, slug, title, excerpt, body_md,
       cover_image_url, author_id::text,
       to_json(tags) AS tags,
       is_published, published_at, created_at, updated_at
FROM blog_posts`

// ── Handlers ─────────────────────────────────────────────────────────────────

// GET /api/cms/admin/blog
func (h *CMSHandler) AdminListBlogPosts(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(),
		adminBlogSelect+` ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]AdminBlogPost, 0, 32)
	for rows.Next() {
		p, err := scanAdminPost(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": out})
}

// GET /api/cms/admin/blog/{slug}
func (h *CMSHandler) AdminGetBlogPost(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row := h.DB.QueryRow(r.Context(), adminBlogSelect+` WHERE slug = $1`, slug)
	p, err := scanAdminPost(row)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "post not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// POST /api/cms/admin/blog
func (h *CMSHandler) AdminCreateBlogPost(w http.ResponseWriter, r *http.Request) {
	var req blogWriteReq
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
	if req.Tags == nil {
		req.Tags = []string{}
	}
	isPublished := req.IsPublished != nil && *req.IsPublished

	titleJSON, _ := json.Marshal(map[string]string{"en": req.TitleEN, "th": req.TitleTH})
	excerptJSON, _ := json.Marshal(map[string]string{"en": req.ExcerptEN, "th": req.ExcerptTH})
	bodyJSON, _ := json.Marshal(map[string]string{"en": req.BodyMDEN, "th": req.BodyMDTH})

	var publishedAt *time.Time
	if req.PublishedAt != nil && *req.PublishedAt != "" {
		t, err := time.Parse(time.RFC3339, *req.PublishedAt)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "published_at must be RFC3339")
			return
		}
		publishedAt = &t
	} else if isPublished {
		now := time.Now().UTC()
		publishedAt = &now
	}

	row := h.DB.QueryRow(r.Context(), `
		INSERT INTO blog_posts (slug, title, excerpt, body_md, cover_image_url, tags, is_published, published_at)
		VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7, $8)
		RETURNING id`,
		req.Slug, titleJSON, excerptJSON, bodyJSON,
		req.CoverImageURL, req.Tags, isPublished, publishedAt,
	)
	var id string
	if err := row.Scan(&id); err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create post")
		return
	}

	// Return the full post
	pRow := h.DB.QueryRow(r.Context(), adminBlogSelect+` WHERE id = $1`, id)
	p, _ := scanAdminPost(pRow)
	writeJSON(w, http.StatusCreated, p)
}

// PATCH /api/cms/admin/blog/{slug}
func (h *CMSHandler) AdminUpdateBlogPost(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var req blogWriteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	// Fetch current to merge partial updates
	pRow := h.DB.QueryRow(r.Context(), adminBlogSelect+` WHERE slug = $1`, slug)
	cur, err := scanAdminPost(pRow)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "post not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// Merge: only update fields that were sent (non-empty or explicit)
	newTitle := cur.Title
	if req.TitleEN != "" {
		newTitle["en"] = req.TitleEN
	}
	if req.TitleTH != "" {
		newTitle["th"] = req.TitleTH
	}
	newExcerpt := cur.Excerpt
	if req.ExcerptEN != "" {
		newExcerpt["en"] = req.ExcerptEN
	}
	if req.ExcerptTH != "" {
		newExcerpt["th"] = req.ExcerptTH
	}
	newBody := cur.BodyMD
	if req.BodyMDEN != "" {
		newBody["en"] = req.BodyMDEN
	}
	if req.BodyMDTH != "" {
		newBody["th"] = req.BodyMDTH
	}

	titleJSON, _ := json.Marshal(newTitle)
	excerptJSON, _ := json.Marshal(newExcerpt)
	bodyJSON, _ := json.Marshal(newBody)

	isPublished := cur.IsPublished
	if req.IsPublished != nil {
		isPublished = *req.IsPublished
	}

	coverURL := cur.CoverImageURL
	if req.CoverImageURL != nil {
		coverURL = req.CoverImageURL
	}

	tags := cur.Tags
	if req.Tags != nil {
		tags = req.Tags
	}

	var publishedAt *time.Time
	if req.PublishedAt != nil {
		if *req.PublishedAt == "" {
			publishedAt = nil
		} else {
			t, err := time.Parse(time.RFC3339, *req.PublishedAt)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "published_at must be RFC3339")
				return
			}
			publishedAt = &t
		}
	} else if cur.PublishedAt != nil {
		publishedAt = cur.PublishedAt
	} else if isPublished && !cur.IsPublished {
		// Transitioning to published without an explicit date — set now.
		now := time.Now().UTC()
		publishedAt = &now
	}

	newSlug := cur.Slug
	if req.Slug != "" {
		newSlug = strings.TrimSpace(strings.ToLower(req.Slug))
	}

	_, err = h.DB.Exec(r.Context(), `
		UPDATE blog_posts SET
			slug           = $2,
			title          = $3::jsonb,
			excerpt        = $4::jsonb,
			body_md        = $5::jsonb,
			cover_image_url= $6,
			tags           = $7,
			is_published   = $8,
			published_at   = $9
		WHERE slug = $1`,
		slug, newSlug, titleJSON, excerptJSON, bodyJSON,
		coverURL, tags, isPublished, publishedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") {
			writeErr(w, http.StatusConflict, "slug already exists")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}

	updated := h.DB.QueryRow(r.Context(), adminBlogSelect+` WHERE slug = $1`, newSlug)
	p, _ := scanAdminPost(updated)
	writeJSON(w, http.StatusOK, p)
}

// DELETE /api/cms/admin/blog/{slug}
func (h *CMSHandler) AdminDeleteBlogPost(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM blog_posts WHERE slug = $1`, slug)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "delete failed")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "post not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
