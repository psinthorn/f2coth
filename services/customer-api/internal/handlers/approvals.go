package handlers

// Reusable customer-approval handlers (migration 075). Three access paths:
//   - Admin (staff JWT): build / send / resend / cancel approval requests.
//   - Public (magic-link, NO auth): view + decide via a single-use token.
//     The token IS the credential — mounted under /api/customer/approvals/link
//     so Traefik routes it to this service without a portal session.
// Tokens mirror the password_resets / DSR design (crypto/rand → sha256 stored).
// Full spec: docs/approval-system-specs.md.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/customer-api/internal/config"
	"github.com/f2cothai/f2-website/services/customer-api/internal/models"
	"github.com/f2cothai/f2-website/services/customer-api/internal/notify"
)

type ApprovalHandler struct {
	DB     *pgxpool.Pool
	Cfg    config.Config
	Notify *notify.Client
}

const (
	approvalTokenTTLDays = 14
	maxApprovalItems     = 100
	approvalVATRateBP    = 700
)

var validApprovalKind = map[string]bool{"quotation": true, "resolution": true, "general": true}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// formatMoney renders satang minor units as e.g. "฿1,234.56" / "$1,234.56".
func formatMoney(cents int64, currency string) string {
	sym := "฿"
	if currency == "USD" {
		sym = "$"
	}
	neg := cents < 0
	if neg {
		cents = -cents
	}
	whole := cents / 100
	frac := cents % 100
	// Thousands separators on the integer part.
	s := fmt.Sprintf("%d", whole)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	out := fmt.Sprintf("%s%s.%02d", sym, b.String(), frac)
	if neg {
		out = "-" + out
	}
	return out
}

func computeApprovalTotals(items []models.ApprovalItem) (subtotal, vat, total int64) {
	for _, it := range items {
		subtotal += it.AmountCents
	}
	vat = subtotal * approvalVATRateBP / 10000
	total = subtotal + vat
	return
}

// ---------- shared loaders ----------

const approvalSelect = `
    SELECT a.id, a.subject_type, a.subject_id, a.customer_id, c.name,
           a.kind, a.status, a.title, a.body_md, a.currency,
           a.subtotal_cents, a.vat_rate_bp, a.vat_cents, a.total_cents,
           a.requested_by_user_id, a.decided_by_contact_id, dc.full_name,
           a.decided_via, a.decided_at, a.decline_reason,
           a.sent_at, a.expires_at, a.created_at, a.updated_at
      FROM approvals a
      JOIN customers c ON c.id = a.customer_id
      LEFT JOIN customer_contacts dc ON dc.id = a.decided_by_contact_id`

func scanApproval(row interface{ Scan(...any) error }, a *models.Approval) error {
	return row.Scan(&a.ID, &a.SubjectType, &a.SubjectID, &a.CustomerID, &a.CustomerName,
		&a.Kind, &a.Status, &a.Title, &a.BodyMD, &a.Currency,
		&a.SubtotalCents, &a.VATRateBP, &a.VATCents, &a.TotalCents,
		&a.RequestedByUserID, &a.DecidedByContactID, &a.DecidedByName,
		&a.DecidedVia, &a.DecidedAt, &a.DeclineReason,
		&a.SentAt, &a.ExpiresAt, &a.CreatedAt, &a.UpdatedAt)
}

