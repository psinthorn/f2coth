package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
)

type AssetHandler struct {
	DB *pgxpool.Pool
}

// hasService returns true if the customer's services_used contains slug.
// Cheap query — used to gate the portal endpoints.
func (h *AssetHandler) hasService(r *http.Request, cid, slug string) (bool, error) {
	var present bool
	err := h.DB.QueryRow(r.Context(),
		`SELECT $1 = ANY(services_used) FROM customers WHERE id = $2`,
		slug, cid).Scan(&present)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	return present, err
}

// ----- Portal /domains -----

func (h *AssetHandler) PortalListDomains(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}
	ok, err := h.hasService(r, cid, "domain-hosting")
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if !ok {
		// No entitlement — return 404 so the route is "invisible".
		writeErr(w, http.StatusNotFound, "not available")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, customer_id, domain, registrar, expires_at,
               privacy_enabled, auto_renew, notes, last_dns_change_at,
               created_at, updated_at
        FROM customer_domains
        WHERE customer_id = $1
        ORDER BY expires_at NULLS LAST, domain
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Domain, 0, 16)
	for rows.Next() {
		var d models.Domain
		if err := rows.Scan(&d.ID, &d.CustomerID, &d.Domain, &d.Registrar, &d.ExpiresAt,
			&d.PrivacyEnabled, &d.AutoRenew, &d.Notes, &d.LastDNSChangeAt,
			&d.CreatedAt, &d.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, map[string]any{"domains": out})
}

// ----- Portal /sla -----

func (h *AssetHandler) PortalListSLA(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, customer_id, service_slug, title,
               starts_on::text, ends_on::text,
               target_uptime_pct::float8, status, notes, created_at, updated_at
        FROM customer_sla_contracts
        WHERE customer_id = $1 AND status IN ('active','renewing','expired')
        ORDER BY status = 'active' DESC, ends_on DESC
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.SLAContract, 0, 8)
	for rows.Next() {
		var s models.SLAContract
		if err := rows.Scan(&s.ID, &s.CustomerID, &s.ServiceSlug, &s.Title,
			&s.StartsOn, &s.EndsOn, &s.TargetUptimePct, &s.Status,
			&s.Notes, &s.CreatedAt, &s.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		// Hide the route from customers without any SLA on file.
		writeErr(w, http.StatusNotFound, "not available")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"sla_contracts": out})
}

// ----- Admin: domains CRUD -----

func (h *AssetHandler) AdminListDomains(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, customer_id, domain, registrar, expires_at,
               privacy_enabled, auto_renew, notes, last_dns_change_at,
               created_at, updated_at
        FROM customer_domains
        WHERE customer_id = $1
        ORDER BY expires_at NULLS LAST, domain
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Domain, 0, 16)
	for rows.Next() {
		var d models.Domain
		if err := rows.Scan(&d.ID, &d.CustomerID, &d.Domain, &d.Registrar, &d.ExpiresAt,
			&d.PrivacyEnabled, &d.AutoRenew, &d.Notes, &d.LastDNSChangeAt,
			&d.CreatedAt, &d.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, map[string]any{"domains": out})
}

type domainCreateReq struct {
	Domain          string  `json:"domain"`
	Registrar       string  `json:"registrar"`
	ExpiresAt       *string `json:"expires_at"` // ISO8601 or null
	PrivacyEnabled  bool    `json:"privacy_enabled"`
	AutoRenew       bool    `json:"auto_renew"`
	Notes           string  `json:"notes"`
	LastDNSChangeAt *string `json:"last_dns_change_at"`
}

