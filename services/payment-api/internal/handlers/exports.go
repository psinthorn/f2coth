package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// ExportHandler streams CSV files for the accounting team. Date-range
// filters use ISO `from` and `to` (inclusive). Output uses the same
// column shape Xero and QuickBooks accept on import — but staying
// generic so it works for any spreadsheet workflow.
type ExportHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

// AdminInvoicesCSV — one row per invoice.
func (h *ExportHandler) AdminInvoicesCSV(w http.ResponseWriter, r *http.Request) {
	from, to := dateRange(r)
	rows, err := h.DB.Query(r.Context(), `
		SELECT i.invoice_number, i.doc_type, i.status, c.name,
		       COALESCE(p.legal_name, ''), COALESCE(p.tax_id, ''),
		       i.currency, i.subtotal_cents, i.vat_cents, i.total_cents,
		       i.amount_paid_cents, i.issue_date, i.due_date, i.paid_at
		  FROM invoices i
		  JOIN customers c ON c.id = i.customer_id
		  LEFT JOIN customer_billing_profiles p ON p.customer_id = c.id
		 WHERE ($1::date IS NULL OR i.issue_date >= $1)
		   AND ($2::date IS NULL OR i.issue_date <= $2)
		 ORDER BY i.issue_date NULLS LAST, i.invoice_number`,
		from, to)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"invoices.csv\"")
	cw := csv.NewWriter(w)
	defer cw.Flush()

	_ = cw.Write([]string{
		"invoice_number", "doc_type", "status", "customer_name",
		"customer_legal_name", "customer_tax_id",
		"currency", "subtotal", "vat", "total",
		"amount_paid", "issue_date", "due_date", "paid_at",
	})

	for rows.Next() {
		var (
			number, docType, status, customer, legalName, taxID, currency string
			subtotal, vat, total, paid                                    int64
			issueDate, dueDate                                            *time.Time
			paidAt                                                        *time.Time
		)
		if err := rows.Scan(&number, &docType, &status, &customer, &legalName, &taxID,
			&currency, &subtotal, &vat, &total, &paid,
			&issueDate, &dueDate, &paidAt); err != nil {
			return
		}
		_ = cw.Write([]string{
			number, docType, status, customer, legalName, taxID, currency,
			money(subtotal), money(vat), money(total), money(paid),
			dateStr(issueDate), dateStr(dueDate), timeStr(paidAt),
		})
	}
}

// AdminPaymentsCSV — one row per completed payment.
func (h *ExportHandler) AdminPaymentsCSV(w http.ResponseWriter, r *http.Request) {
	from, to := dateRange(r)
	rows, err := h.DB.Query(r.Context(), `
		SELECT p.payment_number, p.method, p.status, p.currency, p.amount_cents,
		       p.paid_at, i.invoice_number, c.name, COALESCE(p.bank_ref, ''),
		       COALESCE(p.provider, ''), COALESCE(p.provider_capture_id, '')
		  FROM payments p
		  JOIN invoices  i ON i.id = p.invoice_id
		  JOIN customers c ON c.id = p.customer_id
		 WHERE ($1::date IS NULL OR p.paid_at::date >= $1)
		   AND ($2::date IS NULL OR p.paid_at::date <= $2)
		 ORDER BY p.paid_at NULLS LAST, p.payment_number`,
		from, to)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"payments.csv\"")
	cw := csv.NewWriter(w)
	defer cw.Flush()

	_ = cw.Write([]string{
		"payment_number", "method", "status", "currency", "amount",
		"paid_at", "invoice_number", "customer_name", "bank_ref",
		"provider", "provider_capture_id",
	})

	for rows.Next() {
		var (
			number, method, status, currency, invoice, customer, bankRef, provider, captureID string
			amount                                                                            int64
			paidAt                                                                            *time.Time
		)
		if err := rows.Scan(&number, &method, &status, &currency, &amount,
			&paidAt, &invoice, &customer, &bankRef, &provider, &captureID); err != nil {
			return
		}
		_ = cw.Write([]string{
			number, method, status, currency, money(amount),
			timeStr(paidAt), invoice, customer, bankRef, provider, captureID,
		})
	}
}

func dateRange(r *http.Request) (any, any) {
	q := r.URL.Query()
	var fromVal, toVal any
	if v := strings.TrimSpace(q.Get("from")); v != "" {
		fromVal = v
	}
	if v := strings.TrimSpace(q.Get("to")); v != "" {
		toVal = v
	}
	return fromVal, toVal
}

func money(cents int64) string { return fmt.Sprintf("%.2f", float64(cents)/100.0) }
func dateStr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format("2006-01-02")
}
func timeStr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.Format(time.RFC3339)
}
