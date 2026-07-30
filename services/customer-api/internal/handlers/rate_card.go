package handlers

// Rate card — the managed price book (migration 073). Staff CRUD; staff pick an
// item when itemizing a ticket and its rate snapshots onto the line.

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
)

const rateCardSelect = `
    SELECT id, code, name_en, name_th, description_en, description_th, unit,
           default_unit_price_cents, currency, category, is_active, sort_order,
           created_at, updated_at
      FROM rate_card_items`

func scanRateCard(row interface{ Scan(...any) error }, it *models.RateCardItem) error {
	return row.Scan(&it.ID, &it.Code, &it.NameEN, &it.NameTH, &it.DescriptionEN, &it.DescriptionTH,
		&it.Unit, &it.DefaultUnitPriceCents, &it.Currency, &it.Category, &it.IsActive, &it.SortOrder,
		&it.CreatedAt, &it.UpdatedAt)
}

// ListRateCard — GET /customer/admin/rate-card?active=1
func (h *AdminHandler) ListRateCard(w http.ResponseWriter, r *http.Request) {
	q := rateCardSelect
	if r.URL.Query().Get("active") == "1" {
		q += ` WHERE is_active = TRUE`
	}
	q += ` ORDER BY sort_order, name_en`
	rows, err := h.DB.Query(r.Context(), q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.RateCardItem, 0, 16)
	for rows.Next() {
		var it models.RateCardItem
		if err := scanRateCard(rows, &it); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": out})
}

type rateCardReq struct {
	Code                  string `json:"code"`
	NameEN                string `json:"name_en"`
	NameTH                string `json:"name_th"`
	DescriptionEN         string `json:"description_en"`
	DescriptionTH         string `json:"description_th"`
	Unit                  string `json:"unit"`
	DefaultUnitPriceCents int64  `json:"default_unit_price_cents"`
	Currency              string `json:"currency"`
	Category              string `json:"category"`
	IsActive              *bool  `json:"is_active"`
}

func (r rateCardReq) validate() string {
	if strings.TrimSpace(r.NameEN) == "" {
		return "name_en is required"
	}
	if r.DefaultUnitPriceCents < 0 {
		return "default_unit_price_cents must be >= 0"
	}
	if r.Currency != "" && r.Currency != "THB" && r.Currency != "USD" {
		return "currency must be THB or USD"
	}
	return ""
}

// CreateRateCard — POST /customer/admin/rate-card
func (h *AdminHandler) CreateRateCard(w http.ResponseWriter, r *http.Request) {
	var req rateCardReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if msg := req.validate(); msg != "" {
		writeErr(w, http.StatusBadRequest, msg)
		return
	}
	if req.Unit == "" {
		req.Unit = "item"
	}
	if req.Currency == "" {
		req.Currency = "THB"
	}
	var id string
	err := h.DB.QueryRow(r.Context(), `
        INSERT INTO rate_card_items
            (code, name_en, name_th, description_en, description_th, unit,
             default_unit_price_cents, currency, category, sort_order)
        VALUES (NULLIF($1,''),$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),$6,$7,$8,NULLIF($9,''),
                COALESCE((SELECT MAX(sort_order)+10 FROM rate_card_items),10))
        RETURNING id`,
		req.Code, req.NameEN, req.NameTH, req.DescriptionEN, req.DescriptionTH, req.Unit,
		req.DefaultUnitPriceCents, req.Currency, req.Category).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "rate_card_items_code_key") {
			writeErr(w, http.StatusConflict, "code already in use")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create rate card item")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// UpdateRateCard — PATCH /customer/admin/rate-card/{id}
func (h *AdminHandler) UpdateRateCard(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		NameEN                *string `json:"name_en"`
		NameTH                *string `json:"name_th"`
		DescriptionEN         *string `json:"description_en"`
		DescriptionTH         *string `json:"description_th"`
		Unit                  *string `json:"unit"`
		DefaultUnitPriceCents *int64  `json:"default_unit_price_cents"`
		Currency              *string `json:"currency"`
		Category              *string `json:"category"`
		IsActive              *bool   `json:"is_active"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.DefaultUnitPriceCents != nil && *req.DefaultUnitPriceCents < 0 {
		writeErr(w, http.StatusBadRequest, "default_unit_price_cents must be >= 0")
		return
	}
	if req.Currency != nil && *req.Currency != "THB" && *req.Currency != "USD" {
		writeErr(w, http.StatusBadRequest, "currency must be THB or USD")
		return
	}
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE rate_card_items SET
            name_en = COALESCE($2, name_en),
            name_th = COALESCE($3, name_th),
            description_en = COALESCE($4, description_en),
            description_th = COALESCE($5, description_th),
            unit = COALESCE($6, unit),
            default_unit_price_cents = COALESCE($7, default_unit_price_cents),
            currency = COALESCE($8, currency),
            category = COALESCE($9, category),
            is_active = COALESCE($10, is_active)
        WHERE id = $1`,
		id, req.NameEN, req.NameTH, req.DescriptionEN, req.DescriptionTH, req.Unit,
		req.DefaultUnitPriceCents, req.Currency, req.Category, req.IsActive)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "rate card item not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
