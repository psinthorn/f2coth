package handlers

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// AnalyticsHandler aggregates revenue, AR aging, and subscription
// churn for the admin analytics page. All endpoints are read-only —
// the heavy lifting is in SQL so we can keep the handler thin.
type AnalyticsHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type monthlyPoint struct {
	Month         string `json:"month"` // YYYY-MM
	RevenueCents  int64  `json:"revenue_cents"`
	PaymentsCount int    `json:"payments_count"`
}

// AdminMRR — last 12 months of completed payment revenue.
//
// "True MRR" would only count recurring (subscription) revenue. We
// surface BOTH columns — completed payments and the subset that came
// from subscriptions — so the admin can read either signal.
func (h *AnalyticsHandler) AdminMRR(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Month            string `json:"month"`
		AllRevenueCents  int64  `json:"all_revenue_cents"`
		SubRevenueCents  int64  `json:"sub_revenue_cents"`
		PaymentsCount    int    `json:"payments_count"`
		SubPaymentsCount int    `json:"sub_payments_count"`
	}
	rows, err := h.DB.Query(r.Context(), `
		WITH months AS (
		    SELECT generate_series(
		        date_trunc('month', NOW() - INTERVAL '11 months'),
		        date_trunc('month', NOW()),
		        '1 month'
		    ) AS m
		)
		SELECT to_char(months.m, 'YYYY-MM') AS month,
		       COALESCE(SUM(p.amount_cents), 0) AS all_rev,
		       COALESCE(SUM(CASE WHEN i.subscription_id IS NOT NULL
		                        THEN p.amount_cents ELSE 0 END), 0) AS sub_rev,
		       COUNT(p.id)                                                AS payments,
		       COUNT(p.id) FILTER (WHERE i.subscription_id IS NOT NULL)  AS sub_payments
		  FROM months
		  LEFT JOIN payments p
		         ON p.status = 'completed'
		        AND date_trunc('month', p.paid_at) = months.m
		  LEFT JOIN invoices i ON i.id = p.invoice_id
		 GROUP BY months.m
		 ORDER BY months.m`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.Month, &x.AllRevenueCents, &x.SubRevenueCents,
			&x.PaymentsCount, &x.SubPaymentsCount); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, out)
}

// AdminAging — accounts-receivable aging buckets. Standard 4-bucket
// breakdown: current (not yet due), 1-30, 31-60, 61-90, 90+.
func (h *AnalyticsHandler) AdminAging(w http.ResponseWriter, r *http.Request) {
	type bucket struct {
		Label string `json:"label"`
		Cents int64  `json:"cents"`
		Count int    `json:"count"`
	}
	out := struct {
		AsOf    time.Time `json:"as_of"`
		Buckets []bucket  `json:"buckets"`
	}{AsOf: time.Now()}

	rows, err := h.DB.Query(r.Context(), `
		WITH outstanding AS (
		    SELECT total_cents - amount_paid_cents AS due,
		           GREATEST(0, (CURRENT_DATE - due_date)::int) AS days_overdue
		      FROM invoices
		     WHERE status IN ('issued','partially_paid','overdue')
		       AND total_cents > amount_paid_cents
		)
		SELECT label,
		       COALESCE(SUM(due), 0) AS cents,
		       COUNT(*)              AS n
		  FROM (
		    SELECT CASE
		             WHEN days_overdue = 0  THEN '0_current'
		             WHEN days_overdue <= 30 THEN '1_1_30'
		             WHEN days_overdue <= 60 THEN '2_31_60'
		             WHEN days_overdue <= 90 THEN '3_61_90'
		             ELSE                       '4_90_plus'
		           END AS label,
		           due
		      FROM outstanding
		  ) sub
		 GROUP BY label
		 ORDER BY label`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	// Pre-seed buckets so empty ones still appear in the response.
	tmpl := []bucket{
		{Label: "current"},
		{Label: "1_30"},
		{Label: "31_60"},
		{Label: "61_90"},
		{Label: "90_plus"},
	}
	for rows.Next() {
		var key string
		var cents int64
		var n int
		if err := rows.Scan(&key, &cents, &n); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		switch key {
		case "0_current":
			tmpl[0].Cents, tmpl[0].Count = cents, n
		case "1_1_30":
			tmpl[1].Cents, tmpl[1].Count = cents, n
		case "2_31_60":
			tmpl[2].Cents, tmpl[2].Count = cents, n
		case "3_61_90":
			tmpl[3].Cents, tmpl[3].Count = cents, n
		case "4_90_plus":
			tmpl[4].Cents, tmpl[4].Count = cents, n
		}
	}
	out.Buckets = tmpl
	writeJSON(w, 200, out)
}

// AdminChurn — subscription churn per month. churn_rate is cancelled /
// (cancelled + active_at_start_of_month). Returned as a 12-month series
// alongside raw counts so the UI can show either trend line.
func (h *AnalyticsHandler) AdminChurn(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Month            string  `json:"month"`
		CancelledCount   int     `json:"cancelled_count"`
		ActiveStart      int     `json:"active_at_start"`
		ChurnRatePercent float64 `json:"churn_rate_percent"`
	}
	rows, err := h.DB.Query(r.Context(), `
		WITH months AS (
		    SELECT generate_series(
		        date_trunc('month', NOW() - INTERVAL '11 months'),
		        date_trunc('month', NOW()),
		        '1 month'
		    ) AS m
		),
		stats AS (
		    SELECT months.m,
		           COUNT(*) FILTER (
		             WHERE s.status='cancelled'
		               AND date_trunc('month', s.updated_at) = months.m
		           ) AS cancelled,
		           COUNT(*) FILTER (
		             WHERE s.created_at < months.m
		               AND (s.updated_at >= months.m OR s.status='active')
		           ) AS active_start
		      FROM months
		      LEFT JOIN subscriptions s ON true
		     GROUP BY months.m
		)
		SELECT to_char(m, 'YYYY-MM') AS month,
		       cancelled,
		       active_start,
		       CASE WHEN active_start > 0
		            THEN ROUND(100.0 * cancelled / active_start, 2)
		            ELSE 0
		       END AS churn_pct
		  FROM stats
		 ORDER BY m`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []row{}
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.Month, &x.CancelledCount, &x.ActiveStart, &x.ChurnRatePercent); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, x)
	}
	writeJSON(w, 200, out)
}