func (h *AssetHandler) AdminCreateDomain(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	var req domainCreateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Domain = strings.TrimSpace(strings.ToLower(req.Domain))
	if req.Domain == "" {
		writeErr(w, http.StatusBadRequest, "domain is required")
		return
	}
	if req.Registrar == "" {
		req.Registrar = "ResellerClub"
	}
	var id string
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO customer_domains
            (customer_id, domain, registrar, expires_at, privacy_enabled, auto_renew, notes, last_dns_change_at)
        VALUES ($1, $2, $3, NULLIF($4,'')::timestamptz, $5, $6, NULLIF($7,''), NULLIF($8,'')::timestamptz)
        RETURNING id
    `, cid, req.Domain, req.Registrar, ptrOrEmpty(req.ExpiresAt),
		req.PrivacyEnabled, req.AutoRenew, req.Notes, ptrOrEmpty(req.LastDNSChangeAt)).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "customer_domains_customer_id_domain_key") {
			writeErr(w, http.StatusConflict, "domain already exists for this customer")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create domain")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *AssetHandler) AdminUpdateDomain(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	did := chi.URLParam(r, "domainId")

	var req struct {
		Registrar       *string `json:"registrar"`
		ExpiresAt       *string `json:"expires_at"`
		PrivacyEnabled  *bool   `json:"privacy_enabled"`
		AutoRenew       *bool   `json:"auto_renew"`
		Notes           *string `json:"notes"`
		LastDNSChangeAt *string `json:"last_dns_change_at"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE customer_domains SET
            registrar          = COALESCE($3, registrar),
            expires_at         = COALESCE(NULLIF($4,'')::timestamptz, expires_at),
            privacy_enabled    = COALESCE($5, privacy_enabled),
            auto_renew         = COALESCE($6, auto_renew),
            notes              = COALESCE($7, notes),
            last_dns_change_at = COALESCE(NULLIF($8,'')::timestamptz, last_dns_change_at)
        WHERE id = $1 AND customer_id = $2
    `, did, cid, req.Registrar, ptrOrEmpty(req.ExpiresAt),
		req.PrivacyEnabled, req.AutoRenew, req.Notes, ptrOrEmpty(req.LastDNSChangeAt))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "domain not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AssetHandler) AdminDeleteDomain(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	did := chi.URLParam(r, "domainId")
	tag, err := h.DB.Exec(r.Context(),
		`DELETE FROM customer_domains WHERE id = $1 AND customer_id = $2`, did, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "domain not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ----- Admin: SLA CRUD -----

func (h *AssetHandler) AdminListSLA(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, customer_id, service_slug, title,
               starts_on::text, ends_on::text,
               target_uptime_pct::float8, status, notes, created_at, updated_at
        FROM customer_sla_contracts
        WHERE customer_id = $1
        ORDER BY ends_on DESC
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.SLAContract, 0, 8)
	for rows.Next() {
		var s models.SLAContract
		if err := rows.Scan(&s.ID, &s.CustomerID, &s.ServiceSlug, &s.Title,
			&s.StartsOn, &s.EndsOn, &s.TargetUptimePct, &s.Status,
			&s.Notes, &s.CreatedAt, &s.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, s)
	}
	writeJSON(w, http.StatusOK, map[string]any{"sla_contracts": out})
}

type slaCreateReq struct {
	ServiceSlug     string  `json:"service_slug"`
	Title           string  `json:"title"`
	StartsOn        string  `json:"starts_on"` // YYYY-MM-DD
	EndsOn          string  `json:"ends_on"`
	TargetUptimePct float64 `json:"target_uptime_pct"`
	Status          string  `json:"status"`
	Notes           string  `json:"notes"`
}

var validSLAStatuses = map[string]struct{}{
	"draft": {}, "active": {}, "renewing": {}, "expired": {},
}

func (h *AssetHandler) AdminCreateSLA(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	var req slaCreateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.ServiceSlug = strings.TrimSpace(req.ServiceSlug)
	req.Title = strings.TrimSpace(req.Title)
	if req.ServiceSlug == "" || req.Title == "" || req.StartsOn == "" || req.EndsOn == "" {
		writeErr(w, http.StatusBadRequest, "service_slug, title, starts_on, ends_on required")
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	if _, ok := validSLAStatuses[req.Status]; !ok {
		writeErr(w, http.StatusBadRequest, "invalid status")
		return
	}
	if req.TargetUptimePct == 0 {
		req.TargetUptimePct = 99.9
	}

	var id string
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO customer_sla_contracts
            (customer_id, service_slug, title, starts_on, ends_on,
             target_uptime_pct, status, notes)
        VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, NULLIF($8,''))
        RETURNING id
    `, cid, req.ServiceSlug, req.Title, req.StartsOn, req.EndsOn,
		req.TargetUptimePct, req.Status, req.Notes).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create SLA")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *AssetHandler) AdminUpdateSLA(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "slaId")
	var req struct {
		Title           *string  `json:"title"`
		StartsOn        *string  `json:"starts_on"`
		EndsOn          *string  `json:"ends_on"`
		TargetUptimePct *float64 `json:"target_uptime_pct"`
		Status          *string  `json:"status"`
		Notes           *string  `json:"notes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Status != nil {
		if _, ok := validSLAStatuses[*req.Status]; !ok {
			writeErr(w, http.StatusBadRequest, "invalid status")
			return
		}
	}
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE customer_sla_contracts SET
            title             = COALESCE($3, title),
            starts_on         = COALESCE(NULLIF($4,'')::date, starts_on),
            ends_on           = COALESCE(NULLIF($5,'')::date, ends_on),
            target_uptime_pct = COALESCE($6, target_uptime_pct),
            status            = COALESCE($7, status),
            notes             = COALESCE($8, notes)
        WHERE id = $1 AND customer_id = $2
    `, sid, cid, req.Title, ptrOrEmpty(req.StartsOn), ptrOrEmpty(req.EndsOn),
		req.TargetUptimePct, req.Status, req.Notes)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "SLA not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AssetHandler) AdminDeleteSLA(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	sid := chi.URLParam(r, "slaId")
	tag, err := h.DB.Exec(r.Context(),
		`DELETE FROM customer_sla_contracts WHERE id = $1 AND customer_id = $2`, sid, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "SLA not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ptrOrEmpty returns "" for nil string pointers so we can use NULLIF($,'')
// in queries cleanly.
func ptrOrEmpty(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ----- Portal /domains/orders -----
//
// Customers can request a domain registration from inside the portal.
// We write directly to domain_orders (the shared table also used by
// reseller-api admin) tagged with the customer_id from the JWT. F2
// staff fulfills via /admin/orders/domains.

type portalCreateOrderReq struct {
	SLD            string `json:"sld"`
	TLD            string `json:"tld"`
	Registry       string `json:"registry"`
	ContactName    string `json:"contact_name"`
	ContactEmail   string `json:"contact_email"`
	ContactPhone   string `json:"contact_phone"`
	ContactCompany string `json:"contact_company"`
	Years          int    `json:"years"`
	PrivacyEnabled bool   `json:"privacy_enabled"`
	Notes          string `json:"notes"`
}

func (h *AssetHandler) PortalListDomainOrders(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
        SELECT id, sld, tld, fqdn, registry, years, privacy_enabled,
               status, registry_order_id, notes, created_at, updated_at
        FROM domain_orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT 50
    `, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.DomainOrder, 0, 8)
	for rows.Next() {
		var o models.DomainOrder
		if err := rows.Scan(&o.ID, &o.SLD, &o.TLD, &o.FQDN, &o.Registry,
			&o.Years, &o.PrivacyEnabled, &o.Status, &o.RegistryOrderID,
			&o.Notes, &o.CreatedAt, &o.UpdatedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, o)
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": out})
}

func (h *AssetHandler) PortalCreateDomainOrder(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}

	var req portalCreateOrderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.SLD = strings.ToLower(strings.TrimSpace(req.SLD))
	req.TLD = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(req.TLD)), ".")
	if req.SLD == "" || req.TLD == "" {
		writeErr(w, http.StatusBadRequest, "sld and tld are required")
		return
	}
	if req.Registry != "thnic" && req.Registry != "resellerclub" {
		writeErr(w, http.StatusBadRequest, "invalid registry")
		return
	}
	if req.Years < 1 {
		req.Years = 1
	}
	if req.Years > 10 {
		req.Years = 10
	}
	if req.ContactEmail == "" || req.ContactName == "" {
		writeErr(w, http.StatusBadRequest, "contact_name and contact_email are required")
		return
	}

	var o models.DomainOrder
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO domain_orders (
            sld, tld, registry, customer_id,
            contact_name, contact_email, contact_phone, contact_company,
            years, privacy_enabled, notes
        ) VALUES (
            $1, $2, $3, $4::uuid,
            NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''),
            $9, $10, NULLIF($11,'')
        )
        RETURNING id, sld, tld, fqdn, registry, years, privacy_enabled,
                  status, registry_order_id, notes, created_at, updated_at
    `,
		req.SLD, req.TLD, req.Registry, cid,
		req.ContactName, req.ContactEmail, req.ContactPhone, req.ContactCompany,
		req.Years, req.PrivacyEnabled, req.Notes,
	).Scan(&o.ID, &o.SLD, &o.TLD, &o.FQDN, &o.Registry,
		&o.Years, &o.PrivacyEnabled, &o.Status, &o.RegistryOrderID,
		&o.Notes, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create order")
		return
	}
	writeJSON(w, http.StatusCreated, o)
}
