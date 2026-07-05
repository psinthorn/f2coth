package handlers

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
)

// BankImportHandler turns a normalised CSV of bank-statement lines into
// proposed matches against `awaiting_verification` bank_transfer
// payments. Admins review the proposals and click "Apply" to verify
// payments in bulk — much faster than reviewing each uploaded slip
// individually.
//
// CSV shape (case-insensitive header, any column order):
//
//	transferred_at, amount_thb, bank_ref, description
//
// transferred_at accepts RFC3339 or "YYYY-MM-DD" or "YYYY-MM-DD HH:MM".
// amount_thb is whole baht (we multiply by 100 to get satang).
type BankImportHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

const (
	maxBankImportBytes = 5 * 1024 * 1024
	matchDayWindow     = 3
)

// AdminUpload — multipart: file=<csv> + source_name=<text>.
// Parses, persists rows, runs matching, returns the import + match
// preview in one response.
func (h *BankImportHandler) AdminUpload(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(maxBankImportBytes + 1024); err != nil {
		writeErr(w, 400, "could not parse upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, 400, "file field missing")
		return
	}
	defer file.Close()
	if header.Size > maxBankImportBytes {
		writeErr(w, 413, "file must be ≤ 5 MB")
		return
	}
	sourceName := strings.TrimSpace(r.FormValue("source_name"))
	if sourceName == "" {
		sourceName = header.Filename
	}

	rows, parseErr := parseBankCSV(file)
	if parseErr != nil {
		writeErr(w, 400, "parse: "+parseErr.Error())
		return
	}
	if len(rows) == 0 {
		writeErr(w, 400, "no rows parsed")
		return
	}

	uid := userID(r)
	var actor any
	if uid != "" {
		actor = uid
	}

	ctx, cancel := makeCtx()
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	var importID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO bank_statement_imports (uploaded_by, source_name, raw_filename, parsed_rows)
		VALUES ($1, $2, $3, $4) RETURNING id`,
		actor, sourceName, header.Filename, len(rows)).Scan(&importID); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	for i, row := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO bank_statement_rows
			    (import_id, line_number, transferred_at, amount_cents, bank_ref, description)
			VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''))`,
			importID, i+1, row.TransferredAt, row.AmountCents, row.BankRef, row.Description); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Match in a second transaction so the rows are visible to the
	// matching query without juggling FOR UPDATE locks.
	if err := h.matchRows(ctx, importID); err != nil {
		writeErr(w, 500, "match: "+err.Error())
		return
	}

	resp, err := h.loadImport(ctx, importID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 201, resp)
}

// AdminGet — single import with all rows + proposed matches.
func (h *BankImportHandler) AdminGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	resp, err := h.loadImport(r.Context(), id)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, resp)
}

