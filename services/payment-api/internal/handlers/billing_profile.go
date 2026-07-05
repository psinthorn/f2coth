package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// BillingProfileHandler is the admin CRUD for customer_billing_profiles.
// Used by the Thai tax-invoice flow — issuing a tax_invoice snapshots
// this row into invoices.billing_snapshot so later edits don't mutate
// historical documents.
type BillingProfileHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type billingProfile struct {
	CustomerID   string  `json:"customer_id"`
	LegalName    string  `json:"legal_name"`
	TaxID        *string `json:"tax_id,omitempty"`
	BranchCode   string  `json:"branch_code"`
	AddressLine1 *string `json:"address_line1,omitempty"`
	AddressLine2 *string `json:"address_line2,omitempty"`
	Subdistrict  *string `json:"subdistrict,omitempty"`
	District     *string `json:"district,omitempty"`
	Province     *string `json:"province,omitempty"`
	PostalCode   *string `json:"postal_code,omitempty"`
	Country      string  `json:"country"`
	BillingEmail *string `json:"billing_email,omitempty"`
	Notes        *string `json:"notes,omitempty"`
}

// AdminGet — returns the profile if one exists, or a 404 marker. The
// admin UI shows a "Create billing profile" CTA on 404.
func (h *BillingProfileHandler) AdminGet(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customerID")
	p, err := loadBillingProfile(r, h.DB, customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "no billing profile")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, p)
}

// AdminUpsert — single-row UPSERT so the admin form can use one
// endpoint for both create and edit.
func (h *BillingProfileHandler) AdminUpsert(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customerID")
	var in billingProfile
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if in.LegalName == "" {
		writeErr(w, 400, "legal_name required")
		return
	}
	if in.BranchCode == "" {
		in.BranchCode = "00000"
	}
	if in.Country == "" {
		in.Country = "TH"
	}
	uid := userID(r)
	var actor any
	if uid != "" {
		actor = uid
	}

	ctx, cancel := makeCtx()
	defer cancel()

	_, err := h.DB.Exec(ctx, `
		INSERT INTO customer_billing_profiles
		    (customer_id, legal_name, tax_id, branch_code,
		     address_line1, address_line2, subdistrict, district, province,
		     postal_code, country, billing_email, notes, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		ON CONFLICT (customer_id) DO UPDATE SET
		     legal_name=EXCLUDED.legal_name,
		     tax_id=EXCLUDED.tax_id,
		     branch_code=EXCLUDED.branch_code,
		     address_line1=EXCLUDED.address_line1,
		     address_line2=EXCLUDED.address_line2,
		     subdistrict=EXCLUDED.subdistrict,
		     district=EXCLUDED.district,
		     province=EXCLUDED.province,
		     postal_code=EXCLUDED.postal_code,
		     country=EXCLUDED.country,
		     billing_email=EXCLUDED.billing_email,
		     notes=EXCLUDED.notes,
		     updated_by=EXCLUDED.updated_by`,
		customerID, in.LegalName, in.TaxID, in.BranchCode,
		in.AddressLine1, in.AddressLine2, in.Subdistrict, in.District, in.Province,
		in.PostalCode, in.Country, in.BillingEmail, in.Notes, actor)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	p, _ := loadBillingProfile(r, h.DB, customerID)
	writeJSON(w, 200, p)
}

// ---------- portal endpoints ----------
//
// Customer self-service: portal users (aud=customer) can view and edit
// their own billing profile. Reads/writes always scope to the customer
// id from the JWT — never trust a path param.
func (h *BillingProfileHandler) PortalGet(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	p, err := loadBillingProfile(r, h.DB, cid)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, 404, "no billing profile")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, p)
}

func (h *BillingProfileHandler) PortalUpsert(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	var in billingProfile
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if in.LegalName == "" {
		writeErr(w, 400, "legal_name required")
		return
	}
	if in.BranchCode == "" {
		in.BranchCode = "00000"
	}
	if in.Country == "" {
		in.Country = "TH"
	}

	ctx, cancel := makeCtx()
	defer cancel()

	if _, err := h.DB.Exec(ctx, `
		INSERT INTO customer_billing_profiles
		    (customer_id, legal_name, tax_id, branch_code,
		     address_line1, address_line2, subdistrict, district, province,
		     postal_code, country, billing_email, notes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (customer_id) DO UPDATE SET
		     legal_name=EXCLUDED.legal_name,
		     tax_id=EXCLUDED.tax_id,
		     branch_code=EXCLUDED.branch_code,
		     address_line1=EXCLUDED.address_line1,
		     address_line2=EXCLUDED.address_line2,
		     subdistrict=EXCLUDED.subdistrict,
		     district=EXCLUDED.district,
		     province=EXCLUDED.province,
		     postal_code=EXCLUDED.postal_code,
		     country=EXCLUDED.country,
		     billing_email=EXCLUDED.billing_email,
		     notes=EXCLUDED.notes`,
		cid, in.LegalName, in.TaxID, in.BranchCode,
		in.AddressLine1, in.AddressLine2, in.Subdistrict, in.District, in.Province,
		in.PostalCode, in.Country, in.BillingEmail, in.Notes); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	p, _ := loadBillingProfile(r, h.DB, cid)
	writeJSON(w, 200, p)
}

func loadBillingProfile(r *http.Request, db *pgxpool.Pool, customerID string) (*billingProfile, error) {
	var p billingProfile
	err := db.QueryRow(r.Context(), `
		SELECT customer_id, legal_name, tax_id, branch_code,
		       address_line1, address_line2, subdistrict, district, province,
		       postal_code, country, billing_email, notes
		  FROM customer_billing_profiles WHERE customer_id=$1`,
		customerID).Scan(
		&p.CustomerID, &p.LegalName, &p.TaxID, &p.BranchCode,
		&p.AddressLine1, &p.AddressLine2, &p.Subdistrict, &p.District, &p.Province,
		&p.PostalCode, &p.Country, &p.BillingEmail, &p.Notes,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}
