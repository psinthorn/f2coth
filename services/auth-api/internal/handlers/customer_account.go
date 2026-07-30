package handlers

// Customer (portal) account lifecycle — email verification, self-service link
// requests, in-session password change, and active-org switching for
// multi-org users (migration 071).
//
// Verification tokens live in the shared password_resets table with
// purpose='verification' (see 071). They follow the same hashed, single-use,
// TTL design as password resets.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

const verificationTTL = 24 * time.Hour

// postNotification fires a best-effort notification job. Shared by the
// verification/reset dispatchers.
func postNotification(notifyURL string, job map[string]any) {
	body, err := json.Marshal(job)
	if err != nil {
		log.Printf("notify marshal: %v", err)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(notifyURL+"/api/notifications/", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("notify post: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("notify: notification-api returned %d", resp.StatusCode)
	}
}

// contactFromBearer re-parses the Bearer token (auth-api doesn't import the
// customer-api middleware) and returns the contact id, asserting the customer
// audience. Mirrors CustomerAuthHandler.SetLocale.
func (h *CustomerAuthHandler) contactFromBearer(r *http.Request) (string, error) {
	authz := r.Header.Get("Authorization")
	if !strings.HasPrefix(authz, "Bearer ") {
		return "", errors.New("missing bearer token")
	}
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(strings.TrimPrefix(authz, "Bearer "), claims, func(t *jwt.Token) (any, error) {
		return []byte(h.Cfg.JWTSecret), nil
	})
	if err != nil || !tok.Valid {
		return "", errors.New("invalid token")
	}
	if aud, _ := claims["aud"].(string); aud != "customer" {
		return "", errors.New("wrong audience")
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", errors.New("no subject")
	}
	return sub, nil
}

// ── Email verification ─────────────────────────────────────────────────

type verifyReq struct {
	Token string `json:"token"`
}

// VerifyEmail redeems a verification token and stamps email_verified_at.
// POST /api/auth/customer/verify-email
func (h *CustomerAuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	var req verifyReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if strings.TrimSpace(req.Token) == "" {
		writeErr(w, http.StatusBadRequest, "token required")
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
		   AND purpose = 'verification'
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

	if _, err := tx.Exec(ctx, `
		UPDATE customer_contacts
		   SET email_verified_at = COALESCE(email_verified_at, NOW()),
		       activated_at      = COALESCE(activated_at, NOW()),
		       updated_at        = NOW()
		 WHERE id = $1`, contactID); err != nil {
		writeErr(w, http.StatusInternalServerError, "verify update error")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE password_resets SET used_at = NOW() WHERE token_hash = $1`, tokenHash); err != nil {
		writeErr(w, http.StatusInternalServerError, "mark-used error")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Self-service link request ──────────────────────────────────────────

type requestLinkReq struct {
	Email   string `json:"email"`
	Purpose string `json:"purpose"` // "verification" (default) | "reset"
}

// RequestLink lets a user re-request a verification (or reset) link if they
// lost the original. Enumeration-safe: always 200.
// POST /api/auth/customer/request-link
func (h *CustomerAuthHandler) RequestLink(w http.ResponseWriter, r *http.Request) {
	var req requestLinkReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		writeErr(w, http.StatusBadRequest, "email required")
		return
	}
	purpose := req.Purpose
	if purpose == "" {
		purpose = "verification"
	}
	if purpose != "verification" {
		// Password resets go through the existing /customer/forgot-password.
		writeErr(w, http.StatusBadRequest, "unsupported purpose")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var (
		contactID, fullName, locale string
		verified                    *time.Time
	)
	err := h.DB.QueryRow(ctx, `
		SELECT id, full_name, COALESCE(locale,'en'), email_verified_at
		FROM customer_contacts
		WHERE email = $1 AND disabled_at IS NULL`, email).
		Scan(&contactID, &fullName, &locale, &verified)
	// Only send if the account exists and isn't already verified. Either way
	// return the same generic 200.
	if err == nil && verified == nil {
		if e := h.stashVerificationToken(ctx, contactID, email, fullName, locale); e != nil {
			// swallow — never reveal via error
			_ = e
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// stashVerificationToken inserts a verification row and fires the email.
func (h *CustomerAuthHandler) stashVerificationToken(ctx context.Context, contactID, email, fullName, locale string) error {
	raw, tokenHash, err := mintToken()
	if err != nil {
		return err
	}
	if _, err := h.DB.Exec(ctx, `
		INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
		VALUES ($1, $2, $3, 'verification')`,
		contactID, tokenHash, time.Now().Add(verificationTTL)); err != nil {
		return err
	}
	go h.dispatchVerificationEmail(email, fullName, locale, raw)
	return nil
}

func (h *CustomerAuthHandler) dispatchVerificationEmail(email, fullName, locale, rawToken string) {
	verifyURL := h.Cfg.SiteURL + "/portal/verify-email/" + rawToken
	postNotification(h.Cfg.NotificationAPIURL, map[string]any{
		"channel":    "email",
		"template":   "email_verification_customer",
		"to_address": email,
		"payload": map[string]any{
			"email":      email,
			"full_name":  fullName,
			"verify_url": verifyURL,
			"ttl_hours":  int(verificationTTL.Hours()),
		},
		"locale": locale,
	})
}

// ── In-session password change ─────────────────────────────────────────

type changePasswordReq struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

// ChangePassword updates the caller's password after verifying the current
// one, and clears must_change_password. Requires a valid customer Bearer token.
// POST /api/auth/customer/change-password
func (h *CustomerAuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	contactID, err := h.contactFromBearer(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req changePasswordReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if err := validatePassword(req.NewPassword); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var currentHash string
	if err := h.DB.QueryRow(ctx,
		`SELECT password_hash FROM customer_contacts WHERE id = $1 AND disabled_at IS NULL`,
		contactID).Scan(&currentHash); err != nil {
		writeErr(w, http.StatusUnauthorized, "account not found")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.CurrentPassword)) != nil {
		writeErr(w, http.StatusBadRequest, "current password is incorrect")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), 12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	if _, err := h.DB.Exec(ctx, `
		UPDATE customer_contacts
		   SET password_hash = $2, must_change_password = FALSE, updated_at = NOW()
		 WHERE id = $1`, contactID, string(newHash)); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	// Revoke every refresh token for this contact. A password change must evict
	// all existing sessions — critical for the temp-password threat model (an
	// intercepted temp password must not survive the rotation). The client
	// re-authenticates with the new password afterwards.
	_, _ = h.DB.Exec(ctx,
		`UPDATE customer_refresh_tokens SET revoked_at = NOW()
		  WHERE contact_id = $1 AND revoked_at IS NULL`, contactID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Active-org switching (multi-org) ───────────────────────────────────

type switchOrgReq struct {
	CustomerID string `json:"customer_id"`
}

// SwitchOrg re-mints an access token scoped to another org the contact belongs
// to. Requires a valid customer Bearer token.
// POST /api/auth/customer/switch-org
func (h *CustomerAuthHandler) SwitchOrg(w http.ResponseWriter, r *http.Request) {
	contactID, err := h.contactFromBearer(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	var req switchOrgReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if strings.TrimSpace(req.CustomerID) == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var c customerContact
	var membershipRole string
	err = h.DB.QueryRow(ctx, `
		SELECT cc.id, m.customer_id, cc.email, cc.password_hash, cc.full_name, m.role, cc.locale,
		       cc.must_change_password
		FROM customer_contacts cc
		JOIN contact_org_memberships m ON m.contact_id = cc.id
		JOIN customers cust ON cust.id = m.customer_id
		WHERE cc.id = $1 AND m.customer_id = $2
		  AND cc.disabled_at IS NULL AND m.disabled_at IS NULL AND cust.is_active = TRUE
	`, contactID, req.CustomerID).Scan(&c.ID, &c.CustomerID, &c.Email, &c.PasswordHash,
		&c.FullName, &membershipRole, &c.Locale, &c.MustChangePassword)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusForbidden, "not a member of that organization")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	c.Role = membershipRole

	access, err := h.signCustomerToken(c)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token sign failed")
		return
	}
	// Bind the new active org to the caller's refresh token(s) so a later
	// transparent refresh preserves this switch instead of reverting to primary.
	if _, err := h.DB.Exec(ctx,
		`UPDATE customer_refresh_tokens SET active_customer_id = $2
		  WHERE contact_id = $1 AND revoked_at IS NULL`, c.ID, c.CustomerID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": access,
		"expires_in":   int64(h.Cfg.JWTTTL.Seconds()),
		"customer_id":  c.CustomerID,
		"role":         c.Role,
	})
}
