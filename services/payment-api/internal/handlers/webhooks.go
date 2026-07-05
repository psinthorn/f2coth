package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
	"github.com/f2cothai/f2-website/services/payment-api/internal/paypal"
)

type WebhookHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
	PayPal *paypal.Client
}

type paypalEvent struct {
	ID         string          `json:"id"`
	EventType  string          `json:"event_type"`
	Resource   json.RawMessage `json:"resource"`
	ResourceID string          `json:"-"`
}

// PayPal receives all CHECKOUT.ORDER.* and PAYMENT.CAPTURE.* events. We
// dedupe on (provider, event_id) so retries are no-ops. The signature
// verification call goes back to PayPal — if the webhook_id is not set
// we record the event but skip processing (safer than auto-trusting in
// production).
func (h *WebhookHandler) HandlePayPal(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeErr(w, 400, "read body")
		return
	}
	defer r.Body.Close()

	var evt paypalEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if evt.ID == "" || evt.EventType == "" {
		writeErr(w, 400, "missing event id or type")
		return
	}

	ctx := r.Context()
	verified := false
	paypalMode := GetMethodMode(ctx, h.DB, "paypal")
	hasWebhookID := h.PayPal.WebhookID(ctx) != ""

	switch {
	case h.PayPal.Enabled(ctx) && hasWebhookID:
		// Normal path — verify signature against PayPal Verify Webhook API.
		ok, vErr := h.PayPal.VerifyWebhook(ctx, r.Header, body)
		if vErr != nil {
			_, _ = h.DB.Exec(ctx, `
				INSERT INTO payment_webhook_events
				    (provider, event_id, event_type, payload, signature_ok, error)
				VALUES ('paypal',$1,$2,$3::jsonb,false,$4)
				ON CONFLICT (provider, event_id) DO NOTHING`,
				evt.ID, evt.EventType, string(body), vErr.Error())
			writeErr(w, 401, "signature verification failed")
			return
		}
		verified = ok
	case paypalMode == "production" && !hasWebhookID:
		// Hard refuse in production when admins haven't entered the
		// webhook id yet — accepting unsigned events here would let a
		// spoofer mark invoices paid.
		_, _ = h.DB.Exec(ctx, `
			INSERT INTO payment_webhook_events
			    (provider, event_id, event_type, payload, signature_ok, error)
			VALUES ('paypal',$1,$2,$3::jsonb,false,'webhook_id not configured in production mode')
			ON CONFLICT (provider, event_id) DO NOTHING`,
			evt.ID, evt.EventType, string(body))
		log.Printf("paypal webhook refused: production mode but webhook_id not set")
		writeErr(w, 503, "webhook_id not configured for production mode")
		return
	default:
		// Sandbox without webhook_id → log + accept but flag unsigned.
		// The /admin/webhooks page surfaces signature_ok=false rows
		// with a "Signed/Unsigned" pill so this is obvious.
		log.Printf("paypal webhook: accepting unsigned event %s (mode=%s, has_webhook_id=%v)",
			evt.EventType, paypalMode, hasWebhookID)
	}

	// Idempotent record-and-process
	var (
		eventRowID  string
		alreadySeen bool
	)
	err = h.DB.QueryRow(ctx, `
		INSERT INTO payment_webhook_events
		    (provider, event_id, event_type, payload, signature_ok)
		VALUES ('paypal',$1,$2,$3::jsonb,$4)
		ON CONFLICT (provider, event_id) DO NOTHING
		RETURNING id`,
		evt.ID, evt.EventType, string(body), verified).Scan(&eventRowID)
	if err != nil {
		// ON CONFLICT DO NOTHING returns zero rows → already processed.
		alreadySeen = true
	}
	if alreadySeen {
		writeJSON(w, 200, map[string]string{"status": "duplicate"})
		return
	}

	// Process: only PAYMENT.CAPTURE.COMPLETED moves a payment to completed.
	// Other events (denied, refunded) trigger a status change too.
	switch evt.EventType {
	case "PAYMENT.CAPTURE.COMPLETED":
		var res struct {
			ID                string `json:"id"`
			SupplementaryData struct {
				RelatedIDs struct {
					OrderID string `json:"order_id"`
				} `json:"related_ids"`
			} `json:"supplementary_data"`
		}
		_ = json.Unmarshal(evt.Resource, &res)
		if res.SupplementaryData.RelatedIDs.OrderID != "" {
			if err := h.completeByOrderID(ctx, res.SupplementaryData.RelatedIDs.OrderID, res.ID); err != nil {
				_, _ = h.DB.Exec(ctx,
					`UPDATE payment_webhook_events SET error=$1 WHERE id=$2`,
					err.Error(), eventRowID)
				writeErr(w, 500, err.Error())
				return
			}
		}
	case "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED":
		var res struct {
			SupplementaryData struct {
				RelatedIDs struct {
					OrderID string `json:"order_id"`
				} `json:"related_ids"`
			} `json:"supplementary_data"`
		}
		_ = json.Unmarshal(evt.Resource, &res)
		if oid := res.SupplementaryData.RelatedIDs.OrderID; oid != "" {
			_, _ = h.DB.Exec(ctx, `
				UPDATE payments
				   SET status='failed', failure_reason=$1
				 WHERE provider='paypal' AND provider_order_id=$2 AND status<>'completed'`,
				evt.EventType, oid)
		}
	case "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED":
		de, derr := parsePayPalDispute(evt.Resource)
		if derr != nil {
			_, _ = h.DB.Exec(ctx,
				`UPDATE payment_webhook_events SET error=$1 WHERE id=$2`,
				"dispute parse: "+derr.Error(), eventRowID)
			writeErr(w, 422, derr.Error())
			return
		}
		if err := recordDispute(ctx, h.DB, de); err != nil {
			_, _ = h.DB.Exec(ctx,
				`UPDATE payment_webhook_events SET error=$1 WHERE id=$2`, err.Error(), eventRowID)
			writeErr(w, 500, err.Error())
			return
		}
	}

	_, _ = h.DB.Exec(ctx,
		`UPDATE payment_webhook_events SET processed_at=NOW() WHERE id=$1`, eventRowID)
	writeJSON(w, 200, map[string]string{"status": "ok"})
}

