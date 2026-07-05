package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
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

	var id string
	err := h.DB.QueryRow(ctx, `
		INSERT INTO subscriptions (
			customer_id, title, product_type, product_ref,
			billing_cycle, amount_cents, currency, status,
			starts_on, ends_on, next_billing_at, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8::date,$9::date,$8::date,$10)
		RETURNING id`,
		in.CustomerID, in.Title, in.ProductType, in.ProductRef,
		in.BillingCycle, in.AmountCents, in.Currency,
		in.StartsOn, in.EndsOn, creator).Scan(&id)
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
