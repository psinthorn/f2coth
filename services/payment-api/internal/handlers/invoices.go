package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/models"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
)

type InvoiceHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
}

// ---------- request shapes ----------

type itemInput struct {
	ProductType    string  `json:"product_type"`
	ProductRef     *string `json:"product_ref"`
	DescriptionEN  string  `json:"description_en"`
	DescriptionTH  *string `json:"description_th"`
	Quantity       int     `json:"quantity"`
	UnitPriceCents int64   `json:"unit_price_cents"`
	PeriodStart    *string `json:"period_start"`
	PeriodEnd      *string `json:"period_end"`
}

type createInvoiceReq struct {
	CustomerID string      `json:"customer_id"`
	ContactID  *string     `json:"contact_id"`
	Currency   string      `json:"currency"`
	VATRateBP  *int        `json:"vat_rate_bp"`
	DueDate    *string     `json:"due_date"`
	Notes      *string     `json:"notes"`
	Items      []itemInput `json:"items"`
}

type updateInvoiceReq struct {
	DueDate *string     `json:"due_date"`
	Notes   *string     `json:"notes"`
	Items   []itemInput `json:"items"`
}

// ---------- admin endpoints ----------

func (h *InvoiceHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("status"); v != "" {
		args = append(args, v)
		where = append(where, fmt.Sprintf("i.status = $%d", len(args)))
	}
	if v := q.Get("customer_id"); v != "" {
		args = append(args, v)
		where = append(where, fmt.Sprintf("i.customer_id = $%d", len(args)))
	}

	sql := `
		SELECT i.id, i.invoice_number, i.customer_id, i.contact_id, i.status, i.currency,
		       i.subtotal_cents, i.vat_rate_bp, i.vat_cents, i.total_cents, i.amount_paid_cents,
		       i.issue_date, i.due_date, i.paid_at, i.voided_at, i.void_reason, i.notes,
		       i.doc_type, i.metadata, i.billing_snapshot, i.created_at, i.updated_at, c.name
		  FROM invoices i
		  JOIN customers c ON c.id = i.customer_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY i.created_at DESC
		 LIMIT 200`
	rows, err := h.DB.Query(ctx, sql, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []models.Invoice{}
	for rows.Next() {
		inv, err := scanInvoiceRow(rows)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, inv)
	}
	writeJSON(w, 200, out)
}

func (h *InvoiceHandler) AdminGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	inv, err := h.load(r, id, "")
	if err != nil {
		writeErr(w, 404, "invoice not found")
		return
	}
	writeJSON(w, 200, inv)
}