// completeByOrderID finds the payment row for a PayPal order_id and
// reconciles its invoice. Reuses the PaymentHandler.markCompleted path
// by inlining the same transaction; we duplicate a few lines instead of
// pulling in a circular dependency on PaymentHandler.
func (h *WebhookHandler) completeByOrderID(ctx context.Context, orderID, captureID string) error {
	var payID string
	if err := h.DB.QueryRow(ctx,
		`SELECT id FROM payments
		  WHERE provider='paypal' AND provider_order_id=$1`, orderID).Scan(&payID); err != nil {
		return err
	}
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE payments
		   SET status='completed', paid_at=NOW(), provider_capture_id=$1
		 WHERE id=$2 AND status<>'completed'`, captureID, payID); err != nil {
		return err
	}
	if err := reconcileInvoice(ctx, tx, payID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	// Email customer
	h.notifyPaid(payID)
	return nil
}

func (h *WebhookHandler) notifyPaid(payID string) {
	ctx, cancel := makeCtx()
	defer cancel()
	var to, locale, invNumber, payNumber, currency string
	var amount int64
	if err := h.DB.QueryRow(ctx, `
		SELECT cc.email, COALESCE(cc.locale,'en'), i.invoice_number, p.payment_number,
		       i.currency, p.amount_cents
		  FROM payments p
		  JOIN invoices i ON i.id = p.invoice_id
		  JOIN customers c ON c.id = p.customer_id
		  LEFT JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.is_primary = true
		 WHERE p.id=$1 LIMIT 1`, payID).
		Scan(&to, &locale, &invNumber, &payNumber, &currency, &amount); err != nil || to == "" {
		return
	}
	h.Notify.Send(notify.Job{
		Template:  "payment_received",
		ToAddress: to,
		Locale:    locale,
		Payload: map[string]any{
			"invoice_number": invNumber,
			"payment_number": payNumber,
			"amount":         float64(amount) / 100.0,
			"currency":       currency,
		},
	})
}
