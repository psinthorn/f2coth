package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/mail"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/auth-api/internal/middleware"
)

// PDPA s.30 requires reasonable verification of the data subject's identity.
// We use a double-opt-in email confirmation: the request stays in 'unverified'
// status (and out of the staff queue) until the requester clicks a one-time
// link mailed to the address they submitted.
const dsrVerificationTTL = 7 * 24 * time.Hour

var privacyUUIDRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// PrivacyHandler handles PDPA Data Subject Request (DSR) endpoints.
//   Public:  POST /api/privacy/dsr           — any visitor submits a request
//   Admin:   GET  /api/privacy/dsr            — list all DSRs (admin only)
//   Admin:   GET  /api/privacy/dsr/{id}       — get single DSR
//   Admin:   PATCH /api/privacy/dsr/{id}      — update status / assign / respond

type PrivacyHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type dsrSubmitReq struct {
	RequesterEmail string `json:"requester_email"`
	RequesterName  string `json:"requester_name"`
	RequestType    string `json:"request_type"`
	Description    string `json:"description"`
	Locale         string `json:"locale"`
}

// dsrUpdateReq uses pointer fields so the handler can distinguish three states
// per field (PATCH semantics):
//   nil pointer  → field absent from request, leave the column unchanged
//   empty string → explicit clear (NULL for nullable columns, error for NOT NULL)
//   value        → set to value
type dsrUpdateReq struct {
	Status        *string `json:"status"`
	AssignedTo    *string `json:"assigned_to"`
	ResponseNotes *string `json:"response_notes"`
}

