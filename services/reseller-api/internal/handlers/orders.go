package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	mw "github.com/f2cothai/f2-website/services/reseller-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

type OrdersHandler struct {
	DB *pgxpool.Pool
}

type createOrderReq struct {
	SLD            string  `json:"sld"`
	TLD            string  `json:"tld"`
	Registry       string  `json:"registry"`
	CustomerID     *string `json:"customer_id,omitempty"`
	LeadID         *string `json:"lead_id,omitempty"`
	ContactName    string  `json:"contact_name"`
	ContactEmail   string  `json:"contact_email"`
	ContactPhone   string  `json:"contact_phone"`
	ContactCompany string  `json:"contact_company"`
	Years          int     `json:"years"`
	PrivacyEnabled bool    `json:"privacy_enabled"`
	Notes          string  `json:"notes"`
}

type updateOrderReq struct {
	Status          *string `json:"status,omitempty"`
	RegistryOrderID *string `json:"registry_order_id,omitempty"`
	Notes           *string `json:"notes,omitempty"`
}

const validRegistries = "thnic,resellerclub"

var validStatuses = map[string]struct{}{
	"pending":    {},
	"quoted":     {},
	"approved":   {},
	"registered": {},
	"active":     {},
	"rejected":   {},
	"cancelled":  {},
	"failed":     {},
}

// List returns recent orders, newest first. Optional filters: status, registry.
func (h *OrdersHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	args := []any{}
	where := []string{}
	if s := q.Get("status"); s != "" {
		args = append(args, s)
		where = append(where, "status = $1")
	}
	if reg := q.Get("registry"); reg != "" {
		args = append(args, reg)
		where = append(where, "registry = $"+itoa(len(args)))
	}

	sql := `
        SELECT id, sld, tld, fqdn, registry, customer_id, lead_id, requested_by_user_id,
               contact_name, contact_email, contact_phone, contact_company,
               years, privacy_enabled, status, registry_order_id, notes,
               created_at, updated_at
        FROM domain_orders`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += " ORDER BY created_at DESC LIMIT 200"

	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.DomainOrder, 0, 32)
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, o)
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": out})
}

func (h *OrdersHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row := h.DB.QueryRow(r.Context(), `
        SELECT id, sld, tld, fqdn, registry, customer_id, lead_id, requested_by_user_id,
               contact_name, contact_email, contact_phone, contact_company,
               years, privacy_enabled, status, registry_order_id, notes,
               created_at, updated_at
        FROM domain_orders WHERE id = $1`, id)
	o, err := scanOrder(row)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

func (h *OrdersHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createOrderReq
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
	if !strings.Contains(validRegistries, req.Registry) {
		writeErr(w, http.StatusBadRequest, "invalid registry")
		return
	}
	if req.Years < 1 {
		req.Years = 1
	}

	userID := mw.UserID(r.Context())
	row := h.DB.QueryRow(r.Context(), `
        INSERT INTO domain_orders (
            sld, tld, registry, customer_id, lead_id, requested_by_user_id,
            contact_name, contact_email, contact_phone, contact_company,
            years, privacy_enabled, notes
        ) VALUES (
            $1, $2, $3, NULLIF($4,'')::uuid, NULLIF($5,'')::uuid, NULLIF($6,'')::uuid,
            NULLIF($7,''), NULLIF($8,''), NULLIF($9,''), NULLIF($10,''),
            $11, $12, NULLIF($13,'')
        )
        RETURNING id, sld, tld, fqdn, registry, customer_id, lead_id, requested_by_user_id,
                  contact_name, contact_email, contact_phone, contact_company,
                  years, privacy_enabled, status, registry_order_id, notes,
                  created_at, updated_at`,
		req.SLD, req.TLD, req.Registry,
		strDeref(req.CustomerID), strDeref(req.LeadID), userID,
		req.ContactName, req.ContactEmail, req.ContactPhone, req.ContactCompany,
		req.Years, req.PrivacyEnabled, req.Notes,
	)
	o, err := scanOrder(row)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create order")
		return
	}
	writeJSON(w, http.StatusCreated, o)
}

func (h *OrdersHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateOrderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Status != nil {
		if _, ok := validStatuses[*req.Status]; !ok {
			writeErr(w, http.StatusBadRequest, "invalid status")
			return
		}
	}
	row := h.DB.QueryRow(r.Context(), `
        UPDATE domain_orders SET
            status            = COALESCE($1, status),
            registry_order_id = COALESCE($2, registry_order_id),
            notes             = COALESCE($3, notes)
        WHERE id = $4
        RETURNING id, sld, tld, fqdn, registry, customer_id, lead_id, requested_by_user_id,
                  contact_name, contact_email, contact_phone, contact_company,
                  years, privacy_enabled, status, registry_order_id, notes,
                  created_at, updated_at`,
		req.Status, req.RegistryOrderID, req.Notes, id,
	)
	o, err := scanOrder(row)
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, o)
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanOrder(row rowScanner) (models.DomainOrder, error) {
	var o models.DomainOrder
	err := row.Scan(
		&o.ID, &o.SLD, &o.TLD, &o.FQDN, &o.Registry,
		&o.CustomerID, &o.LeadID, &o.RequestedByUserID,
		&o.ContactName, &o.ContactEmail, &o.ContactPhone, &o.ContactCompany,
		&o.Years, &o.PrivacyEnabled, &o.Status, &o.RegistryOrderID, &o.Notes,
		&o.CreatedAt, &o.UpdatedAt,
	)
	return o, err
}

func strDeref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func itoa(i int) string {
	// small helper to avoid importing strconv just for a single positional arg
	return [...]string{"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"}[i]
}
