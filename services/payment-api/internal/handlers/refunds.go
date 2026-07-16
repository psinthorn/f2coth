package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
	"github.com/f2cothai/f2-website/services/payment-api/internal/paypal"
)

// RefundHandler issues + tracks refunds. PayPal refunds go through the
// Refunds v2 API; bank_transfer / Thai QR / PromptPay refunds are
// recorded manually so the audit trail still shows who refunded what,
// when, and with which bank reference.
type RefundHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
	PayPal *paypal.Client
}

type refundReq struct {
	PaymentID   string `json:"payment_id"`
	AmountCents int64  `json:"amount_cents"` // optional — defaults to full payment amount
	Reason      string `json:"reason"`
	BankRef     string `json:"bank_ref,omitempty"`  // manual methods
	ProofURL    string `json:"proof_url,omitempty"` // manual methods
}

type refundResp struct {
	ID           string `json:"id"`
	RefundNumber string `json:"refund_number"`
	Status       string `json:"status"`
}

// AdminCreate issues a refund in two crash-safe phases:
//
//	Phase 1 (transactional, no external calls): validate the payment,
//	  check the amount against the *remaining* refundable balance (payment
//	  amount minus refunds already completed/in-flight), then INSERT the
//	  refund row as `pending` and COMMIT. The intent is now durable.
//	Phase 2 (side effects): for PayPal, call the Refunds API keyed on the
//	  refund id (PayPal-Request-Id) so a retry can never move money twice;
//	  then finalize the row to `completed` and apply it to the payment in
//	  a fresh transaction. On PayPal failure the row is marked `failed`.
//
// Splitting the phases means an executed PayPal refund is never lost to a
// DB rollback, and the idempotency key makes recovering a stuck `pending`
// refund safe. Manual methods (bank_transfer/thai_qr/promptpay) have no
// external side effect and finalize immediately.
func (h *RefundHandler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var req refundReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if req.PaymentID == "" || req.Reason == "" {
		writeErr(w, 400, "payment_id and reason required")
		return
	}
	uid := userID(r)
	var issuer any
	if uid != "" {
		issuer = uid
	}

	ctx, cancel := makeCtx()
	defer cancel()

	// ---- Phase 1: validate + persist a PENDING refund (no external calls) ----
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var (
		invoiceID, method, status, currency string
		captureID                           *string
		amountCents                         int64
	)
	if err := tx.QueryRow(ctx, `
		SELECT invoice_id, method, status, currency, amount_cents, provider_capture_id
		  FROM payments WHERE id=$1 FOR UPDATE`,
		req.PaymentID).Scan(&invoiceID, &method, &status, &currency, &amountCents, &captureID); err != nil {
		writeErr(w, 404, "payment not found")
		return
	}
	if status != "completed" {
		writeErr(w, 409, "can only refund completed payments")
		return
	}

	// Refundable balance = payment amount minus refunds already completed
	// or in-flight. The FOR UPDATE lock above serialises concurrent refund
	// requests against the same payment, so this sum can't race. This is
	// what stops two partial refunds each ≤ the full amount from together
	// over-refunding the payment.
	var alreadyRefunded int64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_cents),0) FROM refunds
		 WHERE payment_id=$1 AND status IN ('completed','pending')`,
		req.PaymentID).Scan(&alreadyRefunded); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	refundable := amountCents - alreadyRefunded
	amount := req.AmountCents
	if amount <= 0 {
		amount = refundable
	}
	if refundable <= 0 || amount <= 0 {
		writeErr(w, 409, "payment already fully refunded")
		return
	}
	if amount > refundable {
		writeErr(w, 400, "refund amount exceeds refundable balance")
		return
	}

	// Method-specific pre-checks — reject before we persist anything.
	switch method {
	case "paypal":
		if captureID == nil || *captureID == "" {
			writeErr(w, 409, "paypal payment has no capture id to refund")
			return
		}
	case "bank_transfer", "thai_qr", "promptpay":
		if req.BankRef == "" && req.ProofURL == "" {
			writeErr(w, 400, "manual refunds require bank_ref or proof_url")
			return
		}
	default:
		writeErr(w, 409, "unsupported method for refund: "+method)
		return
	}

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('refund_number_seq')`).Scan(&seq); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	refundNumber := fmt.Sprintf("REF-%d-%06d", time.Now().Year(), seq)

	var refundID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO refunds (
			refund_number, payment_id, invoice_id, method,
			amount_cents, currency, reason,
			bank_ref, proof_url, status, issued_by_user_id
		) VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),NULLIF($9,''),'pending',$10)
		RETURNING id`,
		refundNumber, req.PaymentID, invoiceID, method,
		amount, currency, req.Reason,
		req.BankRef, req.ProofURL, issuer).Scan(&refundID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// ---- Phase 2: execute side effects (refund row is now durable) ----
	var providerRefundID *string
	if method == "paypal" {
		// Idempotency key = refund id, so retrying this exact refund row
		// never issues a second PayPal refund.
		id, perr := h.refundPayPal(ctx, *captureID, amount, currency, req.Reason, refundID)
		if perr != nil {
			_, _ = h.DB.Exec(ctx,
				`UPDATE refunds SET status='failed', failure_reason=$1 WHERE id=$2 AND status='pending'`,
				perr.Error(), refundID)
			writeErr(w, 502, "paypal refund: "+perr.Error())
			return
		}
		providerRefundID = &id
	}

	if err := h.finalizeRefund(ctx, refundID, req.PaymentID, amount, amountCents, providerRefundID); err != nil {
		// The refund succeeded at the provider but bookkeeping failed; the
		// row stays `pending` and can be reconciled. Surface a 500 so the
		// caller knows not to treat it as clean.
		writeErr(w, 500, "refund executed but finalize failed: "+err.Error())
		return
	}

	writeJSON(w, 201, refundResp{
		ID:           refundID,
		RefundNumber: refundNumber,
		Status:       "completed",
	})
}

// finalizeRefund flips a pending refund to completed and applies it to the
// parent payment/invoice, in a single transaction. Idempotent: if the row
// is no longer `pending` (already finalized by a prior attempt) it returns
// without double-applying.
func (h *RefundHandler) finalizeRefund(ctx context.Context, refundID, paymentID string, amount, originalCents int64, providerRefundID *string) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE refunds
		   SET status='completed', completed_at=NOW(),
		       provider_refund_id=COALESCE($1, provider_refund_id)
		 WHERE id=$2 AND status='pending'`, providerRefundID, refundID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Already finalized — don't apply the amount to the payment twice.
		return nil
	}
	if err := applyRefundToPayment(ctx, tx, paymentID, amount, originalCents); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// applyRefundToPayment flips the parent payment to 'refunded' when the
