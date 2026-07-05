package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// DisputeHandler exposes the dispute queue to admins. The actual
// dispute lifecycle is driven by PayPal webhooks (CUSTOMER.DISPUTE.*);
// this handler only reads.
type DisputeHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

func (h *DisputeHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("status"); v != "" {
		args = append(args, v)
		where = append(where, "d.status = $1")
	}
	sql := `
		SELECT d.id, d.payment_id, d.invoice_id, d.provider, d.provider_dispute_id,
		       d.reason, d.status, d.outcome, d.amount_cents, d.currency,
		       d.seller_response_due, d.opened_at, d.resolved_at,
		       p.payment_number, i.invoice_number, c.name
		  FROM payment_disputes d
		  JOIN payments  p ON p.id = d.payment_id
		  JOIN invoices  i ON i.id = d.invoice_id
		  JOIN customers c ON c.id = p.customer_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY d.opened_at DESC LIMIT 200`
	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, paymentID, invoiceID, provider, disputeID, status, currency string
			reason, outcome                                                 *string
			amount                                                          int64
			sellerDue                                                       *time.Time
			openedAt                                                        time.Time
			resolvedAt                                                      *time.Time
			payNumber, invNumber, customer                                  string
		)
		if err := rows.Scan(&id, &paymentID, &invoiceID, &provider, &disputeID,
			&reason, &status, &outcome, &amount, &currency,
			&sellerDue, &openedAt, &resolvedAt,
			&payNumber, &invNumber, &customer); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id": id, "payment_id": paymentID, "invoice_id": invoiceID,
			"provider": provider, "provider_dispute_id": disputeID,
			"reason": reason, "status": status, "outcome": outcome,
			"amount_cents": amount, "currency": currency,
			"seller_response_due": sellerDue, "opened_at": openedAt, "resolved_at": resolvedAt,
			"payment_number": payNumber, "invoice_number": invNumber, "customer_name": customer,
		})
	}
	writeJSON(w, 200, out)
}