type dsrRow struct {
	ID             string     `json:"id"`
	RequesterEmail string     `json:"requester_email"`
	RequesterName  string     `json:"requester_name"`
	RequestType    string     `json:"request_type"`
	Description    string     `json:"description"`
	Locale         string     `json:"locale"`
	Status         string     `json:"status"`
	AssignedTo     *string    `json:"assigned_to,omitempty"`
	DueDate        time.Time  `json:"due_date"`
	ResponseNotes  *string    `json:"response_notes,omitempty"`
	FulfilledAt    *time.Time `json:"fulfilled_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

var validRequestTypes = map[string]bool{
	"access": true, "rectification": true, "erasure": true,
	"portability": true, "objection": true, "restrict": true,
}

var validDSRStatuses = map[string]bool{
	"unverified": true, "pending": true, "in_progress": true,
	"completed": true, "rejected": true, "withdrawn": true,
}

// generateDSRToken returns a (raw_token, sha256_hex_hash) pair. Only the hash
// is stored in the DB; the raw token is mailed to the requester in the link.
func generateDSRToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

// SubmitDSR — public endpoint. Any visitor can submit a data subject request.
// The request lands in 'unverified' status and a one-time confirmation email
// is sent to the address provided. Staff are NOT alerted until the requester
// clicks the link, which prevents spoofed-email abuse (see PDPA s.30).
// POST /api/privacy/dsr
func (h *PrivacyHandler) SubmitDSR(w http.ResponseWriter, r *http.Request) {
	var req dsrSubmitReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	req.RequesterEmail = strings.TrimSpace(strings.ToLower(req.RequesterEmail))
	req.RequesterName = strings.TrimSpace(req.RequesterName)
	if req.RequesterEmail == "" || req.RequesterName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "requester_email and requester_name required"})
		return
	}
	if _, err := mail.ParseAddress(req.RequesterEmail); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid requester_email"})
		return
	}
	if !validRequestTypes[req.RequestType] {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request_type"})
		return
	}
	if req.Locale != "en" && req.Locale != "th" {
		req.Locale = "en"
	}

	rawToken, tokenHash, err := generateDSRToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token generation failed"})
		return
	}
	expiresAt := time.Now().UTC().Add(dsrVerificationTTL)

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "tx begin failed"})
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var id string
	err = tx.QueryRow(ctx, `
		INSERT INTO data_subject_requests
			(requester_email, requester_name, request_type, description, locale,
			 status, verification_token_hash, verification_expires_at)
		VALUES ($1, $2, $3, $4, $5, 'unverified', $6, $7)
		RETURNING id`,
		req.RequesterEmail, req.RequesterName, req.RequestType,
		req.Description, req.Locale, tokenHash, expiresAt,
	).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not create request"})
		return
	}

	if err := writeAuditEntry(ctx, tx, id, "", "submit", map[string]any{
		"request_type": req.RequestType,
		"locale":       req.Locale,
	}); err != nil {
		log.Printf("dsr-audit: failed to write submit audit (dsr=%s): %v", id, err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "audit failed"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "commit failed"})
		return
	}

	go h.dispatchVerificationEmail(id, req, rawToken)

	writeJSON(w, http.StatusCreated, map[string]string{
		"id":      id,
		"status":  "unverified",
		"message": "Please check your inbox to confirm your request.",
	})
}

// VerifyDSR — public endpoint. The link from dsr_verify_email lands here.
// On success, flips status 'unverified' → 'pending', records verified_at,
// clears the token, and fires the ACK + staff alert. Redirects the browser
// to the locale-aware confirmation page with a status query parameter so
// the page can render the result in the requester's language.
// GET /api/privacy/dsr/verify?token=<hex>
func (h *PrivacyHandler) VerifyDSR(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("token"))
	// Token is 32 random bytes hex-encoded (64 chars); reject anything else.
	if len(raw) != 64 || !isHex(raw) {
		h.redirectConfirm(w, r, "en", "invalid")
		return
	}
	sum := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(sum[:])

	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		h.redirectConfirm(w, r, "en", "expired")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		id, email, name, reqType, locale string
		dueDate                          time.Time
	)
	err = tx.QueryRow(ctx, `
		UPDATE data_subject_requests
		   SET status                  = 'pending',
		       verified_at             = NOW(),
		       verification_token_hash = NULL,
		       verification_expires_at = NULL
		 WHERE verification_token_hash = $1
		   AND status                  = 'unverified'
		   AND verification_expires_at > NOW()
		RETURNING id, requester_email, requester_name, request_type, locale, due_date`,
		tokenHash,
	).Scan(&id, &email, &name, &reqType, &locale, &dueDate)
	if err != nil {
		// Either no row matched (bad/used token), or it expired. Surface a
		// generic "invalid or expired" message — don't leak which.
		h.redirectConfirm(w, r, "en", "expired")
		return
	}

	if err := writeAuditEntry(ctx, tx, id, "", "verify", map[string]any{
		"status": map[string]any{"from": "unverified", "to": "pending"},
	}); err != nil {
		log.Printf("dsr-audit: failed to write verify audit (dsr=%s): %v", id, err)
		h.redirectConfirm(w, r, locale, "expired")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		h.redirectConfirm(w, r, locale, "expired")
		return
	}

	go h.dispatchVerifiedNotifications(id, dsrSubmitReq{
		RequesterEmail: email, RequesterName: name,
		RequestType: reqType, Locale: locale,
	}, dueDate)

	h.redirectConfirm(w, r, locale, "verified")
}

func (h *PrivacyHandler) redirectConfirm(w http.ResponseWriter, r *http.Request, locale, status string) {
	if locale != "en" && locale != "th" {
		locale = "en"
	}
	target := h.Cfg.SiteURL + "/" + locale + "/privacy/confirm?status=" + url.QueryEscape(status)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func isHex(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// ListDSRs — admin only.
// GET /api/privacy/dsr?status=pending
// Unverified (double-opt-in pending) requests are excluded unless the caller
// explicitly passes ?status=unverified, so the staff queue is not cluttered
// with spoofed-email submissions that never get confirmed.
func (h *PrivacyHandler) ListDSRs(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	var rows []dsrRow

	query := `
		SELECT id, requester_email, requester_name, request_type,
		       COALESCE(description, ''),
		       locale, status, assigned_to::text, due_date, response_notes, fulfilled_at, created_at
		FROM data_subject_requests`
	args := []any{}
	if status != "" && validDSRStatuses[status] {
		query += " WHERE status = $1"
		args = append(args, status)
	} else {
		query += " WHERE status <> 'unverified'"
	}
	query += " ORDER BY due_date ASC, created_at ASC"

	pgRows, err := h.DB.Query(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query failed"})
		return
	}
	defer pgRows.Close()
	for pgRows.Next() {
		var row dsrRow
		if err := pgRows.Scan(
			&row.ID, &row.RequesterEmail, &row.RequesterName, &row.RequestType,
			&row.Description, &row.Locale, &row.Status, &row.AssignedTo,
			&row.DueDate, &row.ResponseNotes, &row.FulfilledAt, &row.CreatedAt,
		); err != nil {
			log.Printf("dsr-list: scan failed (status filter=%q): %v", status, err)
			continue
		}
		rows = append(rows, row)
	}
	if rows == nil {
		rows = []dsrRow{}
	}
	writeJSON(w, http.StatusOK, rows)
}

// GetDSR — admin only.
// GET /api/privacy/dsr/{id}
func (h *PrivacyHandler) GetDSR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var row dsrRow
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, requester_email, requester_name, request_type,
		       COALESCE(description, ''),
		       locale, status, assigned_to::text, due_date, response_notes, fulfilled_at, created_at
		FROM data_subject_requests WHERE id = $1`, id,
	).Scan(
		&row.ID, &row.RequesterEmail, &row.RequesterName, &row.RequestType,
		&row.Description, &row.Locale, &row.Status, &row.AssignedTo,
		&row.DueDate, &row.ResponseNotes, &row.FulfilledAt, &row.CreatedAt,
	)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// UpdateDSR — admin only. Updates status, assignment, response notes with
