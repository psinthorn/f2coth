package handlers

import (
	"context"
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
)

// SubscriptionHandler exposes the admin CRUD for the recurring-billing
// engine. Subscriptions describe "a customer pays X per cycle" — the
// scheduler goroutine (scheduler.go) generates invoices from these
// rows ahead of `next_billing_at`.
type SubscriptionHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type subscription struct {
	ID            string          `json:"id"`
	CustomerID    string          `json:"customer_id"`
	CustomerName  string          `json:"customer_name,omitempty"`
	Title         string          `json:"title"`
	ProductType   string          `json:"product_type"`
	ProductRef    *string         `json:"product_ref,omitempty"`
	BillingCycle  string          `json:"billing_cycle"`
	AmountCents   int64           `json:"amount_cents"`
	Currency      string          `json:"currency"`
	Status        string          `json:"status"`
	StartsOn      string          `json:"starts_on"`
	EndsOn        *string         `json:"ends_on,omitempty"`
	LastBilledOn  *string         `json:"last_billed_on,omitempty"`
	NextBillingAt string          `json:"next_billing_at"`
	Metadata      json.RawMessage `json:"metadata,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

func (h *SubscriptionHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []any{}
	if v := q.Get("status"); v != "" {
		args = append(args, v)
		where = append(where, "s.status = $1")
	}
	sql := `
		SELECT s.id, s.customer_id, c.name, s.title, s.product_type, s.product_ref,
		       s.billing_cycle, s.amount_cents, s.currency, s.status,
		       to_char(s.starts_on,'YYYY-MM-DD'),
		       to_char(s.ends_on,'YYYY-MM-DD'),
		       to_char(s.last_billed_on,'YYYY-MM-DD'),
		       to_char(s.next_billing_at,'YYYY-MM-DD'),
		       s.metadata, s.created_at, s.updated_at
		  FROM subscriptions s
		  JOIN customers c ON c.id = s.customer_id
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY s.next_billing_at ASC LIMIT 200`
	rows, err := h.DB.Query(r.Context(), sql, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []subscription{}
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, s)
	}
	writeJSON(w, 200, out)
}

type subscriptionInput struct {
	CustomerID   string  `json:"customer_id"`
	Title        string  `json:"title"`
	ProductType  string  `json:"product_type"`
	ProductRef   *string `json:"product_ref"`
	BillingCycle string  `json:"billing_cycle"`
	AmountCents  int64   `json:"amount_cents"`
	Currency     string  `json:"currency"`
	StartsOn     string  `json:"starts_on"`
	EndsOn       *string `json:"ends_on"`
	TrialEndOn   *string `json:"trial_end_on"` // first bill deferred to here
	CouponCode   *string `json:"coupon_code"`  // applied to every generated invoice
}

func (h *SubscriptionHandler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var in subscriptionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if in.CustomerID == "" || in.Title == "" || in.BillingCycle == "" ||
		in.StartsOn == "" || in.AmountCents <= 0 {
		writeErr(w, 400, "customer_id, title, billing_cycle, starts_on and a positive amount_cents are required")
		return
	}
	if in.Currency == "" {
		in.Currency = "THB"
	}
	if in.ProductType == "" {
		in.ProductType = "custom"
	}
	creatorID := userID(r)
	var creator any
	if creatorID != "" {
		creator = creatorID
	}

	ctx, cancel := makeCtx()
	defer cancel()

	// A trial defers the first invoice: next_billing_at = trial end when
	// present, else the start date.
	var id string
	err := h.DB.QueryRow(ctx, `
		INSERT INTO subscriptions (
			customer_id, title, product_type, product_ref,
			billing_cycle, amount_cents, currency, status,
			starts_on, ends_on, next_billing_at, created_by,
			trial_end_on, coupon_code
		) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8::date,$9::date,
		          COALESCE($11::date, $8::date), $10, $11::date, NULLIF($12,''))
		RETURNING id`,
		in.CustomerID, in.Title, in.ProductType, in.ProductRef,
		in.BillingCycle, in.AmountCents, in.Currency,
		in.StartsOn, in.EndsOn, creator, in.TrialEndOn, in.CouponCode).Scan(&id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, map[string]string{"id": id})
}

func (h *SubscriptionHandler) AdminUpdateStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if body.Status != "active" && body.Status != "paused" && body.Status != "cancelled" {
		writeErr(w, 400, "invalid status")
		return
	}
	tag, err := h.DB.Exec(r.Context(),
		`UPDATE subscriptions SET status=$1 WHERE id=$2`, body.Status, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, 404, "subscription not found")
		return
	}
	writeJSON(w, 200, map[string]string{"status": body.Status})
}

// AdminChangePlan updates a subscription's amount (and optionally cycle)
// and, for an upgrade, issues a one-off prorated adjustment invoice for the
// remainder of the current cycle. Downgrades take effect next cycle with no
// charge. Body: {amount_cents, billing_cycle?}.
func (h *SubscriptionHandler) AdminChangePlan(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		AmountCents  int64  `json:"amount_cents"`
		BillingCycle string `json:"billing_cycle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	if body.AmountCents <= 0 {
		writeErr(w, 400, "a positive amount_cents is required")
		return
	}
	ctx, cancel := makeCtx()
	defer cancel()

	// One transaction: lock the row, compute proration, apply the plan
	// change, and issue the adjustment invoice atomically. FOR UPDATE also
	// serializes concurrent double-click plan changes.
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var oldAmount int64
	var currency, title, customerID, cycleStartStr, cycleEndStr string
	err = tx.QueryRow(ctx, `
		SELECT amount_cents, currency, title, customer_id,
		       to_char(COALESCE(last_billed_on, starts_on),'YYYY-MM-DD'),
		       to_char(next_billing_at,'YYYY-MM-DD')
		  FROM subscriptions WHERE id=$1 FOR UPDATE`, id).
		Scan(&oldAmount, &currency, &title, &customerID, &cycleStartStr, &cycleEndStr)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, 404, "subscription not found")
			return
		}
		writeErr(w, 500, err.Error())
		return
	}
	cycleStart, _ := time.Parse("2006-01-02", cycleStartStr)
	cycleEnd, _ := time.Parse("2006-01-02", cycleEndStr)
	delta := prorateDelta(oldAmount, body.AmountCents, cycleStart, cycleEnd, time.Now())

	if body.BillingCycle != "" {
		_, err = tx.Exec(ctx, `UPDATE subscriptions SET amount_cents=$1, billing_cycle=$2 WHERE id=$3`,
			body.AmountCents, body.BillingCycle, id)
	} else {
		_, err = tx.Exec(ctx, `UPDATE subscriptions SET amount_cents=$1 WHERE id=$2`,
			body.AmountCents, id)
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	var invID string
	if delta > 0 {
		invID, err = h.issueProrationInvoice(ctx, tx, customerID, id, title, delta, currency)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"prorated_charge_cents": delta, "invoice_id": invID})
}

