package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/pdfdoc"
)

// InvoicePDFHandler serves invoice/tax-invoice/receipt PDFs rendered
// server-side with pdfdoc (gopdf + Sarabun). Same data the print HTML
// page uses, but as a true PDF binary the customer's accounting tool
// can ingest directly.
type InvoicePDFHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

func (h *InvoicePDFHandler) PortalDownload(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, 403, "no customer context")
		return
	}
	h.serve(w, r, cid)
}

func (h *InvoicePDFHandler) AdminDownload(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, "") // admin scope — bypass customer ownership check
}

// RenderInvoicePDF is the email-attachment path. Same data path as the
// HTTP handler but returns the bytes directly so callers can attach
// them via notify.Job.Attachments. docOverride may be empty (keeps
// invoice.doc_type) or "receipt"|"tax_invoice" etc.
func RenderInvoicePDF(ctx context.Context, db *pgxpool.Pool, invoiceID, docOverride string) ([]byte, string, error) {
	h := &InvoicePDFHandler{DB: db}
	inv, err := h.loadForPDF(ctx, invoiceID, "")
	if err != nil {
		return nil, "", err
	}
	if docOverride != "" {
		inv.DocType = docOverride
	}
	pdfBytes, err := pdfdoc.Render(*inv)
	if err != nil {
		return nil, "", err
	}
	suffix := ""
	if inv.DocType == "receipt" {
		suffix = "-receipt"
	}
	return pdfBytes, inv.Number + suffix + ".pdf", nil
}

func (h *InvoicePDFHandler) serve(w http.ResponseWriter, r *http.Request, customerScope string) {
	id := chi.URLParam(r, "id")
	inv, err := h.loadForPDF(r.Context(), id, customerScope)
	if err != nil {
		writeErr(w, 404, "invoice not found")
		return
	}
	// `?doc=receipt` overrides the rendered document type so a paid
	// tax_invoice can be downloaded as a receipt without mutating the
	// stored doc_type (the underlying tax invoice stays canonical).
	if override := r.URL.Query().Get("doc"); override != "" {
		switch override {
		case "receipt", "tax_invoice", "invoice", "quotation":
			inv.DocType = override
		}
	}
	bytes, err := pdfdoc.Render(*inv)
	if err != nil {
		writeErr(w, 500, "render: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	suffix := ""
	if inv.DocType == "receipt" {
		suffix = "-receipt"
	}
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`inline; filename="%s%s.pdf"`, inv.Number, suffix))
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write(bytes)
}

// loadForPDF assembles the pdfdoc.Invoice shape: header + items +
// frozen billing snapshot. customerScope, if non-empty, restricts the
// row to that customer's id.
func (h *InvoicePDFHandler) loadForPDF(ctx context.Context, id, customerScope string) (*pdfdoc.Invoice, error) {
	c, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var (
		number, docType, currency, customerName string
		subtotal, vat, total, paid              int64
		vatBP                                   int
		issueDate, dueDate                      *time.Time
		notes                                   *string
		snapshot                                []byte
	)
	if err := h.DB.QueryRow(c, `
		SELECT i.invoice_number, i.doc_type, i.currency,
		       i.subtotal_cents, i.vat_cents, i.vat_rate_bp, i.total_cents, i.amount_paid_cents,
		       i.issue_date, i.due_date, i.notes, i.billing_snapshot::text, c.name
		  FROM invoices i JOIN customers c ON c.id=i.customer_id
		 WHERE i.id=$1 AND ($2='' OR i.customer_id=$2::uuid)`,
		id, customerScope).
		Scan(&number, &docType, &currency,
			&subtotal, &vat, &vatBP, &total, &paid,
			&issueDate, &dueDate, &notes, &snapshot, &customerName); err != nil {
		return nil, err
	}

	inv := &pdfdoc.Invoice{
		Number:       number,
		DocType:      docType,
		Currency:     currency,
		Subtotal:     subtotal,
		VATCents:     vat,
		VATRateBP:    vatBP,
		TotalCents:   total,
		PaidCents:    paid,
		CustomerName: customerName,
	}
	if issueDate != nil {
		inv.IssueDate = issueDate.Format("2006-01-02")
	}
	if dueDate != nil {
		inv.DueDate = dueDate.Format("2006-01-02")
	}
	if notes != nil {
		inv.Notes = *notes
	}

	// Decode billing snapshot
	var snap map[string]any
	if err := json.Unmarshal(snapshot, &snap); err == nil {
		if v, ok := snap["legal_name"].(string); ok && v != "" {
			inv.CustomerName = v
		}
		if v, ok := snap["tax_id"].(string); ok {
			inv.TaxID = v
		}
		if v, ok := snap["branch_code"].(string); ok {
			inv.BranchCode = v
		}
		inv.BillingLines = []string{
			s(snap["address_line1"]),
			s(snap["address_line2"]),
			strings.TrimSpace(strings.Join([]string{
				s(snap["subdistrict"]),
				s(snap["district"]),
				s(snap["province"]),
				s(snap["postal_code"]),
			}, " ")),
			s(snap["country"]),
		}
	}

	// Items
	rows, err := h.DB.Query(c, `
		SELECT description_en, description_th, quantity, unit_price_cents, total_cents
		  FROM invoice_items WHERE invoice_id=$1 ORDER BY sort_order, id`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var (
				en   string
				th   *string
				qty  int
				unit int64
				tot  int64
			)
			if err := rows.Scan(&en, &th, &qty, &unit, &tot); err == nil {
				desc := en
				if th != nil && *th != "" {
					desc = *th + " — " + en
				}
				inv.Items = append(inv.Items, pdfdoc.Item{
					Description: desc, Quantity: qty,
					UnitCents: unit, TotalCents: tot,
				})
			}
		}
	}

	return inv, nil
}

func s(v any) string {
	if v == nil {
		return ""
	}
	if str, ok := v.(string); ok {
		return str
	}
	return ""
}
