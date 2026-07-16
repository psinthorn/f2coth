package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/contract-api/internal/models"
)

const partyCols = `id, customer_id, legal_name_en, legal_name_th, brand_name, tax_id,
	address, notice_email, contact_person, phone, created_at, updated_at`

func scanParty(row pgx.Row) (models.Party, error) {
	var p models.Party
	err := row.Scan(&p.ID, &p.CustomerID, &p.LegalNameEN, &p.LegalNameTH, &p.BrandName,
		&p.TaxID, &p.Address, &p.NoticeEmail, &p.ContactPerson, &p.Phone,
		&p.CreatedAt, &p.UpdatedAt)
	return p, err
}

// GET /api/contracts/parties?q=&customer= — list/search parties.
func (h *Handler) ListParties(w http.ResponseWriter, r *http.Request) {
	q := `SELECT ` + partyCols + ` FROM contract_parties`
	args := []any{}
	where := ""
	if cust := r.URL.Query().Get("customer"); cust != "" {
		args = append(args, cust)
		where = ` WHERE customer_id = $1`
	} else if s := r.URL.Query().Get("q"); s != "" {
		args = append(args, "%"+s+"%")
		where = ` WHERE legal_name_en ILIKE $1 OR legal_name_th ILIKE $1 OR brand_name ILIKE $1`
	}
	rows, err := h.DB.Query(r.Context(), q+where+` ORDER BY legal_name_en`, args...)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []models.Party{}
	for rows.Next() {
		p, err := scanParty(rows)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, map[string]any{"parties": out})
}

// GET /api/contracts/parties/{id}
func (h *Handler) GetParty(w http.ResponseWriter, r *http.Request) {
	p, err := scanParty(h.DB.QueryRow(r.Context(),
		`SELECT `+partyCols+` FROM contract_parties WHERE id = $1`, chi.URLParam(r, "id")))
	if err == pgx.ErrNoRows {
		writeErr(w, http.StatusNotFound, "party not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type partyWriteReq struct {
	CustomerID    *string `json:"customer_id"`
	LegalNameEN   string  `json:"legal_name_en"`
	LegalNameTH   string  `json:"legal_name_th"`
	BrandName     *string `json:"brand_name"`
	TaxID         *string `json:"tax_id"`
	Address       *string `json:"address"`
	NoticeEmail   *string `json:"notice_email"`
	ContactPerson *string `json:"contact_person"`
	Phone         *string `json:"phone"`
}

// POST /api/contracts/parties (staff)
func (h *Handler) CreateParty(w http.ResponseWriter, r *http.Request) {
	var req partyWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.LegalNameEN == "" || req.LegalNameTH == "" {
		writeErr(w, http.StatusBadRequest, "legal_name_en and legal_name_th required")
		return
	}
	var id string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO contract_parties
			(customer_id, legal_name_en, legal_name_th, brand_name, tax_id,
			 address, notice_email, contact_person, phone)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
		req.CustomerID, req.LegalNameEN, req.LegalNameTH, req.BrandName, req.TaxID,
		req.Address, req.NoticeEmail, req.ContactPerson, req.Phone).Scan(&id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// PATCH /api/contracts/parties/{id} (staff)
func (h *Handler) UpdateParty(w http.ResponseWriter, r *http.Request) {
	var req partyWriteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	ct, err := h.DB.Exec(r.Context(), `
		UPDATE contract_parties SET
			customer_id    = $2,
			legal_name_en  = COALESCE(NULLIF($3,''), legal_name_en),
			legal_name_th  = COALESCE(NULLIF($4,''), legal_name_th),
			brand_name     = $5,
			tax_id         = $6,
			address        = $7,
			notice_email   = $8,
			contact_person = $9,
			phone          = $10
		 WHERE id = $1`,
		chi.URLParam(r, "id"), req.CustomerID, req.LegalNameEN, req.LegalNameTH,
		req.BrandName, req.TaxID, req.Address, req.NoticeEmail, req.ContactPerson, req.Phone)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
		return
	}
	if ct.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "party not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// loadParty fetches a party for embedding into a contract detail.
func (h *Handler) loadParty(ctx context.Context, id string) (*models.Party, error) {
	p, err := scanParty(h.DB.QueryRow(ctx,
		`SELECT `+partyCols+` FROM contract_parties WHERE id = $1`, id))
	if err != nil {
		return nil, err
	}
	return &p, nil
}
