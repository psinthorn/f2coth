// Package pdfdoc renders an invoice (or tax-invoice / receipt) as a
// PDF byte stream. Pure Go via signintech/gopdf — no Chromium, no
// external service. We bundle Sarabun Regular + Bold (OFL licensed)
// via go:embed so Thai characters render correctly in customer names,
// addresses, and item descriptions.
package pdfdoc

import (
	"bytes"
	"embed"
	"fmt"
	"strings"
	"time"

	"github.com/signintech/gopdf"
)

//go:embed fonts/Sarabun-Regular.ttf fonts/Sarabun-Bold.ttf
var fontFS embed.FS

// Invoice is the input shape — mirrors handlers.models.Invoice in the
// fields we actually print, decoupled so the package has no upstream
// import. The handler layer builds it from the DB row.
type Invoice struct {
	Number       string
	DocType      string // invoice | tax_invoice | receipt | quotation
	IssueDate    string // 2006-01-02
	DueDate      string
	Currency     string // THB | USD
	Subtotal     int64
	VATCents     int64
	VATRateBP    int
	TotalCents   int64
	PaidCents    int64
	Notes        string
	CustomerName string
	BillingLines []string // already formatted ["123/4 Bophut", "Koh Samui 84320", ...]
	TaxID        string
	BranchCode   string
	Items        []Item
}

type Item struct {
	Description string
	Quantity    int
	UnitCents   int64
	TotalCents  int64
}

