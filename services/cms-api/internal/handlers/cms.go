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
	DB        *pgxpool.Pool
	JWTSecret string
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

// scanService reads the common service columns + intro/faq JSONB into the
// model. Shared so ListServices and GetService stay identical in shape —
// prevents "list has faq, detail doesn't" drift.
func scanService(row interface{ Scan(...any) error }, s *models.Service) error {
	var faqRaw []byte
	if err := row.Scan(&s.ID, &s.Slug, &s.Title, &s.ShortSummary, &s.Description,
		&s.Intro, &faqRaw, &s.Icon, &s.Category, &s.SortOrder, &s.IsPublished,
		&s.CreatedAt, &s.UpdatedAt); err != nil {
		return err
	}
	if len(faqRaw) > 0 {
		_ = json.Unmarshal(faqRaw, &s.FAQ)
	}
	if s.FAQ == nil {
		s.FAQ = []models.FAQItem{}
	}
	return nil
}

// serviceSelect is the SELECT list every service query uses. Keep in one
// place so a new column doesn't need to be added in two spots.
const serviceSelect = `
    SELECT id, slug,
           COALESCE(title->>$1,         title->>'en')         AS title,
           COALESCE(short_summary->>$1, short_summary->>'en') AS short_summary,
           COALESCE(description->>$1,   description->>'en')   AS description,
           COALESCE(intro->>$1,         intro->>'en', '')     AS intro,
           COALESCE(faq->$1,            faq->'en', '[]')      AS faq,
           icon, category, sort_order, is_published, created_at, updated_at
      FROM services`

func (h *CMSHandler) ListServices(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(),
		serviceSelect+` WHERE is_published = TRUE ORDER BY sort_order, slug`, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]models.Service, 0, 16)
	for rows.Next() {
		var s models.Service
		if err := scanService(rows, &s); err != nil {
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
	err := scanService(
		h.DB.QueryRow(r.Context(), serviceSelect+` WHERE slug = $2 AND is_published = TRUE`, loc, slug),
		&s,
	)
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

// blogSelect is shared by list + detail so a schema change only needs
// editing here. Joins users to surface a display author name — falls
// back to "F2 Editorial Team" when author_id is NULL.
const blogSelect = `
    SELECT b.id, b.slug,
           COALESCE(b.title->>$1,   b.title->>'en')   AS title,
           COALESCE(b.excerpt->>$1, b.excerpt->>'en') AS excerpt,
           COALESCE(b.body_md->>$1, b.body_md->>'en') AS body_md,
           b.cover_image_url, b.author_id,
           COALESCE(u.full_name, 'F2 Editorial Team') AS author_name,
           b.tags, b.is_published, b.published_at, b.created_at, b.updated_at
      FROM blog_posts b
      LEFT JOIN users u ON u.id = b.author_id`

func scanBlogPost(row interface{ Scan(...any) error }, p *models.BlogPost) error {
	return row.Scan(&p.ID, &p.Slug, &p.Title, &p.Excerpt, &p.BodyMD,
		&p.CoverImageURL, &p.AuthorID, &p.AuthorName, &p.Tags,
		&p.IsPublished, &p.PublishedAt, &p.CreatedAt, &p.UpdatedAt)
}

func (h *CMSHandler) ListBlogPosts(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())
	rows, err := h.DB.Query(r.Context(),
		blogSelect+` WHERE b.is_published = TRUE
		 ORDER BY b.published_at DESC NULLS LAST, b.created_at DESC LIMIT 50`, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.BlogPost, 0, 16)
	for rows.Next() {
		var p models.BlogPost
		if err := scanBlogPost(rows, &p); err != nil {
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
	err := scanBlogPost(
		h.DB.QueryRow(r.Context(),
			blogSelect+` WHERE b.slug = $2 AND b.is_published = TRUE`, loc, slug),
		&p,
	)
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
               grace_period_days, redemption_period_days, grace_fee_thb, redemption_fee_thb,
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
			&d.TransferPriceTHB, &d.PrivacyIncluded, &d.IsThaiOnly,
			&d.GracePeriodDays, &d.RedemptionPeriodDays, &d.GraceFeeTHB, &d.RedemptionFeeTHB,
			&d.Notes, &d.SortOrder, &d.IsActive, &d.CreatedAt, &d.UpdatedAt); err != nil {
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