// recordDispute is invoked from the webhook handler when a
// CUSTOMER.DISPUTE.* event lands. Idempotent — UPSERT on
// (provider, provider_dispute_id) so PayPal retries don't double-row.
//
// status flow:
//
//	CREATED      → open
//	UPDATED      → status from resource
//	RESOLVED     → resolved + flip payment back to 'completed' (or
//	               'refunded' if outcome favored buyer)
func recordDispute(ctx context.Context, db *pgxpool.Pool, event paypalDisputeEvent) error {
	// Find the payment by the disputed capture id (PayPal sends it
	// nested under disputed_transactions[*].seller_transaction_id).
	var paymentID, invoiceID, currency string
	var amountCents int64
	if err := db.QueryRow(ctx, `
		SELECT id, invoice_id, currency, amount_cents
		  FROM payments
		 WHERE provider = 'paypal' AND provider_capture_id = $1
		 LIMIT 1`, event.CaptureID).Scan(&paymentID, &invoiceID, &currency, &amountCents); err != nil {
		return fmt.Errorf("dispute %s: payment for capture %s not found", event.DisputeID, event.CaptureID)
	}

	// Normalise PayPal dispute status into our enum.
	status := normaliseDisputeStatus(event.Status)
	resolved := status == "resolved" || status == "closed"

	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	disputeAmount := event.AmountCents
	if disputeAmount <= 0 {
		disputeAmount = amountCents
	}
	rawJSON, _ := json.Marshal(event.Raw)

	if _, err := tx.Exec(ctx, `
		INSERT INTO payment_disputes
		    (payment_id, invoice_id, provider, provider_dispute_id,
		     reason, status, outcome, amount_cents, currency,
		     seller_response_due, resolved_at, raw_event)
		VALUES ($1, $2, 'paypal', $3, $4, $5, $6, $7, $8, $9,
		        CASE WHEN $5 IN ('resolved','closed') THEN NOW() ELSE NULL END,
		        $10::jsonb)
		ON CONFLICT (provider, provider_dispute_id) DO UPDATE SET
		    status = EXCLUDED.status,
		    outcome = COALESCE(EXCLUDED.outcome, payment_disputes.outcome),
		    reason  = COALESCE(EXCLUDED.reason,  payment_disputes.reason),
		    seller_response_due = COALESCE(EXCLUDED.seller_response_due, payment_disputes.seller_response_due),
		    resolved_at = CASE
		        WHEN EXCLUDED.status IN ('resolved','closed') THEN NOW()
		        ELSE payment_disputes.resolved_at END,
		    raw_event = EXCLUDED.raw_event`,
		paymentID, invoiceID, event.DisputeID,
		nullable(event.Reason), status, nullable(event.Outcome),
		disputeAmount, currency, event.SellerResponseDue,
		string(rawJSON)); err != nil {
		return err
	}

	// Flip payment status.
	switch {
	case !resolved:
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET status='disputed' WHERE id=$1 AND status='completed'`,
			paymentID); err != nil {
			return err
		}
	case event.Outcome == "BUYER_FAVOURED" || event.Outcome == "PARTIAL_REFUND":
		// Buyer won — money's gone. Reflect as refunded.
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET status='refunded' WHERE id=$1`, paymentID); err != nil {
			return err
		}
	default:
		// Seller won or otherwise resolved cleanly — restore completed.
		if _, err := tx.Exec(ctx,
			`UPDATE payments SET status='completed' WHERE id=$1 AND status='disputed'`,
			paymentID); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func normaliseDisputeStatus(s string) string {
	switch strings.ToUpper(s) {
	case "OPEN":
		return "open"
	case "WAITING_FOR_BUYER_RESPONSE":
		return "waiting_buyer"
	case "WAITING_FOR_SELLER_RESPONSE":
		return "waiting_seller"
	case "UNDER_REVIEW":
		return "under_review"
	case "RESOLVED":
		return "resolved"
	case "OTHER", "CLOSED":
		return "closed"
	}
	return "open"
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// paypalDisputeEvent is the minimal shape we extract from a dispute
// webhook resource. We accept whatever PayPal sends and only validate
// what we use.
type paypalDisputeEvent struct {
	DisputeID         string
	CaptureID         string
	Reason            string
	Status            string
	Outcome           string
	AmountCents       int64
	SellerResponseDue *time.Time
	Raw               json.RawMessage
}

// parsePayPalDispute pulls the fields we care about out of PayPal's
// dispute resource JSON. Reference shape (truncated):
//
//	{
//	  "dispute_id": "PP-D-...",
//	  "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
//	  "status": "OPEN",
//	  "dispute_amount": {"currency_code":"USD","value":"42.00"},
//	  "seller_response_due_date": "2026-04-01T00:00:00.000Z",
//	  "disputed_transactions":[{"seller_transaction_id":"...","seller_transaction_id":"..."}],
//	  "dispute_outcome": {"outcome_code":"SELLER_FAVOURED"}
//	}
func parsePayPalDispute(resource json.RawMessage) (paypalDisputeEvent, error) {
	var raw struct {
		DisputeID     string `json:"dispute_id"`
		Reason        string `json:"reason"`
		Status        string `json:"status"`
		DisputeAmount struct {
			CurrencyCode string `json:"currency_code"`
			Value        string `json:"value"`
		} `json:"dispute_amount"`
		SellerResponseDueDate string `json:"seller_response_due_date"`
		DisputedTransactions  []struct {
			SellerTransactionID string `json:"seller_transaction_id"`
		} `json:"disputed_transactions"`
		DisputeOutcome struct {
			OutcomeCode string `json:"outcome_code"`
		} `json:"dispute_outcome"`
	}
	if err := json.Unmarshal(resource, &raw); err != nil {
		return paypalDisputeEvent{}, err
	}
	if raw.DisputeID == "" {
		return paypalDisputeEvent{}, fmt.Errorf("missing dispute_id")
	}
	captureID := ""
	if len(raw.DisputedTransactions) > 0 {
		captureID = raw.DisputedTransactions[0].SellerTransactionID
	}
	if captureID == "" {
		return paypalDisputeEvent{}, fmt.Errorf("dispute %s: no seller_transaction_id", raw.DisputeID)
	}
	out := paypalDisputeEvent{
		DisputeID: raw.DisputeID,
		CaptureID: captureID,
		Reason:    raw.Reason,
		Status:    raw.Status,
		Outcome:   raw.DisputeOutcome.OutcomeCode,
		Raw:       resource,
	}
	// Decimal value → minor units (e.g. "42.00" → 4200).
	if raw.DisputeAmount.Value != "" {
		if v, err := decimalToCents(raw.DisputeAmount.Value); err == nil {
			out.AmountCents = v
		}
	}
	if raw.SellerResponseDueDate != "" {
		if t, err := time.Parse(time.RFC3339, raw.SellerResponseDueDate); err == nil {
			out.SellerResponseDue = &t
		}
	}
	return out, nil
}

func decimalToCents(s string) (int64, error) {
	dot := strings.Index(s, ".")
	intPart := s
	frac := ""
	if dot >= 0 {
		intPart = s[:dot]
		frac = s[dot+1:]
	}
	if len(frac) < 2 {
		frac = frac + strings.Repeat("0", 2-len(frac))
	}
	if len(frac) > 2 {
		frac = frac[:2]
	}
	combined := intPart + frac
	var n int64
	for _, c := range combined {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("non-digit %q", c)
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
}
