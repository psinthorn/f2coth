package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// RenewalsHandler powers the admin renewals dashboard — a single read
// endpoint that surfaces what the background renewal engine is about to do
// (upcoming subscription + domain renewals) and what it has recently done
// (the reminder/notice log). Read-only; the engine itself runs in
// scheduler.go / domain_renewals.go.
type RenewalsHandler struct {
	DB *pgxpool.Pool
}

type upcomingSub struct {
	ID            string `json:"id"`
	CustomerName  string `json:"customer_name"`
	Title         string `json:"title"`
	BillingCycle  string `json:"billing_cycle"`
	AmountCents   int64  `json:"amount_cents"`
	Currency      string `json:"currency"`
	NextBillingAt string `json:"next_billing_at"`
	DaysUntil     int    `json:"days_until"`
}

type upcomingDomain struct {
	ID           string `json:"id"`
	CustomerName string `json:"customer_name"`
	Domain       string `json:"domain"`
	Registrar    string `json:"registrar"`
	ExpiresAt    string `json:"expires_at"`
	AutoRenew    bool   `json:"auto_renew"`
	DaysUntil    int    `json:"days_until"`
}

type reminderLogRow struct {
	EntityType   string    `json:"entity_type"`
	Label        string    `json:"label"`
	CustomerName string    `json:"customer_name"`
	OffsetDays   int       `json:"offset_days"`
	Template     string    `json:"template_used"`
	SentAt       time.Time `json:"sent_at"`
}

// AdminRenewals returns upcoming renewals within ?days (default 60) plus
// the most recent reminder/notice log entries.
func (h *RenewalsHandler) AdminRenewals(w http.ResponseWriter, r *http.Request) {
	days := 60
	if v := r.URL.Query().Get("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			days = n
		}
	}
	ctx := r.Context()

	subs := []upcomingSub{}
	subRows, err := h.DB.Query(ctx, `
		SELECT s.id, c.name, s.title, s.billing_cycle, s.amount_cents, s.currency,
		       to_char(s.next_billing_at,'YYYY-MM-DD'),
		       (s.next_billing_at - CURRENT_DATE)::int
		  FROM subscriptions s JOIN customers c ON c.id = s.customer_id
		 WHERE s.status='active'
		   AND s.next_billing_at <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
		 ORDER BY s.next_billing_at ASC LIMIT 200`, days)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for subRows.Next() {
		var s upcomingSub
		if err := subRows.Scan(&s.ID, &s.CustomerName, &s.Title, &s.BillingCycle,
			&s.AmountCents, &s.Currency, &s.NextBillingAt, &s.DaysUntil); err != nil {
			subRows.Close()
			writeErr(w, 500, err.Error())
			return
		}
		subs = append(subs, s)
	}
	subRows.Close()

	domains := []upcomingDomain{}
	domRows, err := h.DB.Query(ctx, `
		SELECT d.id, c.name, d.domain, d.registrar,
		       to_char(d.expires_at,'YYYY-MM-DD'), d.auto_renew,
		       (d.expires_at::date - CURRENT_DATE)::int
		  FROM customer_domains d JOIN customers c ON c.id = d.customer_id
		 WHERE d.expires_at IS NOT NULL
		   AND d.expires_at::date <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
		 ORDER BY d.expires_at ASC LIMIT 200`, days)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for domRows.Next() {
		var d upcomingDomain
		if err := domRows.Scan(&d.ID, &d.CustomerName, &d.Domain, &d.Registrar,
			&d.ExpiresAt, &d.AutoRenew, &d.DaysUntil); err != nil {
			domRows.Close()
			writeErr(w, 500, err.Error())
			return
		}
		domains = append(domains, d)
	}
	domRows.Close()

	log := []reminderLogRow{}
	logRows, err := h.DB.Query(ctx, `
		SELECT rr.entity_type, rr.offset_days, rr.template_used, rr.sent_at,
		       COALESCE(s.title, d.domain, '(deleted)'),
		       COALESCE(cs.name, cd.name, '')
		  FROM renewal_reminders rr
		  LEFT JOIN subscriptions s   ON rr.entity_type='subscription' AND s.id = rr.entity_id
		  LEFT JOIN customers cs      ON cs.id = s.customer_id
		  LEFT JOIN customer_domains d ON rr.entity_type='domain' AND d.id = rr.entity_id
		  LEFT JOIN customers cd      ON cd.id = d.customer_id
		 ORDER BY rr.sent_at DESC LIMIT 50`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	for logRows.Next() {
		var l reminderLogRow
		if err := logRows.Scan(&l.EntityType, &l.OffsetDays, &l.Template, &l.SentAt,
			&l.Label, &l.CustomerName); err != nil {
			logRows.Close()
			writeErr(w, 500, err.Error())
			return
		}
		log = append(log, l)
	}
	logRows.Close()

	writeJSON(w, 200, map[string]any{
		"window_days":            days,
		"upcoming_subscriptions": subs,
		"upcoming_domains":       domains,
		"recent_reminders":       log,
	})
}