func (h *InvoiceHandler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var req createInvoiceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.CustomerID == "" || len(req.Items) == 0 {
		writeErr(w, 400, "customer_id and at least one item required")
		return
	}
	currency := strings.ToUpper(strings.TrimSpace(req.Currency))
	if currency == "" {
		currency = "THB"
	}
	vatBP := 700
	if req.VATRateBP != nil {
		vatBP = *req.VATRateBP
	}

	ctx, cancel := makeCtx()
	defer cancel()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	number, err := nextInvoiceNumber(ctx, tx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	subtotal, items := computeItems(req.Items)
	vat := subtotal * int64(vatBP) / 10000
	total := subtotal + vat

	var dueDate any
	if req.DueDate != nil && *req.DueDate != "" {
		dueDate = *req.DueDate
	} else {
		dueDate = time.Now().AddDate(0, 0, 7).Format("2006-01-02")
	}

	creatorID := userID(r)
	var creator any
	if creatorID != "" {
		creator = creatorID
	}

	var invID string
	err = tx.QueryRow(ctx, `
		INSERT INTO invoices (
			invoice_number, customer_id, contact_id, status, currency,
			subtotal_cents, vat_rate_bp, vat_cents, total_cents,
			due_date, notes, created_by
		) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id`,
		number, req.CustomerID, req.ContactID, currency,
		subtotal, vatBP, vat, total, dueDate, req.Notes, creator).
		Scan(&invID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	for i, it := range items {
		_, err := tx.Exec(ctx, `
			INSERT INTO invoice_items (
				invoice_id, product_type, product_ref, description_en, description_th,
				quantity, unit_price_cents, total_cents, period_start, period_end, sort_order
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			invID, it.ProductType, it.ProductRef, it.DescriptionEN, it.DescriptionTH,
			it.Quantity, it.UnitPriceCents, it.computedTotal(), it.PeriodStart, it.PeriodEnd, i)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	inv, _ := h.load(r, invID, "")
	writeJSON(w, 201, inv)
}

func (h *InvoiceHandler) AdminUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateInvoiceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}

	ctx, cancel := makeCtx()
	defer cancel()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var status string
	var vatBP int
	if err := tx.QueryRow(ctx,
		`SELECT status, vat_rate_bp FROM invoices WHERE id=$1`, id).
		Scan(&status, &vatBP); err != nil {
		writeErr(w, 404, "invoice not found")
		return
	}
	if status != "draft" {
		writeErr(w, 409, "only draft invoices can be edited")
		return
	}

	if req.Items != nil {
		subtotal, items := computeItems(req.Items)
		vat := subtotal * int64(vatBP) / 10000
		total := subtotal + vat

		if _, err := tx.Exec(ctx, `DELETE FROM invoice_items WHERE invoice_id=$1`, id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		for i, it := range items {
			if _, err := tx.Exec(ctx, `
				INSERT INTO invoice_items (
					invoice_id, product_type, product_ref, description_en, description_th,
					quantity, unit_price_cents, total_cents, period_start, period_end, sort_order
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				id, it.ProductType, it.ProductRef, it.DescriptionEN, it.DescriptionTH,
				it.Quantity, it.UnitPriceCents, it.computedTotal(), it.PeriodStart, it.PeriodEnd, i); err != nil {
				writeErr(w, 500, err.Error())
				return
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE invoices SET subtotal_cents=$1, vat_cents=$2, total_cents=$3 WHERE id=$4`,
			subtotal, vat, total, id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}
	if req.DueDate != nil {
		if _, err := tx.Exec(ctx, `UPDATE invoices SET due_date=$1 WHERE id=$2`, *req.DueDate, id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}
	if req.Notes != nil {
		if _, err := tx.Exec(ctx, `UPDATE invoices SET notes=$1 WHERE id=$2`, *req.Notes, id); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	inv, _ := h.load(r, id, "")
	writeJSON(w, 200, inv)
}

func (h *InvoiceHandler) AdminIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ctx, cancel := makeCtx()
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// Snapshot the customer's billing profile so the issued doc never
	// shifts if the profile is later edited (Thai Revenue compliance —
	// historical tax invoices must reflect data as-of issue time).
	var snapshot []byte
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(to_jsonb(p), '{}'::jsonb)::text::bytea
		  FROM customer_billing_profiles p
		  JOIN invoices i ON i.customer_id = p.customer_id
		 WHERE i.id = $1`, id).Scan(&snapshot); err != nil {
		snapshot = []byte("{}") // no profile yet — empty snapshot is fine
	}

	tag, err := tx.Exec(ctx, `
		UPDATE invoices
		   SET status='issued',
		       issue_date=COALESCE(issue_date, CURRENT_DATE),
		       billing_snapshot=$1::jsonb,
		       doc_type=CASE
		           WHEN doc_type='draft' OR doc_type='' THEN 'invoice'
		           ELSE doc_type
		       END
		 WHERE id=$2 AND status='draft'`, string(snapshot), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 409, "invoice not in draft state")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	h.sendInvoiceIssuedEmail(r, id)
	inv, _ := h.load(r, id, "")
	writeJSON(w, 200, inv)
}

func (h *InvoiceHandler) AdminVoid(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	ctx, cancel := makeCtx()
	defer cancel()
	tag, err := h.DB.Exec(ctx, `
		UPDATE invoices SET status='void', voided_at=NOW(), void_reason=$1
		 WHERE id=$2 AND status IN ('draft','issued','partially_paid','overdue')`,
		body.Reason, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 409, "invoice cannot be voided in its current state")
		return
	}
	inv, _ := h.load(r, id, "")
	writeJSON(w, 200, inv)
}

// ---------- portal endpoints ----------

func (h *InvoiceHandler) PortalList(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	ctx := r.Context()
	rows, err := h.DB.Query(ctx, `
		SELECT i.id, i.invoice_number, i.customer_id, i.contact_id, i.status, i.currency,
		       i.subtotal_cents, i.vat_rate_bp, i.vat_cents, i.total_cents, i.amount_paid_cents,
		       i.issue_date, i.due_date, i.paid_at, i.voided_at, i.void_reason, i.notes,
		       i.doc_type, i.metadata, i.billing_snapshot, i.created_at, i.updated_at, c.name
		  FROM invoices i JOIN customers c ON c.id=i.customer_id
		 WHERE i.customer_id=$1 AND i.status <> 'draft'
		 ORDER BY i.created_at DESC LIMIT 200`, cid)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []models.Invoice{}
	for rows.Next() {
		inv, err := scanInvoiceRow(rows)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, inv)
	}
	writeJSON(w, 200, out)
}

func (h *InvoiceHandler) PortalGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	inv, err := h.load(r, id, cid)
	if err != nil {
		writeErr(w, 404, "invoice not found")
		return
	}
	if inv.Status == "draft" {
		writeErr(w, 404, "invoice not found")
		return
	}
	writeJSON(w, 200, inv)
}

// ---------- helpers ----------

func computeItems(in []itemInput) (int64, []itemInput) {
	out := make([]itemInput, 0, len(in))
	var subtotal int64
	for _, it := range in {
		q := it.Quantity
		if q < 1 {
			q = 1
		}
		it.Quantity = q
		it.UnitPriceCents = max64(0, it.UnitPriceCents)
		// Recompute total server-side; never trust client.
		// We don't expose total in itemInput — derive here.
		// Reuse it via a parallel slice with the computed total.
		out = append(out, it)
		subtotal += int64(q) * it.UnitPriceCents
	}
	// Attach computed totals via a second pass on the slice; since
	// itemInput has no TotalCents field we extend through a parallel
	// computation: rebuild as []itemInput then have caller pull totals
	// from quantity*unit_price.
	return subtotal, out
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func (it itemInput) computedTotal() int64 {
	q := it.Quantity
	if q < 1 {
		q = 1
	}
	return int64(q) * it.UnitPriceCents
}

// load fetches an invoice + items + payments. When customerScope is
// non-empty, the row must belong to that customer.
func (h *InvoiceHandler) load(r *http.Request, id, customerScope string) (*models.Invoice, error) {
	ctx, cancel := makeCtx()
	defer cancel()
	row := h.DB.QueryRow(ctx, `
		SELECT i.id, i.invoice_number, i.customer_id, i.contact_id, i.status, i.currency,
		       i.subtotal_cents, i.vat_rate_bp, i.vat_cents, i.total_cents, i.amount_paid_cents,
		       i.issue_date, i.due_date, i.paid_at, i.voided_at, i.void_reason, i.notes,
		       i.doc_type, i.metadata, i.billing_snapshot, i.created_at, i.updated_at, c.name
		  FROM invoices i JOIN customers c ON c.id=i.customer_id
		 WHERE i.id=$1 AND ($2='' OR i.customer_id=$2::uuid)`,
		id, customerScope)
	inv, err := scanInvoiceRow(row)
	if err != nil {
		return nil, err
	}

	itemRows, err := h.DB.Query(ctx, `
		SELECT id, invoice_id, product_type, product_ref, description_en, description_th,
		       quantity, unit_price_cents, total_cents,
		       to_char(period_start,'YYYY-MM-DD'), to_char(period_end,'YYYY-MM-DD'), sort_order
		  FROM invoice_items WHERE invoice_id=$1 ORDER BY sort_order, id`, id)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var it models.InvoiceItem
		var pStart, pEnd *string
		if err := itemRows.Scan(&it.ID, &it.InvoiceID, &it.ProductType, &it.ProductRef,
			&it.DescriptionEN, &it.DescriptionTH, &it.Quantity, &it.UnitPriceCents,
			&it.TotalCents, &pStart, &pEnd, &it.SortOrder); err != nil {
			return nil, err
		}
		it.PeriodStart = pStart
		it.PeriodEnd = pEnd
		inv.Items = append(inv.Items, it)
	}

	payRows, err := h.DB.Query(ctx, `
		SELECT id, payment_number, invoice_id, customer_id, method, status,
		       amount_cents, currency, provider, provider_order_id, provider_capture_id,
		       slip_url, slip_uploaded_at, bank_ref, transferred_at, verified_at,
		       rejected_reason, paid_at, expires_at, failure_reason, metadata,
		       created_at, updated_at
		  FROM payments WHERE invoice_id=$1 ORDER BY created_at DESC`, id)
	if err != nil {
		return nil, err
	}
	defer payRows.Close()
	for payRows.Next() {
		var p models.Payment
		if err := payRows.Scan(&p.ID, &p.PaymentNumber, &p.InvoiceID, &p.CustomerID,
			&p.Method, &p.Status, &p.AmountCents, &p.Currency, &p.Provider,
			&p.ProviderOrderID, &p.ProviderCaptureID, &p.SlipURL, &p.SlipUploadedAt,
			&p.BankRef, &p.TransferredAt, &p.VerifiedAt, &p.RejectedReason,
			&p.PaidAt, &p.ExpiresAt, &p.FailureReason, &p.Metadata,
			&p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		inv.Payments = append(inv.Payments, p)
	}
	return &inv, nil
}

// rowScanner abstracts pgx.Row / pgx.Rows for the common scan.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanInvoiceRow(rs rowScanner) (models.Invoice, error) {
	var i models.Invoice
	// Non-nil empty slices so JSON always emits `[]` (never null/omitted).
	// The full-invoice endpoints overwrite these via load(); list endpoints
	// leave them empty, which is the honest "not loaded here" shape.
	i.Items = []models.InvoiceItem{}
	i.Payments = []models.Payment{}
	err := rs.Scan(
		&i.ID, &i.InvoiceNumber, &i.CustomerID, &i.ContactID, &i.Status, &i.Currency,
		&i.SubtotalCents, &i.VATRateBP, &i.VATCents, &i.TotalCents, &i.AmountPaidCents,
		&i.IssueDate, &i.DueDate, &i.PaidAt, &i.VoidedAt, &i.VoidReason, &i.Notes,
		&i.DocType, &i.Metadata, &i.BillingSnapshot,
		&i.CreatedAt, &i.UpdatedAt, &i.CustomerName,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return models.Invoice{}, err
	}
	return i, err
}

// sendInvoiceIssuedEmail is best-effort — looks up the billing contact
// and enqueues a templated email through notification-api.
func (h *InvoiceHandler) sendInvoiceIssuedEmail(r *http.Request, invoiceID string) {
	ctx, cancel := makeCtx()
	defer cancel()
	var (
		to, locale, number string
		totalCents         int64
		currency           string
	)
	// Recipient via shared lookupBillingContact — was previously joining
	// on non-existent customer_contacts.is_primary, silently returning ""
	// so admin-triggered invoice_issued emails never actually sent.
	var customerID string
	err := h.DB.QueryRow(ctx, `
		SELECT i.invoice_number, i.total_cents, i.currency, i.customer_id::text
		  FROM invoices i
		 WHERE i.id=$1 LIMIT 1`, invoiceID).Scan(&number, &totalCents, &currency, &customerID)
	if err != nil {
		return
	}
	to, locale = lookupBillingContact(ctx, h.DB, customerID)
	if to == "" {
		return
	}
	portalLink := strings.TrimRight(h.Cfg.PortalBaseURL, "/") + "/portal/billing/" + invoiceID

	// Best-effort PDF attachment. If rendering fails (font load, DB
	// hiccup) we still send the email — the customer always has the
	// portal link as a fallback.
	var atts []notify.Attachment
	if pdfBytes, name, err := RenderInvoicePDF(r.Context(), h.DB, invoiceID, ""); err == nil {
		atts = []notify.Attachment{{Filename: name, ContentType: "application/pdf", Content: pdfBytes}}
	}

	h.Notify.Send(notify.Job{
		Template:  "invoice_issued",
		ToAddress: to,
		Locale:    locale,
		Payload: map[string]any{
			"invoice_number": number,
			"amount":         fmt.Sprintf("%.2f", float64(totalCents)/100.0),
			"currency":       currency,
			"portal_link":    portalLink,
		},
		Attachments: atts,
	})
}
