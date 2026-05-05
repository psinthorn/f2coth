package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	mw "github.com/f2cothai/f2-website/services/cms-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/cms-api/internal/models"
)

type CMSHandler struct {
	DB *pgxpool.Pool
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// COALESCE pattern for translatable JSONB columns. We pass the locale as $1
// and 'en' as the implicit fallback. Empty string returns from missing keys
// also fall through (NULL only when the key is absent).

// -------------------- Services --------------------

func (h *CMSHandler) ListServices(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, slug,
               COALESCE(title->>$1,         title->>'en')         AS title,
               COALESCE(short_summary->>$1, short_summary->>'en') AS short_summary,
               COALESCE(description->>$1,   description->>'en')   AS description,
               icon, category, sort_order, is_published, created_at, updated_at
        FROM services WHERE is_published = TRUE
        ORDER BY sort_order, slug
    `, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]models.Service, 0, 16)
	for rows.Next() {
		var s models.Service
		if err := rows.Scan(&s.ID, &s.Slug, &s.Title, &s.ShortSummary, &s.Description,
			&s.Icon, &s.Category, &s.SortOrder, &s.IsPublished,
			&s.CreatedAt, &s.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": out})
}

func (h *CMSHandler) GetService(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	slug := chi.URLParam(r, "slug")
	var s models.Service
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, slug,
               COALESCE(title->>$1,         title->>'en')         AS title,
               COALESCE(short_summary->>$1, short_summary->>'en') AS short_summary,
               COALESCE(description->>$1,   description->>'en')   AS description,
               icon, category, sort_order, is_published, created_at, updated_at
        FROM services WHERE slug = $2 AND is_published = TRUE
    `, loc, slug).Scan(&s.ID, &s.Slug, &s.Title, &s.ShortSummary, &s.Description, &s.Icon,
		&s.Category, &s.SortOrder, &s.IsPublished, &s.CreatedAt, &s.UpdatedAt)
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

// -------------------- Case studies --------------------

func (h *CMSHandler) ListCaseStudies(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, slug, client_name, industry, location, relationship_years,
               hero_image_url,
               COALESCE(summary->>$1,    summary->>'en')    AS summary,
               COALESCE(challenge->>$1,  challenge->>'en')  AS challenge,
               COALESCE(solution->>$1,   solution->>'en')   AS solution,
               COALESCE(results->>$1,    results->>'en')    AS results,
               COALESCE(quote_text->>$1, quote_text->>'en') AS quote_text,
               quote_author, services_used, sort_order,
               is_published, published_at, created_at, updated_at
        FROM case_studies WHERE is_published = TRUE
        ORDER BY sort_order, client_name
    `, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.CaseStudy, 0, 8)
	for rows.Next() {
		var c models.CaseStudy
		if err := rows.Scan(&c.ID, &c.Slug, &c.ClientName, &c.Industry, &c.Location,
			&c.RelationshipYears, &c.HeroImageURL, &c.Summary, &c.Challenge,
			&c.Solution, &c.Results, &c.QuoteText, &c.QuoteAuthor,
			&c.ServicesUsed, &c.SortOrder, &c.IsPublished, &c.PublishedAt,
			&c.CreatedAt, &c.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"case_studies": out})
}

func (h *CMSHandler) GetCaseStudy(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	slug := chi.URLParam(r, "slug")
	var c models.CaseStudy
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, slug, client_name, industry, location, relationship_years,
               hero_image_url,
               COALESCE(summary->>$1,    summary->>'en')    AS summary,
               COALESCE(challenge->>$1,  challenge->>'en')  AS challenge,
               COALESCE(solution->>$1,   solution->>'en')   AS solution,
               COALESCE(results->>$1,    results->>'en')    AS results,
               COALESCE(quote_text->>$1, quote_text->>'en') AS quote_text,
               quote_author, services_used, sort_order,
               is_published, published_at, created_at, updated_at
        FROM case_studies WHERE slug = $2 AND is_published = TRUE
    `, loc, slug).Scan(&c.ID, &c.Slug, &c.ClientName, &c.Industry, &c.Location,
		&c.RelationshipYears, &c.HeroImageURL, &c.Summary, &c.Challenge,
		&c.Solution, &c.Results, &c.QuoteText, &c.QuoteAuthor,
		&c.ServicesUsed, &c.SortOrder, &c.IsPublished, &c.PublishedAt,
		&c.CreatedAt, &c.UpdatedAt)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "case study not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// -------------------- Blog posts --------------------

func (h *CMSHandler) ListBlogPosts(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, slug,
               COALESCE(title->>$1,   title->>'en')   AS title,
               COALESCE(excerpt->>$1, excerpt->>'en') AS excerpt,
               COALESCE(body_md->>$1, body_md->>'en') AS body_md,
               cover_image_url, author_id, tags,
               is_published, published_at, created_at, updated_at
        FROM blog_posts WHERE is_published = TRUE
        ORDER BY published_at DESC NULLS LAST, created_at DESC
        LIMIT 50
    `, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.BlogPost, 0, 16)
	for rows.Next() {
		var p models.BlogPost
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Excerpt, &p.BodyMD,
			&p.CoverImageURL, &p.AuthorID, &p.Tags, &p.IsPublished,
			&p.PublishedAt, &p.CreatedAt, &p.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": out})
}

func (h *CMSHandler) GetBlogPost(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	slug := chi.URLParam(r, "slug")
	var p models.BlogPost
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, slug,
               COALESCE(title->>$1,   title->>'en')   AS title,
               COALESCE(excerpt->>$1, excerpt->>'en') AS excerpt,
               COALESCE(body_md->>$1, body_md->>'en') AS body_md,
               cover_image_url, author_id, tags,
               is_published, published_at, created_at, updated_at
        FROM blog_posts WHERE slug = $2 AND is_published = TRUE
    `, loc, slug).Scan(&p.ID, &p.Slug, &p.Title, &p.Excerpt, &p.BodyMD, &p.CoverImageURL,
		&p.AuthorID, &p.Tags, &p.IsPublished, &p.PublishedAt, &p.CreatedAt, &p.UpdatedAt)
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

// -------------------- Domain pricing --------------------

func (h *CMSHandler) ListDomainPricing(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, tld, registry, register_price_thb, renew_price_thb, transfer_price_thb,
               privacy_included, is_thai_only,
               COALESCE(notes->>$1, notes->>'en', '') AS notes,
               sort_order, is_active, created_at, updated_at
        FROM domain_pricing WHERE is_active = TRUE
        ORDER BY sort_order, tld
    `, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.DomainPricing, 0, 16)
	for rows.Next() {
		var d models.DomainPricing
		if err := rows.Scan(&d.ID, &d.TLD, &d.Registry, &d.RegisterPriceTHB, &d.RenewPriceTHB,
			&d.TransferPriceTHB, &d.PrivacyIncluded, &d.IsThaiOnly, &d.Notes,
			&d.SortOrder, &d.IsActive, &d.CreatedAt, &d.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, map[string]any{"domain_pricing": out})
}

// -------------------- Hosting plans --------------------

func (h *CMSHandler) ListHostingPlans(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	// perks is { en: [...], th: [...] } — COALESCE the locale's array, fall back to en.
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, slug,
               COALESCE(name->>$1,            name->>'en')            AS name,
               COALESCE(tagline->>$1,         tagline->>'en')         AS tagline,
               price_thb_monthly, price_thb_annually,
               storage_gb, sites_included, emails_included,
               COALESCE(bandwidth_label->>$1, bandwidth_label->>'en') AS bandwidth_label,
               ssl_included, daily_backups,
               COALESCE(perks->$1, perks->'en', '[]'::jsonb)          AS perks,
               is_featured, sort_order, is_published, created_at, updated_at
        FROM hosting_plans WHERE is_published = TRUE
        ORDER BY sort_order, slug
    `, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.HostingPlan, 0, 4)
	for rows.Next() {
		var p models.HostingPlan
		var perksJSON []byte
		if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.Tagline,
			&p.PriceTHBMonthly, &p.PriceTHBAnnually,
			&p.StorageGB, &p.SitesIncluded, &p.EmailsIncluded,
			&p.BandwidthLabel, &p.SSLIncluded, &p.DailyBackups,
			&perksJSON, &p.IsFeatured, &p.SortOrder, &p.IsPublished,
			&p.CreatedAt, &p.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		p.Perks = []string{}
		if len(perksJSON) > 0 {
			_ = json.Unmarshal(perksJSON, &p.Perks)
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosting_plans": out})
}

// -------------------- Pages --------------------

func (h *CMSHandler) GetPage(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	slug := chi.URLParam(r, "slug")
	var p models.Page
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, slug,
               COALESCE(title->>$1,           title->>'en')           AS title,
               COALESCE(body_md->>$1,         body_md->>'en')         AS body_md,
               COALESCE(seo_title->>$1,       seo_title->>'en')       AS seo_title,
               COALESCE(seo_description->>$1, seo_description->>'en') AS seo_description,
               is_published, created_at, updated_at
        FROM pages WHERE slug = $2 AND is_published = TRUE
    `, loc, slug).Scan(&p.ID, &p.Slug, &p.Title, &p.BodyMD, &p.SEOTitle, &p.SEODescription,
		&p.IsPublished, &p.CreatedAt, &p.UpdatedAt)
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