// issueProrationInvoice creates a single-line adjustment invoice for a
// prorated upgrade charge, within the caller's transaction (so the plan
// change and the charge commit together — or not at all).
func (h *SubscriptionHandler) issueProrationInvoice(ctx context.Context, tx pgx.Tx,
	customerID, subID, title string, amount int64, currency string) (string, error) {

	var seq int64
	if err := tx.QueryRow(ctx, `SELECT nextval('invoice_number_seq')`).Scan(&seq); err != nil {
		return "", err
	}
	invNumber := fmt.Sprintf("INV-%d-%06d", time.Now().Year(), seq)
	const vatBP = 700
	vat := amount * vatBP / 10000
	total := amount + vat

	var invID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO invoices (
			invoice_number, customer_id, subscription_id, status, currency,
			subtotal_cents, vat_rate_bp, vat_cents, total_cents,
			issue_date, due_date, notes
		) VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,$8,
		          CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days',
		          'Prorated plan change')
		RETURNING id`,
		invNumber, customerID, subID, currency, amount, vatBP, vat, total).Scan(&invID); err != nil {
		return "", err
	}
	descEN := "Prorated plan change: " + title
	if _, err := tx.Exec(ctx, `
		INSERT INTO invoice_items (
			invoice_id, product_type, description_en, description_th,
			quantity, unit_price_cents, total_cents, sort_order
		) VALUES ($1,'custom',$2,$2,1,$3,$3,0)`,
		invID, descEN, amount); err != nil {
		return "", err
	}
	return invID, nil
}

// ── Customer self-service (portal) ───────────────────────────────────

// PortalList returns the signed-in customer's own subscriptions. Customer
// id comes from the JWT — never a path/query param.
func (h *SubscriptionHandler) PortalList(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT s.id, s.customer_id, c.name, s.title, s.product_type, s.product_ref,
		       s.billing_cycle, s.amount_cents, s.currency, s.status,
		       to_char(s.starts_on,'YYYY-MM-DD'),
		       to_char(s.ends_on,'YYYY-MM-DD'),
		       to_char(s.last_billed_on,'YYYY-MM-DD'),
		       to_char(s.next_billing_at,'YYYY-MM-DD'),
		       s.metadata, s.created_at, s.updated_at
		  FROM subscriptions s JOIN customers c ON c.id = s.customer_id
		 WHERE s.customer_id = $1
		 ORDER BY s.status, s.next_billing_at ASC`, cid)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []subscription{}
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, s)
	}
	writeJSON(w, 200, out)
}

// PortalCancel lets a customer cancel their own subscription at the end of
// the paid-through period: no further invoices are generated (status →
// cancelled), and ends_on records the date service is paid through
// (next_billing_at). Ownership is enforced via the JWT customer id.
func (h *SubscriptionHandler) PortalCancel(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	id := chi.URLParam(r, "id")
	var endsOn string
	err := h.DB.QueryRow(r.Context(), `
		UPDATE subscriptions
		   SET status = 'cancelled',
		       ends_on = COALESCE(ends_on, next_billing_at)
		 WHERE id = $1 AND customer_id = $2 AND status <> 'cancelled'
		RETURNING to_char(ends_on,'YYYY-MM-DD')`, id, cid).Scan(&endsOn)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, 404, "subscription not found or already cancelled")
			return
		}
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "cancelled", "paid_through": endsOn})
}

func scanSubscription(rs rowScanner) (subscription, error) {
	var s subscription
	err := rs.Scan(
		&s.ID, &s.CustomerID, &s.CustomerName, &s.Title, &s.ProductType, &s.ProductRef,
		&s.BillingCycle, &s.AmountCents, &s.Currency, &s.Status,
		&s.StartsOn, &s.EndsOn, &s.LastBilledOn, &s.NextBillingAt,
		&s.Metadata, &s.CreatedAt, &s.UpdatedAt,
	)
	return s, err
}