// Render returns the PDF bytes. Caller serves the bytes with
// Content-Type: application/pdf.
func Render(inv Invoice) ([]byte, error) {
	pdf := gopdf.GoPdf{}
	pdf.Start(gopdf.Config{PageSize: *gopdf.PageSizeA4})

	// Load embedded Sarabun fonts.
	reg, err := fontFS.ReadFile("fonts/Sarabun-Regular.ttf")
	if err != nil {
		return nil, fmt.Errorf("font regular: %w", err)
	}
	bold, err := fontFS.ReadFile("fonts/Sarabun-Bold.ttf")
	if err != nil {
		return nil, fmt.Errorf("font bold: %w", err)
	}
	if err := pdf.AddTTFFontDataWithOption("Sarabun", reg, gopdf.TtfOption{Style: gopdf.Regular}); err != nil {
		return nil, fmt.Errorf("add font regular: %w", err)
	}
	if err := pdf.AddTTFFontDataWithOption("Sarabun", bold, gopdf.TtfOption{Style: gopdf.Bold}); err != nil {
		return nil, fmt.Errorf("add font bold: %w", err)
	}

	pdf.AddPage()
	const (
		marginX = 40.0
		startY  = 50.0
		pageW   = 595.28 // A4 width in points
	)

	// ----- Header -----
	pdf.SetTextColor(20, 30, 50)
	_ = pdf.SetFont("Sarabun", "B", 18)
	pdf.SetX(marginX)
	pdf.SetY(startY)
	_ = pdf.Cell(nil, "F2 Co., Ltd.")

	_ = pdf.SetFont("Sarabun", "", 9)
	pdf.SetTextColor(80, 90, 110)
	pdf.SetX(marginX)
	pdf.SetY(startY + 22)
	_ = pdf.Cell(nil, "12/34 Moo 6, Bophut, Koh Samui, Surat Thani 84320, Thailand")
	pdf.SetX(marginX)
	pdf.SetY(startY + 34)
	_ = pdf.Cell(nil, "Tax ID 0105556012345 · info@f2.co.th · +66 64 027 0528")

	// Doc title (right side)
	docLabel := docTitle(inv.DocType)
	_ = pdf.SetFont("Sarabun", "B", 16)
	pdf.SetTextColor(20, 30, 50)
	pdf.SetX(pageW - marginX - 200)
	pdf.SetY(startY)
	_ = pdf.Cell(nil, docLabel)
	_ = pdf.SetFont("Sarabun", "", 9)
	pdf.SetTextColor(80, 90, 110)
	pdf.SetX(pageW - marginX - 200)
	pdf.SetY(startY + 22)
	_ = pdf.Cell(nil, "No.  "+inv.Number)
	if inv.IssueDate != "" {
		pdf.SetX(pageW - marginX - 200)
		pdf.SetY(startY + 34)
		_ = pdf.Cell(nil, "Date  "+inv.IssueDate)
	}
	if inv.DueDate != "" {
		pdf.SetX(pageW - marginX - 200)
		pdf.SetY(startY + 46)
		_ = pdf.Cell(nil, "Due   "+inv.DueDate)
	}

	// Divider
	pdf.SetStrokeColor(20, 30, 50)
	pdf.SetLineWidth(1.2)
	pdf.Line(marginX, startY+62, pageW-marginX, startY+62)

	// ----- Bill-to block -----
	y := startY + 80
	_ = pdf.SetFont("Sarabun", "B", 9)
	pdf.SetTextColor(110, 120, 140)
	pdf.SetX(marginX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, "BILL TO / ลูกค้า")

	y += 14
	_ = pdf.SetFont("Sarabun", "B", 12)
	pdf.SetTextColor(20, 30, 50)
	pdf.SetX(marginX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, defaultStr(inv.CustomerName, "—"))

	_ = pdf.SetFont("Sarabun", "", 9)
	pdf.SetTextColor(60, 70, 90)
	y += 14
	if inv.TaxID != "" {
		pdf.SetX(marginX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, fmt.Sprintf("เลขประจำตัวผู้เสียภาษี %s · สาขา %s", inv.TaxID, defaultStr(inv.BranchCode, "00000")))
		y += 12
	}
	for _, line := range inv.BillingLines {
		if line == "" {
			continue
		}
		pdf.SetX(marginX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, line)
		y += 12
	}

	// ----- Items table -----
	y += 16
	// Column geometry
	const (
		colDescX = marginX
		colQtyX  = 320.0
		colUnitX = 380.0
		colTotX  = 480.0
	)
	pdf.SetStrokeColor(20, 30, 50)
	pdf.SetLineWidth(1)
	pdf.Line(marginX, y-2, pageW-marginX, y-2)
	_ = pdf.SetFont("Sarabun", "B", 9)
	pdf.SetTextColor(110, 120, 140)
	pdf.SetX(colDescX)
	pdf.SetY(y + 4)
	_ = pdf.Cell(nil, "DESCRIPTION")
	pdf.SetX(colQtyX)
	pdf.SetY(y + 4)
	_ = pdf.Cell(nil, "QTY")
	pdf.SetX(colUnitX)
	pdf.SetY(y + 4)
	_ = pdf.Cell(nil, "UNIT")
	pdf.SetX(colTotX)
	pdf.SetY(y + 4)
	_ = pdf.Cell(nil, "TOTAL")
	y += 18
	pdf.Line(marginX, y, pageW-marginX, y)

	_ = pdf.SetFont("Sarabun", "", 10)
	pdf.SetTextColor(20, 30, 50)
	for _, it := range inv.Items {
		y += 12
		pdf.SetX(colDescX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, truncate(it.Description, 60))
		pdf.SetX(colQtyX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, fmt.Sprintf("%d", it.Quantity))
		pdf.SetX(colUnitX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, fmtMoney(it.UnitCents, inv.Currency))
		pdf.SetX(colTotX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, fmtMoney(it.TotalCents, inv.Currency))
		y += 4
		pdf.SetStrokeColor(220, 225, 235)
		pdf.SetLineWidth(0.5)
		pdf.Line(marginX, y, pageW-marginX, y)
	}

	// ----- Totals block -----
	y += 16
	_ = pdf.SetFont("Sarabun", "", 10)
	pdf.SetTextColor(60, 70, 90)
	rightLabelX := colUnitX
	rightValueX := colTotX
	pdf.SetX(rightLabelX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, "Subtotal")
	pdf.SetX(rightValueX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, fmtMoney(inv.Subtotal, inv.Currency))
	y += 14
	pdf.SetX(rightLabelX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, fmt.Sprintf("VAT %.2f%%", float64(inv.VATRateBP)/100.0))
	pdf.SetX(rightValueX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, fmtMoney(inv.VATCents, inv.Currency))
	y += 6
	pdf.SetStrokeColor(20, 30, 50)
	pdf.SetLineWidth(1)
	pdf.Line(rightLabelX-10, y, pageW-marginX, y)
	y += 6
	_ = pdf.SetFont("Sarabun", "B", 12)
	pdf.SetTextColor(20, 30, 50)
	pdf.SetX(rightLabelX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, "Total")
	pdf.SetX(rightValueX)
	pdf.SetY(y)
	_ = pdf.Cell(nil, fmtMoney(inv.TotalCents, inv.Currency))
	if inv.PaidCents > 0 {
		y += 16
		_ = pdf.SetFont("Sarabun", "", 9)
		pdf.SetTextColor(20, 110, 70)
		pdf.SetX(rightLabelX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, "Paid")
		pdf.SetX(rightValueX)
		pdf.SetY(y)
		_ = pdf.Cell(nil, "-"+fmtMoney(inv.PaidCents, inv.Currency))
		due := inv.TotalCents - inv.PaidCents
		if due > 0 {
			y += 12
			_ = pdf.SetFont("Sarabun", "B", 9)
			pdf.SetTextColor(150, 90, 0)
			pdf.SetX(rightLabelX)
			pdf.SetY(y)
			_ = pdf.Cell(nil, "Balance due")
			pdf.SetX(rightValueX)
			pdf.SetY(y)
			_ = pdf.Cell(nil, fmtMoney(due, inv.Currency))
		}
	}

	// ----- Footer -----
	footerY := 760.0
	_ = pdf.SetFont("Sarabun", "", 8)
	pdf.SetTextColor(120, 130, 150)
	pdf.SetX(marginX)
	pdf.SetY(footerY)
	_ = pdf.Cell(nil, "Pay through the F2 client portal — bank transfer, Thai QR, PromptPay, or PayPal accepted.")
	pdf.SetX(marginX)
	pdf.SetY(footerY + 12)
	_ = pdf.Cell(nil, "Generated "+time.Now().Format("2006-01-02 15:04")+" · f2.co.th")

	var buf bytes.Buffer
	if _, err := pdf.WriteTo(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func docTitle(t string) string {
	switch t {
	case "tax_invoice":
		return "TAX INVOICE / ใบกำกับภาษี"
	case "receipt":
		return "RECEIPT / ใบเสร็จรับเงิน"
	case "quotation":
		return "QUOTATION / ใบเสนอราคา"
	}
	return "INVOICE / ใบแจ้งหนี้"
}

func fmtMoney(cents int64, currency string) string {
	amount := float64(cents) / 100.0
	prefix := "฿"
	if currency == "USD" {
		prefix = "$"
	}
	return prefix + addThousandSeparators(fmt.Sprintf("%.2f", amount))
}

// addThousandSeparators turns "1234.56" into "1,234.56".
func addThousandSeparators(s string) string {
	dotIdx := strings.Index(s, ".")
	intPart := s
	dec := ""
	if dotIdx >= 0 {
		intPart = s[:dotIdx]
		dec = s[dotIdx:]
	}
	n := len(intPart)
	if n <= 3 {
		return intPart + dec
	}
	out := make([]byte, 0, n+(n/3))
	for i, c := range intPart {
		if i > 0 && (n-i)%3 == 0 {
			out = append(out, ',')
		}
		out = append(out, byte(c))
	}
	return string(out) + dec
}

func defaultStr(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

func truncate(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n]) + "…"
}
