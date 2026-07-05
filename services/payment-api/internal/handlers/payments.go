package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
	"github.com/f2cothai/f2-website/services/payment-api/internal/paypal"
)

type PaymentHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
	PayPal *paypal.Client
}

// ---------- portal: initiate payment ----------

type initPayReq struct {
	Method string `json:"method"` // bank_transfer | thai_qr | promptpay | paypal
}

type initPayResp struct {
	PaymentID   string         `json:"payment_id"`
	Method      string         `json:"method"`
	Status      string         `json:"status"`
	ApprovalURL string         `json:"approval_url,omitempty"`
	Config      map[string]any `json:"method_config,omitempty"`
}

func (h *PaymentHandler) PortalInit(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	invID := chi.URLParam(r, "id")

	var req initPayReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if !validMethod(req.Method) {
		writeErr(w, 400, "invalid method")
		return
	}

	ctx, cancel := makeCtx()
	defer cancel()

	// Check method enabled + fetch config
	var enabled bool
	var methodCfg json.RawMessage
	if err := h.DB.QueryRow(ctx,
		`SELECT enabled, config FROM payment_methods_config WHERE method=$1`,
		req.Method).Scan(&enabled, &methodCfg); err != nil {
		writeErr(w, 400, "payment method not configured")
		return
	}
	if !enabled {
		writeErr(w, 409, "payment method disabled")
		return
	}

	// Validate invoice ownership + collect amount/currency/number
	var (
		status, currency, number string
		total, paid              int64
	)
	if err := h.DB.QueryRow(ctx, `
		SELECT status, currency, invoice_number, total_cents, amount_paid_cents
		  FROM invoices WHERE id=$1 AND customer_id=$2`,
		invID, cid).Scan(&status, &currency, &number, &total, &paid); err != nil {
		writeErr(w, 404, "invoice not found")
		return
	}
	if status == "paid" || status == "void" || status == "refunded" {
		writeErr(w, 409, "invoice is not payable in current state")
		return
	}
	due := total - paid
	if due <= 0 {
		writeErr(w, 409, "invoice already fully paid")
		return
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	payNumber, err := nextPaymentNumber(ctx, tx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	initStatus := "awaiting_verification"
	provider := ""
	if req.Method == "paypal" {
		initStatus = "pending"
		provider = "paypal"
	}

	expires := time.Now().Add(24 * time.Hour)
	var payID string
	err = tx.QueryRow(ctx, `
		INSERT INTO payments (
			payment_number, invoice_id, customer_id, method, status,
			amount_cents, currency, provider, expires_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9)
		RETURNING id`,
		payNumber, invID, cid, req.Method, initStatus, due, currency, provider, expires).
		Scan(&payID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	resp := initPayResp{PaymentID: payID, Method: req.Method, Status: initStatus}
	var cfgMap map[string]any
	_ = json.Unmarshal(methodCfg, &cfgMap)
	resp.Config = sanitizeMethodCfg(req.Method, cfgMap)

	if req.Method == "paypal" {
		if !h.PayPal.Enabled(ctx) {
			writeErr(w, 503, "paypal not configured")
			return
		}
		paypalCurrency := currency
		paypalAmount := due
		// PayPal does not natively support THB — when the invoice is in
		// THB, callers should expose a USD-converted invoice, or admins
		// should enable PayPal only for USD invoices. We still hand
		// PayPal whatever the invoice carries; conversion is out of scope.
		baseURL := strings.TrimRight(h.Cfg.PublicBaseURL, "/")
		returnURL := fmt.Sprintf("%s/payments/paypal/return?payment=%s", baseURL, payID)
		cancelURL := fmt.Sprintf("%s/payments/paypal/cancel?payment=%s", baseURL, payID)

		order, perr := h.PayPal.CreateOrder(ctx, paypal.CreateOrderInput{
			InvoiceNumber: number,
			Description:   "Invoice " + number,
			Amount: paypal.Money{
				CurrencyCode: paypalCurrency,
				Value:        fmt.Sprintf("%.2f", float64(paypalAmount)/100.0),
			},
			ReturnURL: returnURL,
			CancelURL: cancelURL,
		})
		if perr != nil {
			writeErr(w, 502, "paypal create order: "+perr.Error())
			return
		}
		approval := ""
		for _, l := range order.Links {
			if l.Rel == "approve" {
				approval = l.Href
				break
			}
		}
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET provider_order_id=$1 WHERE id=$2`,
			order.ID, payID); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		resp.ApprovalURL = approval
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, resp)
}

// ---------- portal: upload bank-transfer slip ----------

type uploadSlipReq struct {
	SlipURL       string `json:"slip_url"`
	BankRef       string `json:"bank_ref"`
	TransferredAt string `json:"transferred_at"` // ISO 8601
}

func (h *PaymentHandler) PortalUploadSlip(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	payID := chi.URLParam(r, "payID")
	var req uploadSlipReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.SlipURL == "" {
		writeErr(w, 400, "slip_url required")
		return
	}
	var transferred any
	if req.TransferredAt != "" {
		if t, err := time.Parse(time.RFC3339, req.TransferredAt); err == nil {
			transferred = t
		}
	}

	ctx, cancel := makeCtx()
	defer cancel()
	tag, err := h.DB.Exec(ctx, `
		UPDATE payments
		   SET slip_url=$1, slip_uploaded_at=NOW(),
		       bank_ref=NULLIF($2,''), transferred_at=$3,
		       status='awaiting_verification'
		 WHERE id=$4 AND customer_id=$5
		   AND method IN ('bank_transfer','thai_qr','promptpay')
		   AND status IN ('pending','awaiting_verification')`,
		req.SlipURL, req.BankRef, transferred, payID, cid)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "payment not found or not in uploadable state")
		return
	}

	// Notify billing team that a slip is awaiting verification.
	h.Notify.Send(notify.Job{
		Template:  "payment_slip_received",
		ToAddress: h.Cfg.BillingNotifyTo,
		Payload: map[string]any{
			"payment_id": payID,
			"slip_url":   req.SlipURL,
			"bank_ref":   req.BankRef,
		},
	})
	writeJSON(w, 200, map[string]string{"status": "awaiting_verification"})
}

// ---------- portal: capture PayPal after redirect ----------

func (h *PaymentHandler) PortalCapturePayPal(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	payID := chi.URLParam(r, "payID")

	ctx, cancel := makeCtx()
	defer cancel()
	var (
		invoiceID, status, orderID, currency string
		amount                               int64
	)
	if err := h.DB.QueryRow(ctx, `
		SELECT invoice_id, status, COALESCE(provider_order_id,''), currency, amount_cents
		  FROM payments WHERE id=$1 AND customer_id=$2`,
		payID, cid).Scan(&invoiceID, &status, &orderID, &currency, &amount); err != nil {
		writeErr(w, 404, "payment not found")
		return
	}
	if status == "completed" {
		writeJSON(w, 200, map[string]string{"status": "completed"})
		return
	}
	if orderID == "" {
		writeErr(w, 409, "no paypal order on this payment")
		return
	}

	res, err := h.PayPal.CaptureOrder(ctx, orderID)
	if err != nil {
		_, _ = h.DB.Exec(ctx,
			`UPDATE payments SET status='failed', failure_reason=$1 WHERE id=$2`,
			err.Error(), payID)
		writeErr(w, 502, err.Error())
		return
	}
	if res.Status != "COMPLETED" {
		_, _ = h.DB.Exec(ctx,
			`UPDATE payments SET status='failed', failure_reason=$1 WHERE id=$2`,
			"paypal status "+res.Status, payID)
		writeErr(w, 409, "paypal status "+res.Status)
		return
	}
	if err := h.markCompleted(ctx, payID, "paypal", res.CaptureID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "completed"})
}

// ---------- admin endpoints ----------

func (h *PaymentHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("status"); v != "" {
		args = append(args, v)
		where = append(where, fmt.Sprintf("p.status = $%d", len(args)))
	}
	if v := q.Get("method"); v != "" {
		args = append(args, v)
		where = append(where, fmt.Sprintf("p.method = $%d", len(args)))
	}
	sql := `
		SELECT p.id, p.payment_number, p.invoice_id, p.customer_id, p.method, p.status,
		       p.amount_cents, p.currency, p.provider, p.provider_order_id, p.provider_capture_id,
		       p.slip_url, p.slip_uploaded_at, p.bank_ref, p.transferred_at, p.verified_at,
		       p.rejected_reason, p.paid_at, p.expires_at, p.failure_reason, p.metadata,
		       p.created_at, p.updated_at,
		       c.name, i.invoice_number
		  FROM payments p
		  JOIN customers c ON c.id = p.customer_id
		  JOIN invoices  i ON i.id = p.invoice_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY p.created_at DESC LIMIT 200`
	rows, err := h.DB.Query(ctx, sql, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	type row struct {
		ID, PaymentNumber, InvoiceID, CustomerID, Method, Status, Currency string
		Provider, ProviderOrderID, ProviderCaptureID                       *string
		SlipURL, BankRef, RejectedReason, FailureReason                    *string
		AmountCents                                                        int64
		SlipUploadedAt, TransferredAt, VerifiedAt, PaidAt, ExpiresAt       *time.Time
		Metadata                                                           json.RawMessage
		CreatedAt, UpdatedAt                                               time.Time
		CustomerName, InvoiceNumber                                        string
	}
	out := []map[string]any{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.ID, &x.PaymentNumber, &x.InvoiceID, &x.CustomerID, &x.Method, &x.Status,
			&x.AmountCents, &x.Currency, &x.Provider, &x.ProviderOrderID, &x.ProviderCaptureID,
			&x.SlipURL, &x.SlipUploadedAt, &x.BankRef, &x.TransferredAt, &x.VerifiedAt,
			&x.RejectedReason, &x.PaidAt, &x.ExpiresAt, &x.FailureReason, &x.Metadata,
			&x.CreatedAt, &x.UpdatedAt, &x.CustomerName, &x.InvoiceNumber); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id": x.ID, "payment_number": x.PaymentNumber, "invoice_id": x.InvoiceID,
			"customer_id": x.CustomerID, "customer_name": x.CustomerName,
			"invoice_number": x.InvoiceNumber,
			"method":         x.Method, "status": x.Status,
			"amount_cents": x.AmountCents, "currency": x.Currency,
			"provider": x.Provider, "provider_order_id": x.ProviderOrderID,
			"provider_capture_id": x.ProviderCaptureID,
			"slip_url":            x.SlipURL, "slip_uploaded_at": x.SlipUploadedAt,
			"bank_ref": x.BankRef, "transferred_at": x.TransferredAt,
			"verified_at": x.VerifiedAt, "rejected_reason": x.RejectedReason,
			"paid_at": x.PaidAt, "expires_at": x.ExpiresAt,
			"failure_reason": x.FailureReason, "metadata": x.Metadata,
			"created_at": x.CreatedAt, "updated_at": x.UpdatedAt,
		})
	}
	writeJSON(w, 200, out)
}

func (h *PaymentHandler) AdminVerify(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := userID(r)
	var verifier any
	if uid != "" {
		verifier = uid
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
	if err := tx.QueryRow(ctx, `SELECT status FROM payments WHERE id=$1 FOR UPDATE`, id).Scan(&status); err != nil {
		writeErr(w, 404, "payment not found")
		return
	}
	if status != "awaiting_verification" {
		writeErr(w, 409, "payment not in awaiting_verification state")
		return
	}
	if _, err := tx.Exec(ctx, `
		UPDATE payments
		   SET status='completed', verified_by_user_id=$1, verified_at=NOW(), paid_at=NOW()
		 WHERE id=$2`, verifier, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := reconcileInvoice(ctx, tx, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	h.notifyPaid(id)
	writeJSON(w, 200, map[string]string{"status": "completed"})
}

func (h *PaymentHandler) AdminReject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	ctx, cancel := makeCtx()
	defer cancel()
	tag, err := h.DB.Exec(ctx, `
		UPDATE payments SET status='failed', rejected_reason=$1, failure_reason=$1
		 WHERE id=$2 AND status='awaiting_verification'`,
		body.Reason, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 409, "payment not in awaiting_verification state")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "failed"})
}

// ---------- helpers ----------

func validMethod(m string) bool {
	switch m {
	case "bank_transfer", "thai_qr", "promptpay", "paypal":
		return true
	}
	return false
}

// sanitizeMethodCfg removes server-only keys before returning method
// config to the portal (e.g. PayPal client secret never goes back).
func sanitizeMethodCfg(method string, in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	if method != "paypal" {
		return in
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		switch k {
		case "client_id_public", "merchant_email", "environment":
			out[k] = v
		}
	}
	return out
}

// markCompleted sets the payment to completed and reconciles the parent
// invoice's amount_paid_cents / status. Caller holds no transaction —
// we open one here.
func (h *PaymentHandler) markCompleted(ctx context.Context, payID, provider, captureID string) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE payments
		   SET status='completed', paid_at=NOW(),
		       provider=COALESCE(provider, $1),
		       provider_capture_id=$2
		 WHERE id=$3`, provider, captureID, payID); err != nil {
		return err
	}
	if err := reconcileInvoice(ctx, tx, payID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	h.notifyPaid(payID)
	return nil
}

// reconcileInvoice recomputes amount_paid_cents on the parent invoice
// based on the sum of all completed payments, and updates status:
//   - completed sum >= total  →  paid
//   - completed sum > 0       →  partially_paid
//   - otherwise               →  unchanged
//
// Side effect on transition to 'paid': scheduling an async
// autoRestoreForInvoice() so any active service suspensions tied to
// this invoice get released. We do this outside the tx because the
// restore needs to see the committed 'paid' status.
func reconcileInvoice(ctx context.Context, tx pgx.Tx, paymentID string) error {
	var invID string
	if err := tx.QueryRow(ctx,
		`SELECT invoice_id FROM payments WHERE id=$1`, paymentID).Scan(&invID); err != nil {
		return err
	}
	var total, paid int64
	if err := tx.QueryRow(ctx, `
		SELECT i.total_cents,
		       COALESCE((SELECT SUM(p.amount_cents)
		                   FROM payments p
		                  WHERE p.invoice_id=i.id AND p.status='completed'), 0)
		  FROM invoices i WHERE i.id=$1`, invID).Scan(&total, &paid); err != nil {
		return err
	}
	newStatus := ""
	switch {
	case paid >= total && total > 0:
		newStatus = "paid"
	case paid > 0:
		newStatus = "partially_paid"
	}
	if newStatus == "paid" {
		if _, err := tx.Exec(ctx,
			`UPDATE invoices SET amount_paid_cents=$1, status='paid', paid_at=COALESCE(paid_at, NOW())
			  WHERE id=$2`, paid, invID); err != nil {
			return err
		}
		// Schedule the auto-restore once the tx commits. The closure
		// runs even if the surrounding handler returns, so the customer
		// gets services back even on a slow connection.
		afterCommitAutoRestore(invID)
		return nil
	}
	if newStatus == "partially_paid" {
		_, err := tx.Exec(ctx,
			`UPDATE invoices SET amount_paid_cents=$1, status='partially_paid'
			  WHERE id=$2 AND status NOT IN ('paid','void','refunded')`, paid, invID)
		return err
	}
	_, err := tx.Exec(ctx,
		`UPDATE invoices SET amount_paid_cents=$1 WHERE id=$2`, paid, invID)
	return err
}

// autoRestoreDB is set at server boot so reconcileInvoice can fire the
// auto-restore goroutine without a circular dep. nil-safe — tests can
// call reconcileInvoice without wiring the pool.
var autoRestoreDB *pgxpool.Pool

// SetAutoRestorePool wires the pool used by the auto-restore goroutine
// kicked off by reconcileInvoice. Call once during server startup.
func SetAutoRestorePool(p *pgxpool.Pool) { autoRestoreDB = p }

func afterCommitAutoRestore(invoiceID string) {
	if autoRestoreDB == nil {
		return
	}
	go func() {
		ctx, cancel := makeCtx()
		defer cancel()
		_ = autoRestoreForInvoice(ctx, autoRestoreDB, invoiceID)
	}()
}

// notifyPaid emails the customer that their payment cleared, attaching
// a receipt PDF (the same data model rendered with doc_type=receipt).
// Best-effort throughout — a missing PDF doesn't block the email.
func (h *PaymentHandler) notifyPaid(payID string) {
	ctx, cancel := makeCtx()
	defer cancel()
	var (
		to, locale, invNumber, payNumber, currency, invoiceID string
		amount                                                int64
	)
	// Resolve the billing recipient via the shared helper — same
	// resolution order as dunning (billing profile → owner contact →
	// any active contact). Was previously joining on the non-existent
	// customer_contacts.is_primary column and silently returning "".
	var customerID string
	if err := h.DB.QueryRow(ctx, `
		SELECT i.invoice_number, p.payment_number,
		       i.currency, p.amount_cents, i.id::text, p.customer_id::text
		  FROM payments p
		  JOIN invoices i ON i.id = p.invoice_id
		 WHERE p.id=$1 LIMIT 1`, payID).
		Scan(&invNumber, &payNumber, &currency, &amount, &invoiceID, &customerID); err != nil {
		return
	}
	to, locale = lookupBillingContact(ctx, h.DB, customerID)
	if to == "" {
		return
	}
	var atts []notify.Attachment
	if pdfBytes, name, err := RenderInvoicePDF(ctx, h.DB, invoiceID, "receipt"); err == nil {
		atts = []notify.Attachment{{Filename: name, ContentType: "application/pdf", Content: pdfBytes}}
	}
	h.Notify.Send(notify.Job{
		Template:  "payment_received",
		ToAddress: to,
		Locale:    locale,
		Payload: map[string]any{
			"invoice_number": invNumber,
			"payment_number": payNumber,
			"amount":         fmt.Sprintf("%.2f", float64(amount)/100.0),
			"currency":       currency,
		},
		Attachments: atts,
	})
}