// PATCH semantics (see dsrUpdateReq for the nil/empty/value convention).
// Wrapped in a transaction together with an audit_log INSERT so the
// state change and its audit record commit atomically.
// PATCH /api/privacy/dsr/{id}
func (h *PrivacyHandler) UpdateDSR(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !privacyUUIDRE.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid id"})
		return
	}

	var req dsrUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}

	// ---- validate per-field ---------------------------------------------------
	if req.Status != nil {
		if *req.Status == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "status cannot be empty"})
			return
		}
		if !validDSRStatuses[*req.Status] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid status"})
			return
		}
	}
	if req.AssignedTo != nil && *req.AssignedTo != "" && !privacyUUIDRE.MatchString(*req.AssignedTo) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "assigned_to must be a UUID or empty to unassign"})
		return
	}

	// ---- build the dynamic UPDATE --------------------------------------------
	sets := []string{}
	args := []any{id}
	idx := 2
	if req.Status != nil {
		sets = append(sets, "status = $"+itoa(idx))
		args = append(args, *req.Status)
		idx++
		// Auto-stamp fulfilled_at on the pending→completed transition; clear it
		// if the admin reverses out of completed.
		if *req.Status == "completed" {
			sets = append(sets, "fulfilled_at = NOW()")
		} else {
			sets = append(sets, "fulfilled_at = NULL")
		}
	}
	if req.AssignedTo != nil {
		// "" → unassign (NULL); UUID → assign.
		if *req.AssignedTo == "" {
			sets = append(sets, "assigned_to = NULL")
		} else {
			sets = append(sets, "assigned_to = $"+itoa(idx)+"::uuid")
			args = append(args, *req.AssignedTo)
			idx++
		}
	}
	if req.ResponseNotes != nil {
		// "" → clear notes (NULL); value → set.
		if *req.ResponseNotes == "" {
			sets = append(sets, "response_notes = NULL")
		} else {
			sets = append(sets, "response_notes = $"+itoa(idx))
			args = append(args, *req.ResponseNotes)
			idx++
		}
	}
	if len(sets) == 0 {
		// Nothing to change. Just return current state.
		h.GetDSR(w, r)
		return
	}

	// ---- transaction: snapshot → update → diff → audit -----------------------
	ctx := r.Context()
	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "tx begin failed"})
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // safe to call after Commit

	before, err := readDSRMutable(ctx, tx, id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}

	query := "UPDATE data_subject_requests SET " + strings.Join(sets, ", ") + " WHERE id = $1"
	if _, err := tx.Exec(ctx, query, args...); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "update failed"})
		return
	}

	after, err := readDSRMutable(ctx, tx, id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "post-update read failed"})
		return
	}

	if changes := diffMutable(before, after); len(changes) > 0 {
		actorID, _ := ctx.Value(authmw.CtxUserID).(string)
		if err := writeAuditEntry(ctx, tx, id, actorID, "update", changes); err != nil {
			log.Printf("dsr-audit: failed to write audit row (dsr=%s actor=%s): %v", id, actorID, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "audit failed"})
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "commit failed"})
		return
	}

	h.GetDSR(w, r)
}

// itoa wraps strconv.Itoa for readability where it's spliced into SQL.
func itoa(n int) string { return strconv.Itoa(n) }

// dsrMutable captures only the columns that admin PATCH can touch, used as
// the "before/after" snapshot for the audit diff.
type dsrMutable struct {
	Status        string
	AssignedTo    *string
	ResponseNotes *string
	FulfilledAt   *time.Time
}

// readDSRMutable reads the patchable columns inside a transaction. Returns
// pgx.ErrNoRows if the DSR does not exist, which the caller maps to 404.
func readDSRMutable(ctx context.Context, tx pgx.Tx, id string) (dsrMutable, error) {
	var m dsrMutable
	err := tx.QueryRow(ctx, `
		SELECT status, assigned_to::text, response_notes, fulfilled_at
		FROM data_subject_requests
		WHERE id = $1`, id,
	).Scan(&m.Status, &m.AssignedTo, &m.ResponseNotes, &m.FulfilledAt)
	return m, err
}

