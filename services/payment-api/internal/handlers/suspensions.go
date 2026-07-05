package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// SuspensionHandler exposes the service_suspensions ledger to admins.
// The dunning scheduler creates rows; admins can browse, manually
// restore (e.g. after speaking to the customer), or override (cancel
// the suspension without doing anything else).
type SuspensionHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

// PortalList — customer self-service. Returns active suspensions for
// the JWT customer so the portal banner can warn the user that
// services are paused due to an unpaid invoice.
func (h *SuspensionHandler) PortalList(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT s.id, s.invoice_id, i.invoice_number, s.product_type, s.suspended_at
		  FROM service_suspensions s
		  JOIN invoices i ON i.id = s.invoice_id
		 WHERE s.customer_id = $1 AND s.status = 'active'
		 ORDER BY s.suspended_at DESC`, cid)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, invoiceID, invoiceNumber, productType string
			suspendedAt                               time.Time
		)
		if err := rows.Scan(&id, &invoiceID, &invoiceNumber, &productType, &suspendedAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id": id, "invoice_id": invoiceID, "invoice_number": invoiceNumber,
			"product_type": productType, "suspended_at": suspendedAt,
		})
	}
	writeJSON(w, 200, out)
}

// AdminList — every suspension row (filter by ?status=active by default
// for the queue use case).
func (h *SuspensionHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("status"); v != "" {
		args = append(args, v)
		where = append(where, "s.status = $1")
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT s.id, s.invoice_id, s.customer_id, s.product_type, s.product_ref,
		       s.previous_state, s.status, s.reason,
		       s.suspended_at, s.restored_at,
		       i.invoice_number, c.name
		  FROM service_suspensions s
		  JOIN invoices  i ON i.id = s.invoice_id
		  JOIN customers c ON c.id = s.customer_id
		 WHERE `+strings.Join(where, " AND ")+`
		 ORDER BY s.suspended_at DESC LIMIT 200`,
		args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id, invoiceID, customerID, productType, status, invNumber, customer string
			productRef, prevState, reason                                       *string
			suspendedAt                                                         time.Time
			restoredAt                                                          *time.Time
		)
		if err := rows.Scan(&id, &invoiceID, &customerID, &productType, &productRef,
			&prevState, &status, &reason, &suspendedAt, &restoredAt,
			&invNumber, &customer); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id": id, "invoice_id": invoiceID, "customer_id": customerID,
			"customer_name": customer, "invoice_number": invNumber,
			"product_type": productType, "product_ref": productRef,
			"previous_state": prevState, "status": status, "reason": reason,
			"suspended_at": suspendedAt, "restored_at": restoredAt,
		})
	}
	writeJSON(w, 200, out)
}

// AdminRestore — manual restore of a single suspension. Calls the same
// helper used by the auto-restore path so the resource-flipping logic
// is centralised in one place.
func (h *SuspensionHandler) AdminRestore(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := userID(r)
	var actor any
	if uid != "" {
		actor = uid
	}
	ctx, cancel := makeCtx()
	defer cancel()
	if err := restoreSuspension(ctx, h.DB, id, actor, false); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "restored"})
}

// AdminOverride — mark a suspension `overridden` without actually
// restoring the underlying resource. Useful when admin has already
// fixed the resource by hand and just wants to clear the queue.
func (h *SuspensionHandler) AdminOverride(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := userID(r)
	var actor any
	if uid != "" {
		actor = uid
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	tag, err := h.DB.Exec(r.Context(), `
		UPDATE service_suspensions
		   SET status='overridden', restored_at=NOW(), restored_by_user_id=$1,
		       reason = COALESCE(NULLIF($2,''), reason)
		 WHERE id=$3 AND status='active'`, actor, body.Reason, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 409, "suspension not in active state")
		return
	}
	writeJSON(w, 200, map[string]string{"status": "overridden"})
}