func (h *ApprovalHandler) loadItems(ctx context.Context, approvalID string) ([]models.ApprovalItem, error) {
	rows, err := h.DB.Query(ctx, `
        SELECT id, approval_id, item_type, ref_type, ref_id, label, detail_md,
               quantity, unit, unit_price_cents, amount_cents, sort_order, created_at
          FROM approval_items WHERE approval_id = $1 ORDER BY sort_order, created_at`, approvalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]models.ApprovalItem, 0, 8)
	for rows.Next() {
		var it models.ApprovalItem
		if err := rows.Scan(&it.ID, &it.ApprovalID, &it.ItemType, &it.RefType, &it.RefID, &it.Label,
			&it.DetailMD, &it.Quantity, &it.Unit, &it.UnitPriceCents, &it.AmountCents,
			&it.SortOrder, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

// effectiveStatus treats a past-expiry 'sent' approval as expired (lazy expiry,
// spec §11.2) without persisting the change in Phase 1.
func effectiveStatus(a *models.Approval) string {
	if a.Status == "sent" && a.ExpiresAt != nil && a.ExpiresAt.Before(time.Now()) {
		return "expired"
	}
	return a.Status
}

// =====================================================================
// Admin (staff JWT)
// =====================================================================

type approvalItemReq struct {
	ItemType       string  `json:"item_type"`
	RefType        string  `json:"ref_type"`
	RefID          string  `json:"ref_id"`
	Label          string  `json:"label"`
	DetailMD       string  `json:"detail_md"`
	Quantity       *int    `json:"quantity"`
	Unit           string  `json:"unit"`
	UnitPriceCents *int64  `json:"unit_price_cents"`
	AmountCents    int64   `json:"amount_cents"`
}

type createApprovalReq struct {
	SubjectType string            `json:"subject_type"`
	SubjectID   string            `json:"subject_id"`
	Kind        string            `json:"kind"`
	Title       string            `json:"title"`
	BodyMD      string            `json:"body_md"`
	Currency    string            `json:"currency"`
	Items       []approvalItemReq `json:"items"`
}

// CreateApproval — POST /customer/admin/approvals
func (h *ApprovalHandler) CreateApproval(w http.ResponseWriter, r *http.Request) {
	uid := staffID(r)
	var req createApprovalReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 256*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.SubjectType = strings.TrimSpace(req.SubjectType)
	req.Title = strings.TrimSpace(req.Title)
	if req.SubjectType != "ticket" {
		writeErr(w, http.StatusBadRequest, "unsupported subject_type")
		return
	}
	if req.Title == "" {
		writeErr(w, http.StatusBadRequest, "title is required")
		return
	}
	if req.Kind == "" {
		req.Kind = "general"
	}
	if !validApprovalKind[req.Kind] {
		writeErr(w, http.StatusBadRequest, "invalid kind")
		return
	}

	// Resolve the owning customer from the ticket (also validates existence).
	var customerID string
	err := h.DB.QueryRow(r.Context(),
		`SELECT customer_id::text FROM tickets WHERE id = $1`, req.SubjectID).Scan(&customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "ticket not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// Build the item set. If none supplied for a quotation, prefill from the
	// ticket's non-covered billable lines (snapshot).
	items := make([]models.ApprovalItem, 0, len(req.Items))
	currency := strings.TrimSpace(req.Currency)
	if len(req.Items) == 0 && req.Kind == "quotation" {
		rows, err := h.DB.Query(r.Context(), `
            SELECT id::text, description_en, unit, quantity, unit_price_cents, amount_cents, currency
              FROM ticket_line_items
             WHERE ticket_id = $1 AND NOT covered
             ORDER BY sort_order, created_at`, req.SubjectID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db error")
			return
		}
		defer rows.Close()
		for rows.Next() {
			var (
				lineID, desc, unit, cur string
				qty                     int
				unitPrice, amount       int64
			)
			if err := rows.Scan(&lineID, &desc, &unit, &qty, &unitPrice, &amount, &cur); err != nil {
				writeErr(w, http.StatusInternalServerError, "scan error")
				return
			}
			rt, rid := "ticket_line_item", lineID
			q, u, up := qty, unit, unitPrice
			items = append(items, models.ApprovalItem{
				ItemType: "line", RefType: &rt, RefID: &rid, Label: desc,
				Quantity: &q, Unit: &u, UnitPriceCents: &up, AmountCents: amount,
			})
			currency = cur
		}
	} else {
		for _, it := range req.Items {
			if strings.TrimSpace(it.Label) == "" {
				continue
			}
			itemType := it.ItemType
			if itemType == "" {
				itemType = "text"
			}
			m := models.ApprovalItem{
				ItemType: itemType, Label: strings.TrimSpace(it.Label),
				DetailMD: it.DetailMD, Quantity: it.Quantity, AmountCents: it.AmountCents,
			}
			if it.RefType != "" {
				m.RefType = &it.RefType
			}
			if it.RefID != "" {
				m.RefID = &it.RefID
			}
			if it.Unit != "" {
				m.Unit = &it.Unit
			}
			if it.UnitPriceCents != nil {
				m.UnitPriceCents = it.UnitPriceCents
			}
			items = append(items, m)
		}
	}
	if len(items) > maxApprovalItems {
		writeErr(w, http.StatusBadRequest, "too many items")
		return
	}
	subtotal, vat, total := computeApprovalTotals(items)

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	if err := tx.QueryRow(r.Context(), `
        INSERT INTO approvals
            (subject_type, subject_id, customer_id, kind, status, title, body_md,
             currency, subtotal_cents, vat_rate_bp, vat_cents, total_cents, requested_by_user_id)
        VALUES ($1,$2,$3,$4,'draft',$5,$6, NULLIF($7,''),$8,$9,$10,$11, NULLIF($12,'')::uuid)
        RETURNING id`,
		req.SubjectType, req.SubjectID, customerID, req.Kind, req.Title, req.BodyMD,
		currency, subtotal, approvalVATRateBP, vat, total, uid).Scan(&id); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create approval")
		return
	}
	for i, it := range items {
		if _, err := tx.Exec(r.Context(), `
            INSERT INTO approval_items
                (approval_id, item_type, ref_type, ref_id, label, detail_md,
                 quantity, unit, unit_price_cents, amount_cents, sort_order)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			id, it.ItemType, it.RefType, it.RefID, it.Label, it.DetailMD,
			it.Quantity, it.Unit, it.UnitPriceCents, it.AmountCents, i); err != nil {
			writeErr(w, http.StatusInternalServerError, "could not save items")
			return
		}
	}
	if err := writeAudit(r.Context(), tx, "approval", id, uid, "created",
		map[string]any{"kind": req.Kind, "subject_type": req.SubjectType, "subject_id": req.SubjectID}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

// ListApprovals — GET /customer/admin/approvals?subject_type=&subject_id=
func (h *ApprovalHandler) ListApprovals(w http.ResponseWriter, r *http.Request) {
	st := r.URL.Query().Get("subject_type")
	sid := r.URL.Query().Get("subject_id")
	if st == "" || sid == "" {
		writeErr(w, http.StatusBadRequest, "subject_type and subject_id are required")
		return
	}
	rows, err := h.DB.Query(r.Context(),
		approvalSelect+` WHERE a.subject_type=$1 AND a.subject_id=$2 ORDER BY a.created_at DESC`, st, sid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := make([]models.Approval, 0, 8)
	for rows.Next() {
		var a models.Approval
		if err := scanApproval(rows, &a); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		a.Status = effectiveStatus(&a)
		out = append(out, a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"approvals": out})
}

// GetApproval — GET /customer/admin/approvals/{id}
func (h *ApprovalHandler) GetApproval(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var a models.Approval
	err := scanApproval(h.DB.QueryRow(r.Context(), approvalSelect+` WHERE a.id=$1`, id), &a)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "approval not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	items, err := h.loadItems(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	a.Items = items
	a.Status = effectiveStatus(&a)
	writeJSON(w, http.StatusOK, a)
}

type sendApprovalReq struct {
	ContactID     string `json:"contact_id"`
	ExpiresInDays int    `json:"expires_in_days"`
}

// SendApproval — POST /customer/admin/approvals/{id}/send
func (h *ApprovalHandler) SendApproval(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := staffID(r)
	var req sendApprovalReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.ContactID == "" {
		writeErr(w, http.StatusBadRequest, "contact_id is required")
		return
	}
	days := req.ExpiresInDays
	if days <= 0 || days > 90 {
		days = approvalTokenTTLDays
	}

	var a models.Approval
	if err := scanApproval(h.DB.QueryRow(r.Context(), approvalSelect+` WHERE a.id=$1`, id), &a); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "approval not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if a.Status != "draft" {
		writeErr(w, http.StatusConflict, "only draft approvals can be sent (use resend)")
		return
	}

	// Recipient must be an active contact of this customer's org.
	var email, fullName, locale string
	err := h.DB.QueryRow(r.Context(), `
        SELECT cc.email, cc.full_name, COALESCE(cc.locale,'en')
          FROM customer_contacts cc
          JOIN contact_org_memberships m ON m.contact_id = cc.id
         WHERE cc.id = $1 AND m.customer_id = $2 AND cc.disabled_at IS NULL`,
		req.ContactID, a.CustomerID).Scan(&email, &fullName, &locale)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusBadRequest, "contact is not an active member of this customer")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// Re-freeze totals from the current items at send time.
	items, err := h.loadItems(r.Context(), id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	subtotal, vat, total := computeApprovalTotals(items)

	rawToken, tokenHash, err := mintContactToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	// Revoke any prior live tokens for this approval.
	if _, err := tx.Exec(r.Context(),
		`UPDATE approval_tokens SET revoked_at = NOW()
          WHERE approval_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO approval_tokens (approval_id, contact_id, token_hash, expires_at)
        VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)`,
		id, req.ContactID, tokenHash, fmt.Sprintf("%d", days)); err != nil {
		writeErr(w, http.StatusInternalServerError, "token store error")
		return
	}
	if _, err := tx.Exec(r.Context(), `
        UPDATE approvals
           SET status='sent', sent_at=NOW(),
               expires_at = NOW() + ($2 || ' days')::interval,
               subtotal_cents=$3, vat_cents=$4, total_cents=$5
         WHERE id=$1`,
		id, fmt.Sprintf("%d", days), subtotal, vat, total); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if err := writeAudit(r.Context(), tx, "approval", id, uid, "sent",
		map[string]any{"contact_id": req.ContactID, "total_cents": total}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	// Email the magic-link (best-effort).
	if locale == "" {
		locale = "en"
	}
	approvalURL := h.Cfg.PortalBaseURL + "/" + locale + "/approve/" + rawToken
	expiresOn := time.Now().AddDate(0, 0, days).Format("2 Jan 2006")
	h.Notify.Send(notify.Job{
		Channel:   "email",
		Template:  "approval_request_customer",
		ToAddress: email,
		Payload: map[string]any{
			"contact_name": fullName,
			"title":        a.Title,
			"total":        formatMoney(total, deref(a.Currency, "THB")),
			"expires_on":   expiresOn,
			"approval_url": approvalURL,
		},
		Locale: locale,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// ResendApproval — POST /customer/admin/approvals/{id}/resend
// Re-mints a link for an already-sent approval (e.g. reminder / lost email).
func (h *ApprovalHandler) ResendApproval(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := staffID(r)

	var a models.Approval
	if err := scanApproval(h.DB.QueryRow(r.Context(), approvalSelect+` WHERE a.id=$1`, id), &a); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeErr(w, http.StatusNotFound, "approval not found")
			return
		}
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if a.Status != "sent" {
		writeErr(w, http.StatusConflict, "only sent approvals can be resent")
		return
	}

	// Reuse the most-recent recipient contact.
	var contactID, email, fullName, locale string
	err := h.DB.QueryRow(r.Context(), `
        SELECT t.contact_id::text, cc.email, cc.full_name, COALESCE(cc.locale,'en')
          FROM approval_tokens t
          JOIN customer_contacts cc ON cc.id = t.contact_id
         WHERE t.approval_id = $1
         ORDER BY t.created_at DESC LIMIT 1`, id).Scan(&contactID, &email, &fullName, &locale)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "no prior recipient to resend to")
		return
	}

	rawToken, tokenHash, err := mintContactToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	days := approvalTokenTTLDays

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(),
		`UPDATE approval_tokens SET revoked_at = NOW()
          WHERE approval_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO approval_tokens (approval_id, contact_id, token_hash, expires_at)
        VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)`,
		id, contactID, tokenHash, fmt.Sprintf("%d", days)); err != nil {
		writeErr(w, http.StatusInternalServerError, "token store error")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE approvals SET expires_at = NOW() + ($2 || ' days')::interval WHERE id=$1`,
		id, fmt.Sprintf("%d", days)); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if err := writeAudit(r.Context(), tx, "approval", id, uid, "resent",
		map[string]any{"contact_id": contactID}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	if locale == "" {
		locale = "en"
	}
	approvalURL := h.Cfg.PortalBaseURL + "/" + locale + "/approve/" + rawToken
	expiresOn := time.Now().AddDate(0, 0, days).Format("2 Jan 2006")
	h.Notify.Send(notify.Job{
		Channel: "email", Template: "approval_request_customer", ToAddress: email,
		Payload: map[string]any{
			"contact_name": fullName, "title": a.Title,
			"total":        formatMoney(a.TotalCents, deref(a.Currency, "THB")),
			"expires_on":   expiresOn, "approval_url": approvalURL,
		},
		Locale: locale,
	})
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

// CancelApproval — POST /customer/admin/approvals/{id}/cancel
func (h *ApprovalHandler) CancelApproval(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	uid := staffID(r)
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	tag, err := tx.Exec(r.Context(),
		`UPDATE approvals SET status='cancelled'
          WHERE id=$1 AND status IN ('draft','sent')`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusConflict, "approval cannot be cancelled in its current state")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE approval_tokens SET revoked_at = NOW()
          WHERE approval_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, id); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if err := writeAudit(r.Context(), tx, "approval", id, uid, "cancelled", nil); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteApproval — DELETE /customer/admin/approvals/{id} (draft only)
func (h *ApprovalHandler) DeleteApproval(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := h.DB.Exec(r.Context(), `DELETE FROM approvals WHERE id=$1 AND status='draft'`, id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusConflict, "only draft approvals can be deleted")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// =====================================================================
// Public magic-link (no auth — the token is the credential)
// =====================================================================

// resolveToken loads the approval behind a raw token, plus token lifecycle
// flags. Returns pgx.ErrNoRows if the token is unknown.
func (h *ApprovalHandler) resolveToken(ctx context.Context, raw string) (a models.Approval, tokenContactID string, used, revoked bool, tokenExpires time.Time, err error) {
	if len(raw) != 64 {
		err = pgx.ErrNoRows
		return
	}
	err = h.DB.QueryRow(ctx, `
        SELECT t.contact_id::text, t.used_at IS NOT NULL, t.revoked_at IS NOT NULL, t.expires_at,
               a.id, a.subject_type, a.subject_id, a.customer_id, c.name,
               a.kind, a.status, a.title, a.body_md, a.currency,
               a.subtotal_cents, a.vat_rate_bp, a.vat_cents, a.total_cents,
               a.requested_by_user_id, a.decided_by_contact_id, dc.full_name,
               a.decided_via, a.decided_at, a.decline_reason,
               a.sent_at, a.expires_at, a.created_at, a.updated_at
          FROM approval_tokens t
          JOIN approvals a ON a.id = t.approval_id
          JOIN customers c ON c.id = a.customer_id
          LEFT JOIN customer_contacts dc ON dc.id = a.decided_by_contact_id
         WHERE t.token_hash = $1`, hashToken(raw)).Scan(
		&tokenContactID, &used, &revoked, &tokenExpires,
		&a.ID, &a.SubjectType, &a.SubjectID, &a.CustomerID, &a.CustomerName,
		&a.Kind, &a.Status, &a.Title, &a.BodyMD, &a.Currency,
		&a.SubtotalCents, &a.VATRateBP, &a.VATCents, &a.TotalCents,
		&a.RequestedByUserID, &a.DecidedByContactID, &a.DecidedByName,
		&a.DecidedVia, &a.DecidedAt, &a.DeclineReason,
		&a.SentAt, &a.ExpiresAt, &a.CreatedAt, &a.UpdatedAt)
	return
}

type publicFileMeta struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Filename string `json:"filename"`
	MimeType string `json:"mime_type"`
}

// PublicView — GET /customer/approvals/link/{token}
func (h *ApprovalHandler) PublicView(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "token")
	a, _, _, revoked, _, err := h.resolveToken(r.Context(), raw)
	if err != nil || revoked {
		writeErr(w, http.StatusNotFound, "this link is not valid")
		return
	}
	items, err := h.loadItems(r.Context(), a.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	a.Items = items
	a.Status = effectiveStatus(&a)

	// File metadata (streamed via the token-scoped file endpoint).
	files := make([]publicFileMeta, 0, 4)
	rows, err := h.DB.Query(r.Context(),
		`SELECT id::text, kind, filename, mime_type FROM attachments
          WHERE owner_type='approval' AND owner_id=$1 ORDER BY created_at`, a.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var f publicFileMeta
			if err := rows.Scan(&f.ID, &f.Kind, &f.Filename, &f.MimeType); err == nil {
				files = append(files, f)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"approval": a, "files": files})
}

// PublicFile — GET /customer/approvals/link/{token}/files/{fileId}
func (h *ApprovalHandler) PublicFile(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "token")
	fileID := chi.URLParam(r, "fileId")
	a, _, _, revoked, _, err := h.resolveToken(r.Context(), raw)
	if err != nil || revoked {
		writeErr(w, http.StatusNotFound, "this link is not valid")
		return
	}
	var (
		content  []byte
		mime     string
		filename string
	)
	err = h.DB.QueryRow(r.Context(),
		`SELECT content, mime_type, filename FROM attachments
          WHERE id=$1 AND owner_type='approval' AND owner_id=$2`, fileID, a.ID).
		Scan(&content, &mime, &filename)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "file not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", "inline; filename=\""+filename+"\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

type decideReq struct {
	Decision string `json:"decision"` // approved | declined
	Reason   string `json:"reason"`
}

// PublicDecide — POST /customer/approvals/link/{token}/decide
func (h *ApprovalHandler) PublicDecide(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "token")
	var req decideReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Decision = strings.TrimSpace(req.Decision)
	req.Reason = strings.TrimSpace(req.Reason)
	if req.Decision != "approved" && req.Decision != "declined" {
		writeErr(w, http.StatusBadRequest, "decision must be 'approved' or 'declined'")
		return
	}
	if req.Decision == "declined" && req.Reason == "" {
		writeErr(w, http.StatusBadRequest, "a reason is required to decline")
		return
	}

	a, tokenContactID, used, revoked, tokenExpires, err := h.resolveToken(r.Context(), raw)
	if err != nil || revoked {
		writeErr(w, http.StatusNotFound, "this link is not valid")
		return
	}
	// Idempotent: an already-decided approval returns its terminal state.
	if used || a.Status == "approved" || a.Status == "declined" {
		writeJSON(w, http.StatusOK, map[string]any{"status": a.Status, "already_decided": true})
		return
	}
	if a.Status != "sent" {
		writeErr(w, http.StatusConflict, "this request is no longer open")
		return
	}
	if tokenExpires.Before(time.Now()) || (a.ExpiresAt != nil && a.ExpiresAt.Before(time.Now())) {
		writeErr(w, http.StatusGone, "this link has expired")
		return
	}

	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var reason any
	if req.Decision == "declined" {
		reason = req.Reason
	}
	if _, err := tx.Exec(r.Context(), `
        UPDATE approvals
           SET status=$2, decided_by_contact_id=$3, decided_via='magic_link',
               decided_at=NOW(), decline_reason=$4
         WHERE id=$1 AND status='sent'`,
		a.ID, req.Decision, tokenContactID, reason); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE approval_tokens SET used_at=NOW(), ip_address=$2::inet, user_agent=$3
          WHERE token_hash=$1`,
		hashToken(raw), nullIfEmpty(clientIP(r)), r.UserAgent()); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	// Decline on a ticket → reopen + internal staff note, so it re-enters the queue.
	if req.Decision == "declined" && a.SubjectType == "ticket" {
		if _, err := tx.Exec(r.Context(),
			`UPDATE tickets SET status='in_progress', last_activity_at=NOW()
              WHERE id=$1 AND status NOT IN ('closed')`, a.SubjectID); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error")
			return
		}
		if a.RequestedByUserID != nil {
			note := fmt.Sprintf("Customer declined the approval \"%s\".\nReason: %s", a.Title, req.Reason)
			if _, err := tx.Exec(r.Context(), `
                INSERT INTO ticket_messages (ticket_id, author_user_id, body, internal)
                VALUES ($1, $2, $3, TRUE)`, a.SubjectID, *a.RequestedByUserID, note); err != nil {
				writeErr(w, http.StatusInternalServerError, "db error")
				return
			}
		}
	}
	if err := writeAudit(r.Context(), tx, "approval", a.ID, "", req.Decision,
		map[string]any{"contact_id": tokenContactID, "via": "magic_link", "reason": req.Reason, "ip": clientIP(r)}); err != nil {
		writeErr(w, http.StatusInternalServerError, "audit error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	h.notifyStaffOfDecision(r.Context(), a, req.Decision, req.Reason, tokenContactID)
	writeJSON(w, http.StatusOK, map[string]any{"status": req.Decision})
}

// notifyStaffOfDecision emails the ticket assignee (fallback SalesNotifyTo).
func (h *ApprovalHandler) notifyStaffOfDecision(ctx context.Context, a models.Approval, decision, reason, contactID string) {
	toAddr := h.Cfg.SalesNotifyTo
	locale := "en"
	if a.SubjectType == "ticket" {
		var email *string
		if err := h.DB.QueryRow(ctx, `
            SELECT u.email FROM tickets t
              LEFT JOIN users u ON u.id = t.assigned_to_user_id
             WHERE t.id = $1`, a.SubjectID).Scan(&email); err == nil && email != nil && *email != "" {
			toAddr = *email
		}
	}
	var deciderName string
	_ = h.DB.QueryRow(ctx, `SELECT full_name FROM customer_contacts WHERE id=$1`, contactID).Scan(&deciderName)

	template := "approval_approved_staff"
	if decision == "declined" {
		template = "approval_declined_staff"
	}
	subjectURL := h.Cfg.AdminBaseURL + "/admin/tickets/" + a.SubjectID
	h.Notify.Send(notify.Job{
		Channel: "email", Template: template, ToAddress: toAddr,
		Payload: map[string]any{
			"title": a.Title, "customer_name": a.CustomerName, "decided_by": deciderName,
			"reason": reason, "decided_at": time.Now().Format("2 Jan 2006 15:04"),
			"subject_url": subjectURL,
		},
		Locale: locale,
	})
}

func deref(p *string, def string) string {
	if p == nil || *p == "" {
		return def
	}
	return *p
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func clientIP(r *http.Request) string {
	// chi's RealIP middleware normalises RemoteAddr to the client IP.
	host := r.RemoteAddr
	if i := strings.LastIndex(host, ":"); i > 0 {
		host = host[:i]
	}
	return strings.Trim(host, "[]")
}