// diffMutable returns a JSON-friendly map of {field: {from, to}} entries for
// every column that actually changed. Returns empty map when nothing changed.
func diffMutable(before, after dsrMutable) map[string]any {
	out := map[string]any{}
	if before.Status != after.Status {
		out["status"] = map[string]any{"from": before.Status, "to": after.Status}
	}
	if !strPtrEq(before.AssignedTo, after.AssignedTo) {
		out["assigned_to"] = map[string]any{"from": before.AssignedTo, "to": after.AssignedTo}
	}
	if !strPtrEq(before.ResponseNotes, after.ResponseNotes) {
		out["response_notes"] = map[string]any{"from": before.ResponseNotes, "to": after.ResponseNotes}
	}
	if !timePtrEq(before.FulfilledAt, after.FulfilledAt) {
		out["fulfilled_at"] = map[string]any{"from": before.FulfilledAt, "to": after.FulfilledAt}
	}
	return out
}

func strPtrEq(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func timePtrEq(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}

// writeAudit appends a row to the generic audit_log keyed on
// (resource_type, resource_id) so any handler (DSR, module toggles, users, …)
// can share the same trail. The user's email is snapshotted at write time via
// a JOIN so it survives later user deletion / email change. actorID may be
// empty for system-driven events ('submit', 'verify'); in that case actor_id
// and actor_email are stored as NULL.
func writeAudit(ctx context.Context, tx pgx.Tx, resourceType, resourceID, actorID, action string, changes map[string]any) error {
	payload, err := json.Marshal(changes)
	if err != nil {
		return err
	}
	if actorID == "" {
		_, err = tx.Exec(ctx, `
			INSERT INTO audit_log (resource_type, resource_id, actor_id, actor_email, action, changes)
			VALUES ($1, $2, NULL, NULL, $3, $4::jsonb)`,
			resourceType, resourceID, action, string(payload),
		)
		return err
	}
	// LEFT JOIN against users so the row still writes even if the actor_id has
	// been removed between JWT issue and now (actor_email becomes NULL).
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log (resource_type, resource_id, actor_id, actor_email, action, changes)
		SELECT $1, $2, u.id, u.email, $4, $5::jsonb
		FROM (SELECT $3::uuid AS id) src
		LEFT JOIN users u ON u.id = src.id`,
		resourceType, resourceID, actorID, action, string(payload),
	)
	return err
}

// writeAuditEntry is the DSR-specific wrapper preserving the prior call shape.
// New DSR call sites should continue using this; non-DSR resources call
// writeAudit directly with the appropriate resource_type.
func writeAuditEntry(ctx context.Context, tx pgx.Tx, dsrID, actorID, action string, changes map[string]any) error {
	return writeAudit(ctx, tx, "dsr", dsrID, actorID, action, changes)
}

// slaResp summarises DSR queue health for the admin dashboard. The counts
// give a single-glance view of PDPA exposure; the lists are surfaced in the
// UI so an admin can click straight through to the at-risk requests.
type slaResp struct {
	OverdueCount  int      `json:"overdue_count"`
	DueSoonCount  int      `json:"due_soon_count"`
	Overdue       []dsrRow `json:"overdue"`
	DueSoon       []dsrRow `json:"due_soon"`
	GeneratedAt   string   `json:"generated_at"`
	DueSoonWindow string   `json:"due_soon_window"`
}

// GetSLA — admin only. Returns DSRs that are overdue (past PDPA's 30-day
// deadline) or due within 7 days, plus their counts. Intended for an admin
// dashboard widget; safe to poll.
// GET /api/privacy/dsr/sla
func (h *PrivacyHandler) GetSLA(w http.ResponseWriter, r *http.Request) {
	overdue, err := h.readSLARows(r.Context(), "due_date < NOW()")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "overdue query failed"})
		return
	}
	dueSoon, err := h.readSLARows(r.Context(), "due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "due-soon query failed"})
		return
	}
	writeJSON(w, http.StatusOK, slaResp{
		OverdueCount:  len(overdue),
		DueSoonCount:  len(dueSoon),
		Overdue:       overdue,
		DueSoon:       dueSoon,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		DueSoonWindow: "7d",
	})
}

// readSLARows runs the SLA query with the supplied predicate. The predicate
// is a literal SQL fragment (not parameterised) — only call with the two
// hard-coded fragments above to keep this safe from injection.
func (h *PrivacyHandler) readSLARows(ctx context.Context, predicate string) ([]dsrRow, error) {
	query := `
		SELECT id, requester_email, requester_name, request_type,
		       COALESCE(description, ''),
		       locale, status, assigned_to::text, due_date, response_notes, fulfilled_at, created_at
		  FROM data_subject_requests
		 WHERE status IN ('pending', 'in_progress')
		   AND ` + predicate + `
		 ORDER BY due_date ASC`
	pgRows, err := h.DB.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer pgRows.Close()
	rows := []dsrRow{}
	for pgRows.Next() {
		var row dsrRow
		if err := pgRows.Scan(
			&row.ID, &row.RequesterEmail, &row.RequesterName, &row.RequestType,
			&row.Description, &row.Locale, &row.Status, &row.AssignedTo,
			&row.DueDate, &row.ResponseNotes, &row.FulfilledAt, &row.CreatedAt,
		); err != nil {
			log.Printf("dsr-sla: scan failed (predicate=%q): %v", predicate, err)
			continue
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// RequireAdminMiddleware returns the admin-only middleware chain for privacy routes.
// Reuses authmw.RequireJWT + authmw.RequireRole — no new middleware written.
func (h *PrivacyHandler) RequireAdmin(next http.Handler) http.Handler {
	return authmw.RequireJWT(h.Cfg.JWTSecret)(authmw.RequireRole("admin")(next))
}

type notifyReq struct {
	Channel      string         `json:"channel"`
	Template     string         `json:"template"`
	ToAddress    string         `json:"to_address"`
	Payload      map[string]any `json:"payload"`
	RelatedDSRID string         `json:"related_dsr_id,omitempty"`
	Locale       string         `json:"locale"`
}

// sendNotification posts to notification-api. PDPA workflows are legally
// time-bound, so failures are logged loudly rather than silently swallowed.
// Caller invokes in a goroutine — never blocks the HTTP response.
func (h *PrivacyHandler) sendNotification(nr notifyReq) {
	body, err := json.Marshal(nr)
	if err != nil {
		log.Printf("dsr-notify: marshal failed (template=%s dsr=%s): %v", nr.Template, nr.RelatedDSRID, err)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(
		h.Cfg.NotificationAPIURL+"/api/notifications",
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("dsr-notify: POST failed (template=%s dsr=%s): %v", nr.Template, nr.RelatedDSRID, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("dsr-notify: notification-api returned %d (template=%s dsr=%s)", resp.StatusCode, nr.Template, nr.RelatedDSRID)
	}
}

// dispatchVerificationEmail sends the double-opt-in confirmation link to the
// submitter. No staff alert at this stage — that only fires on verification.
func (h *PrivacyHandler) dispatchVerificationEmail(dsrID string, req dsrSubmitReq, rawToken string) {
	verifyURL := h.Cfg.SiteURL + "/api/privacy/dsr/verify?token=" + url.QueryEscape(rawToken)
	h.sendNotification(notifyReq{
		Channel: "email", Template: "dsr_verify_email",
		ToAddress: req.RequesterEmail,
		Payload: map[string]any{
			"name":         req.RequesterName,
			"email":        req.RequesterEmail,
			"request_type": req.RequestType,
			"id":           dsrID,
			"verify_url":   verifyURL,
		},
		RelatedDSRID: dsrID, Locale: req.Locale,
	})
}

// dispatchVerifiedNotifications fires after the requester has confirmed
// ownership of the email address: the ACK to them (in their locale) and the
// alert to the F2 privacy team (always EN).
func (h *PrivacyHandler) dispatchVerifiedNotifications(dsrID string, req dsrSubmitReq, dueDate time.Time) {
	payload := map[string]any{
		"name":         req.RequesterName,
		"email":        req.RequesterEmail,
		"request_type": req.RequestType,
		"id":           dsrID,
		"due_date":     dueDate.Format("2006-01-02"),
		"admin_url":    h.Cfg.SiteURL + "/admin/dsr/" + dsrID,
	}
	h.sendNotification(notifyReq{
		Channel: "email", Template: "dsr_received_requester",
		ToAddress: req.RequesterEmail, Payload: payload,
		RelatedDSRID: dsrID, Locale: req.Locale,
	})
	h.sendNotification(notifyReq{
		Channel: "email", Template: "dsr_received_staff",
		ToAddress: h.Cfg.PrivacyNotifyTo, Payload: payload,
		RelatedDSRID: dsrID, Locale: "en",
	})
}