// suspendOne creates a suspension row and flips the targeted resource
// into its paused/suspended state. Idempotent via the UNIQUE constraint
// — if the same (invoice, product) is already suspended we return ok
// without producing a second row.
func suspendOne(ctx context.Context, tx pgx.Tx,
	invoiceID, customerID, productType string, productRef *string) (created bool, prevState string, err error) {

	// 1. Snapshot the current resource state for the auto-restore path.
	prevState = ""
	switch productType {
	case "subscription":
		if productRef == nil {
			return false, "", nil
		}
		_ = tx.QueryRow(ctx,
			`SELECT status FROM subscriptions WHERE id=$1`, *productRef).Scan(&prevState)
	case "sla":
		if productRef == nil {
			return false, "", nil
		}
		_ = tx.QueryRow(ctx,
			`SELECT status FROM customer_sla_contracts WHERE id=$1`, *productRef).Scan(&prevState)
	}

	// 2. Insert the suspension row. ON CONFLICT keeps us idempotent.
	var newID string
	if err = tx.QueryRow(ctx, `
		INSERT INTO service_suspensions
		    (invoice_id, customer_id, product_type, product_ref, previous_state, reason)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),'auto-suspended by dunning scheduler')
		ON CONFLICT (invoice_id, product_type, product_ref) DO NOTHING
		RETURNING id`,
		invoiceID, customerID, productType, productRef, prevState).Scan(&newID); err != nil {
		// pgx returns ErrNoRows when ON CONFLICT skipped — treat as "already done".
		return false, prevState, nil
	}

	// 3. Flip the underlying resource. We do this AFTER the suspension
	// row is committed so we always have an audit trail even when the
	// resource flip fails.
	switch productType {
	case "subscription":
		if productRef != nil {
			_, err = tx.Exec(ctx,
				`UPDATE subscriptions SET status='paused' WHERE id=$1 AND status='active'`, *productRef)
		}
	case "sla":
		if productRef != nil {
			_, err = tx.Exec(ctx,
				`UPDATE customer_sla_contracts SET status='suspended' WHERE id=$1 AND status IN ('active','renewing')`, *productRef)
		}
	}
	return true, prevState, err
}

// restoreSuspension flips the resource back to its previous_state and
// marks the row 'restored'. Used by both the auto-restore-on-paid path
// and the manual admin endpoint. byScheduler distinguishes audit log.
func restoreSuspension(ctx context.Context, db *pgxpool.Pool, id string, actor any, byScheduler bool) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var (
		productType string
		productRef  *string
		prevState   *string
		status      string
	)
	if err := tx.QueryRow(ctx, `
		SELECT product_type, product_ref, previous_state, status
		  FROM service_suspensions WHERE id=$1 FOR UPDATE`, id).
		Scan(&productType, &productRef, &prevState, &status); err != nil {
		return err
	}
	if status != "active" {
		return nil // already restored / overridden
	}

	// Restore the underlying resource.
	switch productType {
	case "subscription":
		if productRef != nil {
			target := "active"
			if prevState != nil && *prevState != "" {
				target = *prevState
			}
			if _, err := tx.Exec(ctx,
				`UPDATE subscriptions SET status=$1 WHERE id=$2 AND status='paused'`,
				target, *productRef); err != nil {
				return err
			}
		}
	case "sla":
		if productRef != nil {
			target := "active"
			if prevState != nil && *prevState != "" {
				target = *prevState
			}
			if _, err := tx.Exec(ctx,
				`UPDATE customer_sla_contracts SET status=$1 WHERE id=$2 AND status='suspended'`,
				target, *productRef); err != nil {
				return err
			}
		}
	}

	if _, err := tx.Exec(ctx, `
		UPDATE service_suspensions
		   SET status='restored', restored_at=NOW(), restored_by_user_id=$1,
		       metadata = metadata || jsonb_build_object('restored_by', $2)
		 WHERE id=$3`, actor, restorerLabel(byScheduler), id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func restorerLabel(byScheduler bool) string {
	if byScheduler {
		return "scheduler"
	}
	return "admin"
}

// autoRestoreForInvoice is called from reconcileInvoice when an invoice
// transitions to 'paid'. Walks every active suspension row tied to the
// invoice and restores them. Best-effort — a failure in one resource
// flip doesn't stop the others.
func autoRestoreForInvoice(ctx context.Context, db *pgxpool.Pool, invoiceID string) error {
	rows, err := db.Query(ctx,
		`SELECT id FROM service_suspensions WHERE invoice_id=$1 AND status='active'`, invoiceID)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		_ = restoreSuspension(ctx, db, id, nil, true)
	}
	return nil
}
