package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
)

// BulkOpsHandler runs the bulk-action endpoints used on the admin
// invoice list page. Each action is best-effort: if some ids fail, the
// rest still apply and the response reports counts.
type BulkOpsHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
	// Sharing the same invoice issue path as the per-row admin endpoint
	// keeps the billing-snapshot + email-notification side effects
	// identical between single + bulk paths.
	InvoiceHandler *InvoiceHandler
}

type bulkReq struct {
	IDs    []string `json:"ids"`
	Reason string   `json:"reason,omitempty"`
}

type bulkResp struct {
	Succeeded int      `json:"succeeded"`
	Skipped   int      `json:"skipped"`
	Errors    []string `json:"errors,omitempty"`
}

// AdminBulkIssue flips a batch of draft invoices to 'issued' + sends
// the customer email for each. Rows that aren't 'draft' are silently
// skipped (idempotent for repeat clicks).
func (h *BulkOpsHandler) AdminBulkIssue(w http.ResponseWriter, r *http.Request) {
	var req bulkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if len(req.IDs) == 0 {
		writeErr(w, 400, "ids required")
		return
	}

	ctx, cancel := makeCtx()
	defer cancel()

	res := bulkResp{Errors: []string{}}
	for _, id := range req.IDs {
		ok, err := h.bulkIssueOne(ctx, r, id)
		switch {
		case err != nil:
			res.Errors = append(res.Errors, id+": "+err.Error())
		case ok:
			res.Succeeded++
		default:
			res.Skipped++
		}
	}
	writeJSON(w, 200, res)
}

func (h *BulkOpsHandler) bulkIssueOne(ctx context.Context, r *http.Request, id string) (bool, error) {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var snapshot []byte
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(to_jsonb(p), '{}'::jsonb)::text::bytea
		  FROM customer_billing_profiles p
		  JOIN invoices i ON i.customer_id = p.customer_id
		 WHERE i.id = $1`, id).Scan(&snapshot); err != nil {
		snapshot = []byte("{}")
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
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil // skipped — not in draft state
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	// Reuse the existing email helper from InvoiceHandler so wording
	// stays identical across single and bulk paths.
	h.InvoiceHandler.sendInvoiceIssuedEmail(r, id)
	return true, nil
}

// AdminBulkVoid voids a batch of invoices. Requires a reason.
func (h *BulkOpsHandler) AdminBulkVoid(w http.ResponseWriter, r *http.Request) {
	var req bulkReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if len(req.IDs) == 0 {
		writeErr(w, 400, "ids required")
		return
	}
	if strings.TrimSpace(req.Reason) == "" {
		writeErr(w, 400, "reason required")
		return
	}

	ctx, cancel := makeCtx()
	defer cancel()

	res := bulkResp{}
	tag, err := h.DB.Exec(ctx, `
		UPDATE invoices
		   SET status='void', voided_at=NOW(), void_reason=$1
		 WHERE id = ANY($2)
		   AND status IN ('draft','issued','partially_paid','overdue')`,
		req.Reason, req.IDs)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	res.Succeeded = int(tag.RowsAffected())
	res.Skipped = len(req.IDs) - res.Succeeded
	writeJSON(w, 200, res)
}
