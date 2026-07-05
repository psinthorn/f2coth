package handlers

// Password reset flow — shared handler for both staff (users) and
// customer contacts (customer_contacts).
//
// Design decisions:
//
//   • Enumeration-safe: forgot-password always returns 200 with the same
//     body, whether or not the email exists. The email is only sent if a
//     row matched. Timing is not constant, but that's an acceptable
//     tradeoff for the current threat model.
//
//   • Tokens are 32 bytes of CSPRNG entropy → hex-encoded (64 chars).
//     Only the SHA-256 hash lives in the DB, so a DB dump cannot be
//     used to redeem tokens.
//
//   • TTL: 60 minutes. Single-use — used_at is stamped on redeem inside
//     the same transaction that updates the password.
//
//   • Rate limiting: enforced at Traefik (5 req/min per IP on forgot,
//     20 req/min on reset). Not in-app.
//
//   • Two endpoint pairs sharing this file:
//        POST /api/auth/forgot-password          (staff)
//        POST /api/auth/reset-password           (staff)
//        POST /api/auth/customer/forgot-password (customer)
//        POST /api/auth/customer/reset-password  (customer)

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
)

const (
	resetTTL         = 60 * time.Minute
	resetTokenBytes  = 32
	minPasswordChars = 10
)

type PasswordResetHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type forgotReq struct {
	Email string `json:"email"`
}
type resetReq struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// mintToken returns (rawToken, sha256HexHash). Only the hash goes to the DB.
func mintToken() (string, string, error) {
	buf := make([]byte, resetTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

// ── Staff forgot / reset ───────────────────────────────────────────────

// POST /api/auth/forgot-password
func (h *PasswordResetHandler) StaffForgot(w http.ResponseWriter, r *http.Request) {
	var req forgotReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		writeErr(w, http.StatusBadRequest, "email required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var userID, fullName, locale string
	err := h.DB.QueryRow(ctx, `
		SELECT id, full_name, locale FROM users
		 WHERE email = $1 AND is_active = TRUE`, email).Scan(&userID, &fullName, &locale)
	if err == nil {
		if err := h.stashResetToken(ctx, r, "user", userID, email, fullName, locale); err != nil {
			log.Printf("forgot-password (staff): %v", err)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		// Log the error but still return generic success to prevent enumeration.
		log.Printf("forgot-password (staff) lookup: %v", err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /api/auth/reset-password
func (h *PasswordResetHandler) StaffReset(w http.ResponseWriter, r *http.Request) {
	var req resetReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validatePassword(req.NewPassword); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tokenHash := sha256Hex(req.Token)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	var userID string
	err = tx.QueryRow(ctx, `
		SELECT user_id FROM password_resets
		 WHERE token_hash = $1
		   AND user_id IS NOT NULL
		   AND used_at IS NULL
		   AND expires_at > NOW()
		 FOR UPDATE`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusBadRequest, "invalid or expired token")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
		userID, string(hash)); err != nil {
		writeErr(w, http.StatusInternalServerError, "user update error")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1`,
		tokenHash); err != nil {
		writeErr(w, http.StatusInternalServerError, "mark-used error")
		return
	}
	// Revoke any active refresh tokens — a password reset should invalidate
	// every open session, otherwise the attacker who triggered it keeps in.
	_, _ = tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		  WHERE user_id = $1 AND revoked_at IS NULL`, userID)

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Customer forgot / reset ────────────────────────────────────────────

// POST /api/auth/customer/forgot-password
func (h *PasswordResetHandler) CustomerForgot(w http.ResponseWriter, r *http.Request) {
	var req forgotReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		writeErr(w, http.StatusBadRequest, "email required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var contactID, fullName, locale string
	err := h.DB.QueryRow(ctx, `
		SELECT id, full_name, COALESCE(locale, 'en') FROM customer_contacts
		 WHERE email = $1 AND disabled_at IS NULL`, email).Scan(&contactID, &fullName, &locale)
	if err == nil {
		if err := h.stashResetToken(ctx, r, "contact", contactID, email, fullName, locale); err != nil {
			log.Printf("forgot-password (customer): %v", err)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("forgot-password (customer) lookup: %v", err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// POST /api/auth/customer/reset-password
func (h *PasswordResetHandler) CustomerReset(w http.ResponseWriter, r *http.Request) {
	var req resetReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validatePassword(req.NewPassword); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	tokenHash := sha256Hex(req.Token)
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	var contactID string
	err = tx.QueryRow(ctx, `
		SELECT contact_id FROM password_resets
		 WHERE token_hash = $1
		   AND contact_id IS NOT NULL
		   AND used_at IS NULL
		   AND expires_at > NOW()
		 FOR UPDATE`, tokenHash).Scan(&contactID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusBadRequest, "invalid or expired token")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE customer_contacts SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
		contactID, string(hash)); err != nil {
		writeErr(w, http.StatusInternalServerError, "contact update error")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1`,
		tokenHash); err != nil {
		writeErr(w, http.StatusInternalServerError, "mark-used error")
		return
	}
	_, _ = tx.Exec(ctx,
		`UPDATE customer_refresh_tokens SET revoked_at = NOW()
		  WHERE contact_id = $1 AND revoked_at IS NULL`, contactID)

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── shared helpers ─────────────────────────────────────────────────────

// stashResetToken inserts a fresh reset row and fires the email in a
// goroutine. kind ∈ {"user","contact"} — decides which FK column to
// populate and which email template to send.
func (h *PasswordResetHandler) stashResetToken(
	ctx context.Context, r *http.Request,
	kind, identityID, email, fullName, locale string,
) error {
	raw, tokenHash, err := mintToken()
	if err != nil {
		return err
	}
	expiresAt := time.Now().Add(resetTTL)
	ip := strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]
	ip = strings.TrimSpace(ip)
	if ip == "" {
		ip = r.RemoteAddr
	}
	ua := r.Header.Get("User-Agent")

	var col string
	switch kind {
	case "user":
		col = "user_id"
	case "contact":
		col = "contact_id"
	default:
		return errors.New("unknown identity kind")
	}
	q := `INSERT INTO password_resets (` + col + `, token_hash, expires_at, ip_address, user_agent)
	      VALUES ($1, $2, $3, NULLIF($4,'')::inet, $5)`
	if _, err := h.DB.Exec(ctx, q, identityID, tokenHash, expiresAt, ip, ua); err != nil {
		return err
	}

	// Fire the email. Fire-and-forget with logging on failure so a
	// notification-api outage doesn't reveal (via response time) that the
	// email lookup did or didn't match.
	go h.dispatchResetEmail(kind, email, fullName, locale, raw)
	return nil
}

func (h *PasswordResetHandler) dispatchResetEmail(kind, email, fullName, locale, rawToken string) {
	var template, path string
	switch kind {
	case "user":
		template = "password_reset_staff"
		path = "/admin/login/reset/" + rawToken
	case "contact":
		template = "password_reset_customer"
		path = "/portal/login/reset/" + rawToken
	default:
		return
	}
	resetURL := h.Cfg.SiteURL + path
	body, err := json.Marshal(map[string]any{
		"channel":    "email",
		"template":   template,
		"to_address": email,
		"payload": map[string]any{
			"email":       email,
			"full_name":   fullName,
			"reset_url":   resetURL,
			"ttl_minutes": int(resetTTL.Minutes()),
		},
		"locale": locale,
	})
	if err != nil {
		log.Printf("reset-email marshal: %v", err)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(
		h.Cfg.NotificationAPIURL+"/api/notifications/",
		"application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("reset-email post: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("reset-email: notification-api returned %d", resp.StatusCode)
	}
}

func validatePassword(p string) error {
	if len(p) < minPasswordChars {
		return errors.New("password must be at least 10 characters")
	}
	if len(p) > 200 {
		return errors.New("password too long")
	}
	// Minimum: at least one letter and one digit — light-touch, matches
	// how existing user creation validates in users.go.
	hasLetter, hasDigit := false, false
	for _, c := range p {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
			hasLetter = true
		}
		if c >= '0' && c <= '9' {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return errors.New("password must include letters and digits")
	}
	return nil
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
