package handlers

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// DashboardHandler returns the summary widget data shown on the admin
// home page. Single query so the frontend gets everything in one
// request — verification queue depth + this-month revenue + outstanding
// + overdue counts.
type DashboardHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type dashboardSummary struct {
	OutstandingCents       int64 `json:"outstanding_cents"`
	OutstandingCount       int   `json:"outstanding_count"`
	OverdueCents           int64 `json:"overdue_cents"`
	OverdueCount           int   `json:"overdue_count"`
	MonthRevenueCents      int64 `json:"month_revenue_cents"`
	MonthPaymentsCount     int   `json:"month_payments_count"`
	VerificationQueueCount int   `json:"verification_queue_count"`
}

func (h *DashboardHandler) AdminSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var s dashboardSummary
	if err := h.DB.QueryRow(ctx, `
		WITH outstanding AS (
		    SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS cents,
		           COUNT(*)                                          AS n
		      FROM invoices
		     WHERE status IN ('issued','partially_paid','overdue')
		),
		overdue AS (
		    SELECT COALESCE(SUM(total_cents - amount_paid_cents), 0) AS cents,
		           COUNT(*)                                          AS n
		      FROM invoices
		     WHERE status = 'overdue'
		),
		month AS (
		    SELECT COALESCE(SUM(amount_cents), 0) AS cents,
		           COUNT(*)                        AS n
		      FROM payments
		     WHERE status = 'completed'
		       AND paid_at >= date_trunc('month', NOW())
		),
		queue AS (
		    SELECT COUNT(*) AS n
		      FROM payments
		     WHERE status = 'awaiting_verification'
		)
		SELECT outstanding.cents, outstanding.n,
		       overdue.cents,     overdue.n,
		       month.cents,       month.n,
		       queue.n
		  FROM outstanding, overdue, month, queue`).
		Scan(&s.OutstandingCents, &s.OutstandingCount,
			&s.OverdueCents, &s.OverdueCount,
			&s.MonthRevenueCents, &s.MonthPaymentsCount,
			&s.VerificationQueueCount); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, s)
}
