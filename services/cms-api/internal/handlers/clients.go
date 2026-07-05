package handlers

// clients.go — public consented-clients showcase.
//
// GET /api/cms/clients returns the customers the F2 team has been
// explicitly authorised to display: `is_active=TRUE`, `show_on_website=TRUE`,
// with a non-null `consent_granted_at` and an unexpired `consent_expires_at`.
// The DB has a CHECK constraint (customers_showcase_requires_consent) that
// blocks the toggle from ever going on without a granted date, so this
// query is defence-in-depth rather than the single source of truth.
//
// Gated behind `public.clients` at the router (main.go) — until F2 admin
// enables that module from /admin/features, the endpoint 404s.
//
// Locale handling mirrors ListCaseStudies: pass Accept-Language through
// `mw.LocaleFrom` and COALESCE the TH label onto the EN one.

import (
	"net/http"

	mw "github.com/f2cothai/f2-website/services/cms-api/internal/middleware"
)

type publicClient struct {
	Slug          string   `json:"slug"`
	DisplayName   string   `json:"display_name"`
	IndustryLabel string   `json:"industry_label"`
	LogoURL       *string  `json:"logo_url,omitempty"`
	ServicesUsed  []string `json:"services_used"`
	SortOrder     int      `json:"sort_order"`
}

// ListPublicClients — public, gated by module `public.clients`.
// Returns only rows where consent is on file and current.
func (h *CMSHandler) ListPublicClients(w http.ResponseWriter, r *http.Request) {
	loc := mw.LocaleFrom(r.Context())

	// COALESCE order for the industry label:
	//   TH request → website_industry_label_th → website_industry_label → industry
	//   EN request → website_industry_label → industry
	// We ignore the TH column when loc != 'th' by branching the SQL.
	const query = `
		SELECT slug,
		       COALESCE(NULLIF(website_display_name, ''), name)               AS display_name,
		       COALESCE(
		           CASE WHEN $1 = 'th' THEN NULLIF(website_industry_label_th, '') END,
		           NULLIF(website_industry_label, ''),
		           industry,
		           ''
		       )                                                              AS industry_label,
		       NULLIF(website_logo_url, '')                                   AS logo_url,
		       services_used,
		       website_sort_order
		  FROM customers
		 WHERE is_active            = TRUE
		   AND show_on_website      = TRUE
		   AND consent_granted_at   IS NOT NULL
		   AND (consent_expires_at IS NULL OR consent_expires_at > NOW())
		 ORDER BY website_sort_order, display_name`

	rows, err := h.DB.Query(r.Context(), query, loc)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()

	out := make([]publicClient, 0, 8)
	for rows.Next() {
		var c publicClient
		if err := rows.Scan(
			&c.Slug, &c.DisplayName, &c.IndustryLabel,
			&c.LogoURL, &c.ServicesUsed, &c.SortOrder,
		); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, map[string]any{"clients": out})
}
