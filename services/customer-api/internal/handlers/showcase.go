package handlers

// showcase.go — PATCH /admin/customers/{id}/showcase.
//
// One dedicated endpoint for every "public showcase" and "consent" field on
// the customers row (migration 046). Kept out of the generic UpdateCustomer
// so:
//   1) every consent change is a single audit_log row (mandatory for PDPA
//      compliance, มาตรา 24 record-keeping)
//   2) the server can enforce the same rule the DB CHECK does — flipping
//      show_on_website=TRUE requires a non-null consent_granted_at — with a
//      helpful 409 message before the transaction hits the constraint
//   3) the UI can call one endpoint atomically instead of stitching together
//      multiple PATCHes

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
)

// showcaseReq mirrors the customer's showcase + consent columns. Every
// field is a pointer so "not present in JSON" means "leave unchanged",
// while an explicit JSON null clears the value. This lets the admin UI
// PATCH only the field the user touched without stomping others.
type showcaseReq struct {
	ShowOnWebsite          *bool      `json:"show_on_website"`
	WebsiteDisplayName     *string    `json:"website_display_name"`
	WebsiteLogoURL         *string    `json:"website_logo_url"`
	WebsiteIndustryLabel   *string    `json:"website_industry_label"`
	WebsiteIndustryLabelTH *string    `json:"website_industry_label_th"`
	WebsiteSortOrder       *int       `json:"website_sort_order"`
	ConsentDocumentURL     *string    `json:"consent_document_url"`
	ConsentGrantedAt       *time.Time `json:"consent_granted_at"`
	ConsentGrantedBy       *string    `json:"consent_granted_by"`
	ConsentExpiresAt       *time.Time `json:"consent_expires_at"`
	ConsentNotes           *string    `json:"consent_notes"`
}

// beforeShowcase is the row snapshot we take under the tx for both the
// pre-flight consent guard and the audit diff.
type beforeShowcase struct {
	ShowOnWebsite          bool
	WebsiteDisplayName     *string
	WebsiteLogoURL         *string
	WebsiteIndustryLabel   *string
	WebsiteIndustryLabelTH *string
	WebsiteSortOrder       int
	ConsentDocumentURL     *string
	ConsentGrantedAt       *time.Time
	ConsentGrantedBy       *string
	ConsentExpiresAt       *time.Time
	ConsentNotes           *string
}

