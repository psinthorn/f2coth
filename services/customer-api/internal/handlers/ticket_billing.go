package handlers

// Ticket billing (migration 073): attach priced line items to a ticket, each
// covered (under an active SLA → ฿0) or billable (charged at a rate); then
// generate a DRAFT invoice from the billable lines via payment-api.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
)

const (
	ticketVATRateBP = 700 // Thailand 7%, passed explicitly to payment-api so the
	// preview and the issued invoice use one rate.

	// Sane bounds so server-computed money can't silently overflow int64.
	maxLineQuantity  = 1_000_000
	maxUnitPriceCent = 1_000_000_00 // ฿1,000,000
)

// ---- shared load ----

const ticketLineSelect = `
    SELECT id, ticket_id, rate_card_item_id, description_en, description_th, unit,
           quantity, unit_price_cents, covered, amount_cents, currency, sort_order, created_at
      FROM ticket_line_items WHERE ticket_id = $1
     ORDER BY sort_order, created_at`

func (h *AdminHandler) loadTicketLines(ctx context.Context, ticketID string) ([]models.TicketLineItem, error) {
	rows, err := h.DB.Query(ctx, ticketLineSelect, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.TicketLineItem, 0, 8)
	for rows.Next() {
		var it models.TicketLineItem
		if err := rows.Scan(&it.ID, &it.TicketID, &it.RateCardItemID, &it.DescriptionEN, &it.DescriptionTH,
			&it.Unit, &it.Quantity, &it.UnitPriceCents, &it.Covered, &it.AmountCents, &it.Currency,
			&it.SortOrder, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

// buildBilling assembles the full billing view (lines + totals + coverage hint).
func (h *AdminHandler) buildBilling(ctx context.Context, ticketID string) (*models.TicketBilling, error) {
	var (
		customerID, billingStatus string
		serviceSlug               *string
		invoiceID                 *string
	)
	err := h.DB.QueryRow(ctx,
		`SELECT customer_id, related_service_slug, billing_status, invoice_id FROM tickets WHERE id = $1`,
		ticketID).Scan(&customerID, &serviceSlug, &billingStatus, &invoiceID)
	if err != nil {
		return nil, err // includes pgx.ErrNoRows
	}

	lines, err := h.loadTicketLines(ctx, ticketID)
	if err != nil {
		return nil, err
	}

	b := &models.TicketBilling{
		TicketID: ticketID, BillingStatus: billingStatus, Currency: "THB",
		Lines: lines, VATRateBP: ticketVATRateBP, InvoiceID: invoiceID,
	}
	if len(lines) > 0 {
		b.Currency = lines[0].Currency // single currency per ticket (enforced on write)
	}
	for _, l := range lines {
		b.SubtotalCents += l.AmountCents
	}
	b.VATCents = b.SubtotalCents * int64(b.VATRateBP) / 10000
	b.TotalCents = b.SubtotalCents + b.VATCents

	// Coverage hint: an active SLA matching the ticket's service.
	if serviceSlug != nil && *serviceSlug != "" {
		var title string
		if err := h.DB.QueryRow(ctx, `
            SELECT title FROM customer_sla_contracts
             WHERE customer_id = $1 AND service_slug = $2 AND status = 'active'
               AND CURRENT_DATE BETWEEN starts_on AND ends_on
             ORDER BY ends_on DESC LIMIT 1`, customerID, *serviceSlug).Scan(&title); err == nil {
			b.CoveredByTitle = &title
		}
	}
	// Latest quotation approval (gates invoice generation in the admin UI).
	var apID, apStatus *string
	if err := h.DB.QueryRow(ctx, `
        SELECT id::text, status FROM approvals
         WHERE subject_type='ticket' AND subject_id=$1 AND kind='quotation'
         ORDER BY created_at DESC LIMIT 1`, ticketID).Scan(&apID, &apStatus); err == nil {
		b.ApprovalID = apID
		b.ApprovalStatus = apStatus
	}

	// Invoice number + status, if generated. The portal only reveals the number
	// once the invoice is issued (payment-api hides drafts).
	if invoiceID != nil {
		var num, status string
		if err := h.DB.QueryRow(ctx, `SELECT invoice_number, status FROM invoices WHERE id = $1`, *invoiceID).
			Scan(&num, &status); err == nil {
			b.InvoiceNumber = &num
			b.InvoiceStatus = &status
		}
	}
	return b, nil
}

const recomputeBillingSQL = `
    UPDATE tickets t SET billing_status = CASE
        WHEN c.total = 0        THEN 'none'
        WHEN c.billable > 0     THEN 'billable'
        ELSE 'covered' END
    FROM (
        SELECT COUNT(*) total, COUNT(*) FILTER (WHERE NOT covered) billable
          FROM ticket_line_items WHERE ticket_id = $1
    ) c
    WHERE t.id = $1`

// inTxRecompute runs a line mutation and the billing_status recompute in ONE
// transaction so billing_status can never drift from the lines on a partial
// failure. fn returns the affected-row count for not-found handling.
func (h *AdminHandler) inTxRecompute(ctx context.Context, ticketID string, fn func(pgx.Tx) (int64, error)) (int64, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	n, err := fn(tx)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, recomputeBillingSQL, ticketID); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return n, nil
}

// billingGuard checks the ticket exists and isn't already invoiced (lines are
// frozen once an invoice is generated). Returns (status, message); 0 = ok.
func (h *AdminHandler) billingGuard(ctx context.Context, ticketID string) (int, string) {
	var inv *string
	err := h.DB.QueryRow(ctx, `SELECT invoice_id FROM tickets WHERE id = $1`, ticketID).Scan(&inv)
	if errors.Is(err, pgx.ErrNoRows) {
		return http.StatusNotFound, "ticket not found"
	}
	if err != nil {
		return http.StatusInternalServerError, "db error"
	}
	if inv != nil {
		return http.StatusConflict, "ticket already invoiced; line items are frozen"
	}
	return 0, ""
}

// GetTicketBilling — GET /customer/admin/tickets/{id}/billing
func (h *AdminHandler) GetTicketBilling(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	b, err := h.buildBilling(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, b)
}

type ticketLineReq struct {
	RateCardItemID string `json:"rate_card_item_id"` // optional; snapshots rate-card fields
	DescriptionEN  string `json:"description_en"`
	DescriptionTH  string `json:"description_th"`
	Unit           string `json:"unit"`
	Quantity       int    `json:"quantity"`
	UnitPriceCents *int64 `json:"unit_price_cents"` // optional when rate_card_item_id given
	Covered        bool   `json:"covered"`
	Currency       string `json:"currency"`
}

// AddTicketLine — POST /customer/admin/tickets/{id}/line-items
func (h *AdminHandler) AddTicketLine(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "id")
	var req ticketLineReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if code, msg := h.billingGuard(r.Context(), ticketID); code != 0 {
		writeErr(w, code, msg)
		return
	}

	// Snapshot from rate card when an item is chosen; provided values still win.
	var rcID any
	if req.RateCardItemID != "" {
		var rc models.RateCardItem
		err := scanRateCard(h.DB.QueryRow(r.Context(), rateCardSelect+` WHERE id=$1`, req.RateCardItemID), &rc)
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusBadRequest, "rate_card_item not found")
			return
		}
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db error")
			return
		}
		rcID = rc.ID
		if req.DescriptionEN == "" {
			req.DescriptionEN = rc.NameEN
		}
		if req.DescriptionTH == "" && rc.NameTH != nil {
			req.DescriptionTH = *rc.NameTH
		}
		if req.Unit == "" {
			req.Unit = rc.Unit
		}
		if req.UnitPriceCents == nil {
			req.UnitPriceCents = &rc.DefaultUnitPriceCents
		}
		if req.Currency == "" {
			req.Currency = rc.Currency
		}
	}

	req.DescriptionEN = strings.TrimSpace(req.DescriptionEN)
	if req.DescriptionEN == "" {
		writeErr(w, http.StatusBadRequest, "description_en is required")
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}
	if req.Quantity > maxLineQuantity {
		writeErr(w, http.StatusBadRequest, "quantity too large")
		return
	}
	if req.UnitPriceCents == nil || *req.UnitPriceCents < 0 {
		writeErr(w, http.StatusBadRequest, "unit_price_cents must be >= 0")
		return
	}
	if *req.UnitPriceCents > maxUnitPriceCent {
		writeErr(w, http.StatusBadRequest, "unit_price_cents too large")
		return
	}
	if req.Unit == "" {
		req.Unit = "item"
	}
	if req.Currency == "" {
		req.Currency = "THB"
	}
	if req.Currency != "THB" && req.Currency != "USD" {
		writeErr(w, http.StatusBadRequest, "currency must be THB or USD")
		return
	}
	// Enforce single currency per ticket.
	var existingCur string
	_ = h.DB.QueryRow(r.Context(), `SELECT currency FROM ticket_line_items WHERE ticket_id=$1 LIMIT 1`, ticketID).Scan(&existingCur)
	if existingCur != "" && existingCur != req.Currency {
		writeErr(w, http.StatusBadRequest, "ticket already uses "+existingCur+"; lines must share one currency")
		return
	}

	amount := int64(0)
	if !req.Covered {
		amount = int64(req.Quantity) * *req.UnitPriceCents
	}
	var id string
	_, err := h.inTxRecompute(r.Context(), ticketID, func(tx pgx.Tx) (int64, error) {
		return 1, tx.QueryRow(r.Context(), `
            INSERT INTO ticket_line_items
                (ticket_id, rate_card_item_id, description_en, description_th, unit,
                 quantity, unit_price_cents, covered, amount_cents, currency, sort_order)
            VALUES ($1,$2,$3,NULLIF($4,''),$5,$6,$7,$8,$9,$10,
                    COALESCE((SELECT MAX(sort_order)+10 FROM ticket_line_items WHERE ticket_id=$1),10))
            RETURNING id`,
			ticketID, rcID, req.DescriptionEN, req.DescriptionTH, req.Unit,
			req.Quantity, *req.UnitPriceCents, req.Covered, amount, req.Currency).Scan(&id)
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not add line")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// UpdateTicketLine — PATCH /customer/admin/tickets/{id}/line-items/{lineId}
func (h *AdminHandler) UpdateTicketLine(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "id")
	lineID := chi.URLParam(r, "lineId")
	var req struct {
		DescriptionEN  *string `json:"description_en"`
		DescriptionTH  *string `json:"description_th"`
		Unit           *string `json:"unit"`
		Quantity       *int    `json:"quantity"`
		UnitPriceCents *int64  `json:"unit_price_cents"`
		Covered        *bool   `json:"covered"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if code, msg := h.billingGuard(r.Context(), ticketID); code != 0 {
		writeErr(w, code, msg)
		return
	}
	if req.Quantity != nil && (*req.Quantity <= 0 || *req.Quantity > maxLineQuantity) {
		writeErr(w, http.StatusBadRequest, "quantity out of range")
		return
	}
	if req.UnitPriceCents != nil && (*req.UnitPriceCents < 0 || *req.UnitPriceCents > maxUnitPriceCent) {
		writeErr(w, http.StatusBadRequest, "unit_price_cents out of range")
		return
	}
	n, err := h.inTxRecompute(r.Context(), ticketID, func(tx pgx.Tx) (int64, error) {
		tag, e := tx.Exec(r.Context(), `
            UPDATE ticket_line_items SET
                description_en = COALESCE($3, description_en),
                description_th = COALESCE($4, description_th),
                unit = COALESCE($5, unit),
                quantity = COALESCE($6, quantity),
                unit_price_cents = COALESCE($7, unit_price_cents),
                covered = COALESCE($8, covered),
                amount_cents = CASE WHEN COALESCE($8, covered) THEN 0
                                    ELSE COALESCE($6, quantity) * COALESCE($7, unit_price_cents) END
            WHERE id = $1 AND ticket_id = $2`,
			lineID, ticketID, req.DescriptionEN, req.DescriptionTH, req.Unit,
			req.Quantity, req.UnitPriceCents, req.Covered)
		if e != nil {
			return 0, e
		}
		return tag.RowsAffected(), nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "line not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteTicketLine — DELETE /customer/admin/tickets/{id}/line-items/{lineId}
func (h *AdminHandler) DeleteTicketLine(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "id")
	lineID := chi.URLParam(r, "lineId")
	if code, msg := h.billingGuard(r.Context(), ticketID); code != 0 {
		writeErr(w, code, msg)
		return
	}
	n, err := h.inTxRecompute(r.Context(), ticketID, func(tx pgx.Tx) (int64, error) {
		tag, e := tx.Exec(r.Context(), `DELETE FROM ticket_line_items WHERE id=$1 AND ticket_id=$2`, lineID, ticketID)
		if e != nil {
			return 0, e
		}
		return tag.RowsAffected(), nil
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if n == 0 {
		writeErr(w, http.StatusNotFound, "line not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GenerateInvoice — POST /customer/admin/tickets/{id}/generate-invoice
// Builds a draft invoice from the ticket's BILLABLE lines via payment-api
// AdminCreate, forwarding the acting staff Bearer token. The whole operation
// runs under a FOR UPDATE lock on the ticket row so a double-click / concurrent
// call can't create two invoices.
func (h *AdminHandler) GenerateInvoice(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "id")
	ctx := r.Context()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	var (
		customerID    string
		contactID     *string
		subject       string
		existingInvID *string
	)
	err = tx.QueryRow(ctx,
		`SELECT customer_id, opened_by_contact_id, subject, invoice_id
		   FROM tickets WHERE id=$1 FOR UPDATE`,
		ticketID).Scan(&customerID, &contactID, &subject, &existingInvID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if existingInvID != nil {
		writeErr(w, http.StatusConflict, "ticket already has an invoice")
		return
	}

	// Approval gate: every billable ticket must have a customer-approved
	// quotation before an invoice can be generated (staff decision 2026-07-30).
	var approvedCount int
	if err := tx.QueryRow(ctx, `
        SELECT COUNT(*) FROM approvals
         WHERE subject_type='ticket' AND subject_id=$1 AND kind='quotation' AND status='approved'`,
		ticketID).Scan(&approvedCount); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if approvedCount == 0 {
		writeErr(w, http.StatusConflict, "an approved customer quotation is required before invoicing")
		return
	}

	lines, err := h.loadTicketLines(ctx, ticketID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	type invItem struct {
		ProductType    string  `json:"product_type"`
		ProductRef     *string `json:"product_ref"`
		DescriptionEN  string  `json:"description_en"`
		DescriptionTH  *string `json:"description_th"`
		Quantity       int     `json:"quantity"`
		UnitPriceCents int64   `json:"unit_price_cents"`
	}
	items := make([]invItem, 0, len(lines))
	currency := "THB"
	var billableSubtotal int64
	for _, l := range lines {
		if l.Covered {
			continue // covered lines aren't charged
		}
		currency = l.Currency
		billableSubtotal += l.AmountCents
		tid := l.TicketID
		items = append(items, invItem{
			ProductType: "ticket", ProductRef: &tid,
			DescriptionEN: l.DescriptionEN, DescriptionTH: l.DescriptionTH,
			Quantity: l.Quantity, UnitPriceCents: l.UnitPriceCents,
		})
	}
	if len(items) == 0 {
		writeErr(w, http.StatusBadRequest, "no billable lines to invoice")
		return
	}
	if billableSubtotal <= 0 {
		writeErr(w, http.StatusBadRequest, "billable total is zero; nothing to invoice")
		return
	}

	body, _ := json.Marshal(map[string]any{
		"customer_id": customerID,
		"contact_id":  contactID,
		"currency":    currency,
		"vat_rate_bp": ticketVATRateBP,
		"notes":       "Ticket charge: " + subject,
		"items":       items,
	})

	// Forward the caller's staff Authorization so payment-api records created_by.
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		h.Cfg.PaymentAPIURL+"/api/payment/admin/invoices", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", r.Header.Get("Authorization"))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeErr(w, http.StatusBadGateway, "could not reach billing service")
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		// Don't leak payment-api's raw internal error to the caller.
		log.Printf("generate-invoice: payment-api %d: %s", resp.StatusCode, string(respBody))
		writeErr(w, http.StatusBadGateway, fmt.Sprintf("billing service returned %d", resp.StatusCode))
		return
	}
	var created struct {
		ID            string `json:"id"`
		InvoiceNumber string `json:"invoice_number"`
	}
	if err := json.Unmarshal(respBody, &created); err != nil || created.ID == "" {
		writeErr(w, http.StatusBadGateway, "unexpected billing response")
		return
	}

	if _, err := tx.Exec(ctx, `UPDATE tickets SET invoice_id = $2 WHERE id = $1`, ticketID, created.ID); err != nil {
		writeErr(w, http.StatusInternalServerError, "invoice created but link failed: "+created.ID)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "invoice created but commit failed: "+created.ID)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{
		"invoice_id": created.ID, "invoice_number": created.InvoiceNumber,
	})
}

// ---- Portal (customer, read-only) ----

// PortalTicketBilling — GET /portal/tickets/{id}/billing
func (h *PortalHandler) PortalTicketBilling(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	id := chi.URLParam(r, "id")
	var owner string
	err := h.DB.QueryRow(r.Context(), `SELECT customer_id FROM tickets WHERE id=$1`, id).Scan(&owner)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) || owner != cid {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	a := &AdminHandler{DB: h.DB, Cfg: h.Cfg}
	b, err := a.buildBilling(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, b)
}