// AdminList — recent imports for the dashboard.
func (h *BankImportHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.DB.Query(r.Context(), `
		SELECT id, source_name, raw_filename, status, parsed_rows, matched_rows, applied_rows, created_at, applied_at
		  FROM bank_statement_imports
		 ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			id                       string
			source, filename         *string
			status                   string
			parsed, matched, applied int
			created                  time.Time
			appliedAt                *time.Time
		)
		if err := rows.Scan(&id, &source, &filename, &status, &parsed, &matched, &applied, &created, &appliedAt); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{
			"id": id, "source_name": source, "raw_filename": filename, "status": status,
			"parsed_rows": parsed, "matched_rows": matched, "applied_rows": applied,
			"created_at": created, "applied_at": appliedAt,
		})
	}
	writeJSON(w, 200, out)
}

// AdminApply — verify every payment that has a proposed match in this
// import. Idempotent: rows already 'applied' are skipped.
func (h *BankImportHandler) AdminApply(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := userID(r)
	var actor any
	if uid != "" {
		actor = uid
	}

	ctx, cancel := makeCtx()
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, matched_payment_id
		  FROM bank_statement_rows
		 WHERE import_id = $1 AND match_status = 'proposed' AND matched_payment_id IS NOT NULL`,
		id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	type pair struct{ rowID, paymentID string }
	var pairs []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.rowID, &p.paymentID); err != nil {
			rows.Close()
			writeErr(w, 500, err.Error())
			return
		}
		pairs = append(pairs, p)
	}
	rows.Close()

	applied := 0
	for _, p := range pairs {
		tag, err := tx.Exec(ctx, `
			UPDATE payments
			   SET status='completed', paid_at=NOW(),
			       verified_by_user_id=$1, verified_at=NOW()
			 WHERE id=$2 AND status='awaiting_verification'`,
			actor, p.paymentID)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		if _, err := tx.Exec(ctx,
			`UPDATE bank_statement_rows SET match_status='applied' WHERE id=$1`, p.rowID); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if err := reconcileInvoice(ctx, tx, p.paymentID); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		applied++
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bank_statement_imports
		   SET applied_rows = applied_rows + $1,
		       status = 'applied', applied_at = NOW()
		 WHERE id = $2`, applied, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	resp, _ := h.loadImport(ctx, id)
	writeJSON(w, 200, map[string]any{"applied": applied, "import": resp})
}

// ---------- internals ----------

type bankRow struct {
	TransferredAt time.Time
	AmountCents   int64
	BankRef       string
	Description   string
}

// Per-bank header aliases. Adding a new bank = add its header strings
// to the relevant alias list — no per-bank parser code needed because
// every Thai bank export we've seen normalises to the same 4-column
// shape after picking the right columns. detectBank() at the end runs
// the same alias set in reverse to label the import for the audit log.
var (
	dateAliases = []string{
		"transferred_at", "date", "transfer_date",
		"trans. date", "trans date", "transaction date",
		"posting date", "value date",
		"วันที่", "วันที่ทำรายการ", "วันโอน",
	}
	amountAliases = []string{
		"amount_thb", "amount", "credit", "deposit",
		"transaction amount", "transaction amount thb",
		"amount (thb)", "credit amount", "in", "cr",
		"จำนวน", "จำนวนเงิน", "ยอดเงิน",
	}
	refAliases = []string{
		"bank_ref", "reference", "ref", "reference no.",
		"reference no", "referenceid", "ref no", "ref id",
		"อ้างอิง", "เลขอ้างอิง", "เลขที่อ้างอิง",
	}
	descAliases = []string{
		"description", "memo", "remark", "details", "narrative",
		"transaction details", "รายละเอียด", "บันทึก",
	}
)

func parseBankCSV(r io.Reader) ([]bankRow, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1 // tolerate ragged
	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	col := map[string]int{}
	for i, h := range header {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	dateIdx, ok := firstCol(col, dateAliases...)
	if !ok {
		return nil, fmt.Errorf("missing date column (tried: %s)", strings.Join(dateAliases, ", "))
	}
	amtIdx, ok := firstCol(col, amountAliases...)
	if !ok {
		return nil, fmt.Errorf("missing amount column (tried: %s)", strings.Join(amountAliases, ", "))
	}
	refIdx, _ := firstCol(col, refAliases...)
	descIdx, _ := firstCol(col, descAliases...)

	var out []bankRow
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		ts, err := parseBankDate(rec[dateIdx])
		if err != nil {
			continue
		}
		amt, err := parseBankAmount(rec[amtIdx])
		if err != nil || amt <= 0 {
			continue
		}
		row := bankRow{TransferredAt: ts, AmountCents: amt}
		if refIdx >= 0 && refIdx < len(rec) {
			row.BankRef = strings.TrimSpace(rec[refIdx])
		}
		if descIdx >= 0 && descIdx < len(rec) {
			row.Description = strings.TrimSpace(rec[descIdx])
		}
		out = append(out, row)
	}
	return out, nil
}

func firstCol(m map[string]int, keys ...string) (int, bool) {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			return v, true
		}
	}
	return -1, false
}

// detectBank inspects the header signature and returns a label like
// "scb", "kbank", "bbl". Used purely for the audit log — it doesn't
// change parser behaviour because the alias table already normalises.
func detectBank(header []string) string {
	joined := strings.ToLower(strings.Join(header, " "))
	switch {
	case strings.Contains(joined, "siam commercial") || strings.Contains(joined, "scb"):
		return "scb"
	case strings.Contains(joined, "kasikorn") || strings.Contains(joined, "kbank") ||
		strings.Contains(joined, "กสิกร"):
		return "kbank"
	case strings.Contains(joined, "bangkok bank") || strings.Contains(joined, "bbl") ||
		strings.Contains(joined, "ธนาคารกรุงเทพ"):
		return "bbl"
	case strings.Contains(joined, "krungthai") || strings.Contains(joined, "ktb") ||
		strings.Contains(joined, "กรุงไทย"):
		return "ktb"
	case strings.Contains(joined, "ayudhya") || strings.Contains(joined, "krungsri") ||
		strings.Contains(joined, "bay") || strings.Contains(joined, "กรุงศรี"):
		return "bay"
	}
	return "generic"
}

func parseBankDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
		"02/01/2006 15:04",
		"02/01/2006",
		"01/02/2006",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognised date: %q", s)
}

func parseBankAmount(s string) (int64, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, ",", "")
	s = strings.ReplaceAll(s, "฿", "")
	s = strings.ReplaceAll(s, "THB", "")
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty")
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	return int64(f * 100), nil
}

// matchRows runs the heuristic and stamps proposed matches.
func (h *BankImportHandler) matchRows(ctx context.Context, importID string) error {
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, transferred_at, amount_cents, COALESCE(bank_ref,'')
		  FROM bank_statement_rows
		 WHERE import_id = $1 AND match_status = 'unmatched'`, importID)
	if err != nil {
		return err
	}
	type input struct {
		id      string
		at      time.Time
		amount  int64
		bankRef string
	}
	var inputs []input
	for rows.Next() {
		var i input
		if err := rows.Scan(&i.id, &i.at, &i.amount, &i.bankRef); err != nil {
			rows.Close()
			return err
		}
		inputs = append(inputs, i)
	}
	rows.Close()

	used := map[string]bool{} // payment ids already proposed in this batch
	matched := 0
	for _, in := range inputs {
		// Find the best candidate: exact amount, status awaiting_verification,
		// within ±N day window of transferred_at (fall back to created_at).
		var pickedID string
		if err := tx.QueryRow(ctx, `
			SELECT p.id
			  FROM payments p
			 WHERE p.method = 'bank_transfer'
			   AND p.status = 'awaiting_verification'
			   AND p.amount_cents = $1
			   AND COALESCE(p.transferred_at, p.created_at) BETWEEN $2 AND $3
			   AND NOT (p.id = ANY($4::uuid[]))
			 ORDER BY
			   CASE WHEN $5 <> '' AND p.bank_ref IS NOT NULL AND p.bank_ref ILIKE '%' || $5 || '%' THEN 0 ELSE 1 END,
			   ABS(EXTRACT(EPOCH FROM (COALESCE(p.transferred_at, p.created_at) - $6)))
			 LIMIT 1`,
			in.amount,
			in.at.Add(-matchDayWindow*24*time.Hour),
			in.at.Add(matchDayWindow*24*time.Hour),
			usedIDs(used),
			in.bankRef,
			in.at,
		).Scan(&pickedID); err != nil {
			continue
		}
		used[pickedID] = true
		if _, err := tx.Exec(ctx, `
			UPDATE bank_statement_rows
			   SET matched_payment_id = $1, match_status = 'proposed'
			 WHERE id = $2`, pickedID, in.id); err != nil {
			return err
		}
		matched++
	}

	if _, err := tx.Exec(ctx, `
		UPDATE bank_statement_imports SET matched_rows = $1 WHERE id = $2`,
		matched, importID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func usedIDs(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// loadImport returns the full picture: header + rows + payment context
// for each proposed match.
func (h *BankImportHandler) loadImport(ctx context.Context, id string) (map[string]any, error) {
	var (
		sourceName, rawFilename, status *string
		parsed, matched, applied        int
		createdAt                       time.Time
		appliedAt                       *time.Time
	)
	if err := h.DB.QueryRow(ctx, `
		SELECT source_name, raw_filename, status, parsed_rows, matched_rows, applied_rows, created_at, applied_at
		  FROM bank_statement_imports WHERE id=$1`, id).
		Scan(&sourceName, &rawFilename, &status, &parsed, &matched, &applied, &createdAt, &appliedAt); err != nil {
		return nil, fmt.Errorf("import not found")
	}

	rows, err := h.DB.Query(ctx, `
		SELECT r.id, r.line_number, r.transferred_at, r.amount_cents,
		       r.bank_ref, r.description, r.match_status,
		       r.matched_payment_id,
		       p.payment_number, p.invoice_id, i.invoice_number, c.name
		  FROM bank_statement_rows r
		  LEFT JOIN payments  p ON p.id = r.matched_payment_id
		  LEFT JOIN invoices  i ON i.id = p.invoice_id
		  LEFT JOIN customers c ON c.id = p.customer_id
		 WHERE r.import_id = $1
		 ORDER BY r.line_number`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var (
			rowID                                     string
			line                                      int
			ts                                        time.Time
			amount                                    int64
			ref, desc, matchStatus                    *string
			matchedPayID, payNumber, invID, invNumber *string
			customerName                              *string
		)
		var ms string
		if err := rows.Scan(&rowID, &line, &ts, &amount, &ref, &desc, &ms,
			&matchedPayID, &payNumber, &invID, &invNumber, &customerName); err != nil {
			return nil, err
		}
		matchStatus = &ms
		out = append(out, map[string]any{
			"id": rowID, "line_number": line, "transferred_at": ts,
			"amount_cents": amount, "bank_ref": ref, "description": desc,
			"match_status":       matchStatus,
			"matched_payment_id": matchedPayID,
			"payment_number":     payNumber, "invoice_id": invID,
			"invoice_number": invNumber, "customer_name": customerName,
		})
	}

	return map[string]any{
		"id":           id,
		"source_name":  sourceName,
		"raw_filename": rawFilename,
		"status":       status,
		"parsed_rows":  parsed,
		"matched_rows": matched,
		"applied_rows": applied,
		"created_at":   createdAt,
		"applied_at":   appliedAt,
		"rows":         out,
	}, nil
}