func (h *AdminHandler) UpdateShowcase(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req showcaseReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx begin failed")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var before beforeShowcase
	err = tx.QueryRow(ctx, `
		SELECT show_on_website, website_display_name, website_logo_url,
		       website_industry_label, website_industry_label_th, website_sort_order,
		       consent_document_url, consent_granted_at, consent_granted_by,
		       consent_expires_at, consent_notes
		  FROM customers WHERE id = $1`, id,
	).Scan(&before.ShowOnWebsite, &before.WebsiteDisplayName, &before.WebsiteLogoURL,
		&before.WebsiteIndustryLabel, &before.WebsiteIndustryLabelTH, &before.WebsiteSortOrder,
		&before.ConsentDocumentURL, &before.ConsentGrantedAt, &before.ConsentGrantedBy,
		&before.ConsentExpiresAt, &before.ConsentNotes)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// Pre-flight guard — matches the DB CHECK customers_showcase_requires_consent.
	// Compute what show_on_website and consent_granted_at would be after this PATCH.
	effectiveShow := before.ShowOnWebsite
	if req.ShowOnWebsite != nil {
		effectiveShow = *req.ShowOnWebsite
	}
	effectiveGranted := before.ConsentGrantedAt
	if req.ConsentGrantedAt != nil {
		effectiveGranted = req.ConsentGrantedAt
	}
	if effectiveShow && effectiveGranted == nil {
		writeErr(w, http.StatusConflict,
			"cannot enable show_on_website without a consent_granted_at date")
		return
	}

	if _, err := tx.Exec(ctx, `
		UPDATE customers SET
		    show_on_website           = COALESCE($2,  show_on_website),
		    website_display_name      = CASE WHEN $3::bool  THEN $4  ELSE website_display_name       END,
		    website_logo_url          = CASE WHEN $5::bool  THEN $6  ELSE website_logo_url           END,
		    website_industry_label    = CASE WHEN $7::bool  THEN $8  ELSE website_industry_label     END,
		    website_industry_label_th = CASE WHEN $9::bool  THEN $10 ELSE website_industry_label_th  END,
		    website_sort_order        = COALESCE($11, website_sort_order),
		    consent_document_url      = CASE WHEN $12::bool THEN $13 ELSE consent_document_url       END,
		    consent_granted_at        = CASE WHEN $14::bool THEN $15 ELSE consent_granted_at         END,
		    consent_granted_by        = CASE WHEN $16::bool THEN $17 ELSE consent_granted_by         END,
		    consent_expires_at        = CASE WHEN $18::bool THEN $19 ELSE consent_expires_at         END,
		    consent_notes             = CASE WHEN $20::bool THEN $21 ELSE consent_notes              END
		 WHERE id = $1`,
		id,
		req.ShowOnWebsite,
		req.WebsiteDisplayName != nil, req.WebsiteDisplayName,
		req.WebsiteLogoURL != nil, req.WebsiteLogoURL,
		req.WebsiteIndustryLabel != nil, req.WebsiteIndustryLabel,
		req.WebsiteIndustryLabelTH != nil, req.WebsiteIndustryLabelTH,
		req.WebsiteSortOrder,
		req.ConsentDocumentURL != nil, req.ConsentDocumentURL,
		req.ConsentGrantedAt != nil, req.ConsentGrantedAt,
		req.ConsentGrantedBy != nil, req.ConsentGrantedBy,
		req.ConsentExpiresAt != nil, req.ConsentExpiresAt,
		req.ConsentNotes != nil, req.ConsentNotes,
	); err != nil {
		if strings.Contains(err.Error(), "customers_showcase_requires_consent") {
			writeErr(w, http.StatusConflict,
				"cannot enable show_on_website without a consent_granted_at date")
			return
		}
		writeErr(w, http.StatusInternalServerError, "update failed")
		return
	}

	diff := showcaseDiff(before, req)
	if len(diff) > 0 {
		if err := writeAudit(ctx, tx, "customer_showcase", id, staffID(r), "update", diff); err != nil {
			writeErr(w, http.StatusInternalServerError, "audit failed")
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}

	// Read back the full updated row so the UI can refresh state in one round-trip.
	var c models.Customer
	if err := scanCustomer(
		h.DB.QueryRow(ctx, customerSelect+` WHERE c.id = $1`, id), &c,
	); err != nil {
		writeErr(w, http.StatusInternalServerError, "read-back failed")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// showcaseDiff → { field: {from, to}, ... } for audit_log. Only fields
// that were sent AND actually changed are included, keeping payloads small.
func showcaseDiff(before beforeShowcase, req showcaseReq) map[string]any {
	d := map[string]any{}
	if req.ShowOnWebsite != nil && *req.ShowOnWebsite != before.ShowOnWebsite {
		d["show_on_website"] = map[string]any{"from": before.ShowOnWebsite, "to": *req.ShowOnWebsite}
	}
	if req.WebsiteDisplayName != nil && !strPtrEq(req.WebsiteDisplayName, before.WebsiteDisplayName) {
		d["website_display_name"] = map[string]any{"from": before.WebsiteDisplayName, "to": *req.WebsiteDisplayName}
	}
	if req.WebsiteLogoURL != nil && !strPtrEq(req.WebsiteLogoURL, before.WebsiteLogoURL) {
		d["website_logo_url"] = map[string]any{"from": before.WebsiteLogoURL, "to": *req.WebsiteLogoURL}
	}
	if req.WebsiteIndustryLabel != nil && !strPtrEq(req.WebsiteIndustryLabel, before.WebsiteIndustryLabel) {
		d["website_industry_label"] = map[string]any{"from": before.WebsiteIndustryLabel, "to": *req.WebsiteIndustryLabel}
	}
	if req.WebsiteIndustryLabelTH != nil && !strPtrEq(req.WebsiteIndustryLabelTH, before.WebsiteIndustryLabelTH) {
		d["website_industry_label_th"] = map[string]any{"from": before.WebsiteIndustryLabelTH, "to": *req.WebsiteIndustryLabelTH}
	}
	if req.WebsiteSortOrder != nil && *req.WebsiteSortOrder != before.WebsiteSortOrder {
		d["website_sort_order"] = map[string]any{"from": before.WebsiteSortOrder, "to": *req.WebsiteSortOrder}
	}
	if req.ConsentDocumentURL != nil && !strPtrEq(req.ConsentDocumentURL, before.ConsentDocumentURL) {
		d["consent_document_url"] = map[string]any{"from": before.ConsentDocumentURL, "to": *req.ConsentDocumentURL}
	}
	if req.ConsentGrantedAt != nil && !timePtrEq(req.ConsentGrantedAt, before.ConsentGrantedAt) {
		d["consent_granted_at"] = map[string]any{"from": before.ConsentGrantedAt, "to": req.ConsentGrantedAt}
	}
	if req.ConsentGrantedBy != nil && !strPtrEq(req.ConsentGrantedBy, before.ConsentGrantedBy) {
		d["consent_granted_by"] = map[string]any{"from": before.ConsentGrantedBy, "to": *req.ConsentGrantedBy}
	}
	if req.ConsentExpiresAt != nil && !timePtrEq(req.ConsentExpiresAt, before.ConsentExpiresAt) {
		d["consent_expires_at"] = map[string]any{"from": before.ConsentExpiresAt, "to": req.ConsentExpiresAt}
	}
	if req.ConsentNotes != nil && !strPtrEq(req.ConsentNotes, before.ConsentNotes) {
		d["consent_notes"] = map[string]any{"from": before.ConsentNotes, "to": *req.ConsentNotes}
	}
	return d
}

// ListShowcaseAudit — admin. Returns the recent audit_log rows for a
// customer's showcase/consent changes so the UI can render a compliance
// history panel. GET /customers/{id}/showcase/audit?limit=50
func (h *AdminHandler) ListShowcaseAudit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	rows, err := h.DB.Query(r.Context(), `
		SELECT actor_email, action, changes, at::text
		  FROM audit_log
		 WHERE resource_type = 'customer_showcase' AND resource_id = $1
		 ORDER BY at DESC
		 LIMIT 50`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	type entry struct {
		ActorEmail *string        `json:"actor_email,omitempty"`
		Action     string         `json:"action"`
		Changes    map[string]any `json:"changes"`
		At         string         `json:"at"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		var changesRaw []byte
		if err := rows.Scan(&e.ActorEmail, &e.Action, &changesRaw, &e.At); err != nil {
			continue
		}
		_ = json.Unmarshal(changesRaw, &e.Changes)
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

func strPtrEq(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func timePtrEq(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}
