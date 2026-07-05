package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
	"github.com/f2cothai/f2-website/services/payment-api/internal/paypal"
)

// WebhookAdminHandler exposes the payment_webhook_events table to the
// admin console so staff can see what PayPal sent, whether we accepted
// the signature, and whether the event was processed. A small but
// important corner of the operational surface.
type WebhookAdminHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
	PayPal *paypal.Client
}

func (h *WebhookAdminHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("provider"); v != "" {
		args = append(args, v)
		where = append(where, "provider = $1")
	}
	if v := q.Get("processed"); v != "" {
		if v == "true" {
			where = append(where, "processed_at IS NOT NULL")
		} else if v == "false" {
			where = append(where, "processed_at IS NULL")
		}
	}
	sql := `
		SELECT e.id, e.provider, e.event_id, e.event_type, e.signature_ok,
		       e.processed_at, e.payment_id, e.error, e.received_at,
		       p.payment_number, p.invoice_id
		  FROM payment_webhook_events e
		  LEFT JOIN payments p ON p.id = e.payment_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY e.received_at DESC LIMIT 200`
	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, provider, eventID, eventType string
			signatureOK                      bool
			processedAt                      *time.Time
			paymentID                        *string
			errStr                           *string
			receivedAt                       time.Time
			paymentNumber, invoiceID         *string
		)
		if err := rows.Scan(&id, &provider, &eventID, &eventType, &signatureOK,
			&processedAt, &paymentID, &errStr, &receivedAt,
			&paymentNumber, &invoiceID); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id": id, "provider": provider, "event_id": eventID,
			"event_type": eventType, "signature_ok": signatureOK,
			"processed_at": processedAt, "payment_id": paymentID,
			"payment_number": paymentNumber, "invoice_id": invoiceID,
			"error":       errStr,
			"received_at": receivedAt,
		})
	}
	writeJSON(w, 200, out)
}

// AdminReplay re-runs the processing path for a stored event. Useful
// when the original handling failed (transient DB error, etc.) — admin
// fixes the underlying issue then clicks Replay. Only meaningful for
// COMPLETED captures right now; other event types are no-ops.
//
// Idempotent: re-running against an already-completed payment leaves
// it alone (markCompleted only flips status<>'completed' rows).
func (h *WebhookAdminHandler) AdminReplay(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var (
		eventType string
		payload   []byte
	)
	if err := h.DB.QueryRow(r.Context(),
		`SELECT event_type, payload::text::bytea FROM payment_webhook_events WHERE id=$1`, id).
		Scan(&eventType, &payload); err != nil {
		writeErr(w, 404, "event not found")
		return
	}

	if eventType != "PAYMENT.CAPTURE.COMPLETED" {
		// Other types don't move state in our handler. Mark as
		// processed and return — saves admin from confusing retries.
		_, _ = h.DB.Exec(r.Context(),
			`UPDATE payment_webhook_events SET processed_at=NOW(), error=NULL WHERE id=$1`, id)
		writeJSON(w, 200, map[string]string{"status": "noop", "event_type": eventType})
		return
	}

	var parsed struct {
		Resource struct {
			ID                string `json:"id"`
			SupplementaryData struct {
				RelatedIDs struct {
					OrderID string `json:"order_id"`
				} `json:"related_ids"`
			} `json:"supplementary_data"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(payload, &parsed); err != nil {
		writeErr(w, 500, "decode payload: "+err.Error())
		return
	}
	orderID := parsed.Resource.SupplementaryData.RelatedIDs.OrderID
	if orderID == "" {
		_, _ = h.DB.Exec(r.Context(),
			`UPDATE payment_webhook_events SET error=$1 WHERE id=$2`,
			"replay: no order_id in payload", id)
		writeErr(w, 422, "no order_id in payload")
		return
	}

	wh := &WebhookHandler{DB: h.DB, Cfg: h.Cfg, Notify: h.Notify, PayPal: h.PayPal}
	if err := wh.completeByOrderID(r.Context(), orderID, parsed.Resource.ID); err != nil {
		_, _ = h.DB.Exec(r.Context(),
			`UPDATE payment_webhook_events SET error=$1 WHERE id=$2`, "replay: "+err.Error(), id)
		writeErr(w, 500, err.Error())
		return
	}
	_, _ = h.DB.Exec(r.Context(),
		`UPDATE payment_webhook_events SET processed_at=NOW(), error=NULL WHERE id=$1`, id)
	writeJSON(w, 200, map[string]string{"status": "replayed", "order_id": orderID})
}

func (h *WebhookAdminHandler) AdminGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var (
		provider, eventID, eventType, payload string
		signatureOK                           bool
		processedAt                           *time.Time
		paymentID, errStr                     *string
		receivedAt                            time.Time
	)
	if err := h.DB.QueryRow(r.Context(), `
		SELECT provider, event_id, event_type, signature_ok,
		       processed_at, payment_id, error, payload::text, received_at
		  FROM payment_webhook_events WHERE id=$1`, id).
		Scan(&provider, &eventID, &eventType, &signatureOK,
			&processedAt, &paymentID, &errStr, &payload, &receivedAt); err != nil {
		writeErr(w, 404, "event not found")
		return
	}
	writeJSON(w, 200, map[string]any{
		"id": id, "provider": provider, "event_id": eventID,
		"event_type": eventType, "signature_ok": signatureOK,
		"processed_at": processedAt, "payment_id": paymentID,
		"error":       errStr,
		"received_at": receivedAt,
		"payload":     payload,
	})
}