// refund covers the full amount, and reconciles invoice.amount_paid_cents.
// Partial refunds keep the payment 'completed' and just deduct from
// amount_paid_cents.
func applyRefundToPayment(ctx context.Context, tx pgx.Tx, paymentID string, refundedCents, originalCents int64) error {
	// Flip the payment to 'refunded' once CUMULATIVE completed refunds cover
	// the full amount — not just when a single refund does. The caller marks
	// this refund 'completed' before calling us, so the sum already includes
	// it. Without this, several partial refunds that together equal the
	// payment would leave it stuck 'completed'.
	var totalRefunded int64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_cents),0) FROM refunds
		  WHERE payment_id=$1 AND status='completed'`, paymentID).Scan(&totalRefunded); err != nil {
		return err
	}
	if totalRefunded >= originalCents {
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET status='refunded' WHERE id=$1`, paymentID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE invoices
		   SET amount_paid_cents = GREATEST(amount_paid_cents - $1, 0),
		       status = CASE
		         WHEN GREATEST(amount_paid_cents - $1, 0) = 0 THEN 'refunded'
		         WHEN GREATEST(amount_paid_cents - $1, 0) < total_cents THEN 'partially_paid'
		         ELSE status
		       END
		 WHERE id = (SELECT invoice_id FROM payments WHERE id=$2)`,
		refundedCents, paymentID); err != nil {
		return err
	}
	return nil
}

// AdminList — refund history. Optional ?status= filter.
func (h *RefundHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("status"); v != "" {
		args = append(args, v)
		where = append(where, "r.status = $1")
	}
	sql := `
		SELECT r.id, r.refund_number, r.payment_id, r.invoice_id, r.method,
		       r.amount_cents, r.currency, r.reason, r.status,
		       r.provider_refund_id, r.bank_ref, r.proof_url,
		       r.completed_at, r.failure_reason, r.created_at,
		       p.payment_number, i.invoice_number, c.name
		  FROM refunds r
		  JOIN payments p   ON p.id = r.payment_id
		  JOIN invoices i   ON i.id = r.invoice_id
		  JOIN customers c  ON c.id = p.customer_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY r.created_at DESC LIMIT 200`
	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, number, paymentID, invoiceID, method, currency, reason, status string
			amountCents                                                        int64
			providerID, bankRef, proofURL, failure                             *string
			completedAt                                                        *time.Time
			createdAt                                                          time.Time
			paymentNumber, invoiceNumber, customer                             string
		)
		if err := rows.Scan(&id, &number, &paymentID, &invoiceID, &method,
			&amountCents, &currency, &reason, &status,
			&providerID, &bankRef, &proofURL,
			&completedAt, &failure, &createdAt,
			&paymentNumber, &invoiceNumber, &customer); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id":                 id,
			"refund_number":      number,
			"payment_id":         paymentID,
			"payment_number":     paymentNumber,
			"invoice_id":         invoiceID,
			"invoice_number":     invoiceNumber,
			"customer_name":      customer,
			"method":             method,
			"amount_cents":       amountCents,
			"currency":           currency,
			"reason":             reason,
			"status":             status,
			"provider_refund_id": providerID,
			"bank_ref":           bankRef,
			"proof_url":          proofURL,
			"completed_at":       completedAt,
			"failure_reason":     failure,
			"created_at":         createdAt,
		})
	}
	writeJSON(w, 200, out)
}

// refundPayPal issues a refund against a capture id using the PayPal
// Refunds v2 API. requestID is passed as PayPal-Request-Id for
// idempotency. Returns the provider refund id on success.
func (h *RefundHandler) refundPayPal(ctx context.Context, captureID string, amountCents int64, currency, reason, requestID string) (string, error) {
	id, err := h.PayPal.RefundCapture(ctx, paypal.RefundInput{
		CaptureID:   captureID,
		Amount:      paypal.Money{CurrencyCode: currency, Value: fmt.Sprintf("%.2f", float64(amountCents)/100.0)},
		NoteToPayer: reason,
		InvoiceID:   "",
		RequestID:   requestID,
	})
	return id, err
}
