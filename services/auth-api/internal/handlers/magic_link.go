package handlers

// Passwordless "magic link" sign-in for portal users. Request is enumeration-
// safe (always 200); verify redeems a single-use token and issues a session,
// still honouring MFA for enrolled accounts.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const magicTTL = 15 * time.Minute

type magicRequestReq struct {
	Email string `json:"email"`
}

// POST /api/auth/customer/magic-link/request
func (h *CustomerAuthHandler) MagicLinkRequest(w http.ResponseWriter, r *http.Request) {
	var req magicRequestReq
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req)
	email := strings.ToLower(strings.TrimSpace(req.Email))

	// Always return 200 — never reveal whether the email exists / is active.
	respondOK := func() { writeJSON(w, http.StatusOK, map[string]string{"status": "ok"}) }
	if email == "" {
		respondOK()
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Only a contact with at least one active (non-pending) org gets a link.
	var contactID, fullName, locale string
	err := h.DB.QueryRow(ctx, `
		SELECT cc.id, cc.full_name, COALESCE(cc.locale,'en')
		  FROM customer_contacts cc
		 WHERE cc.email = $1 AND cc.disabled_at IS NULL
		   AND EXISTS (SELECT 1 FROM contact_org_memberships m
		               JOIN customers c ON c.id = m.customer_id
		              WHERE m.contact_id = cc.id AND m.disabled_at IS NULL
		                AND c.is_active = TRUE AND c.status <> 'pending')`,
		email).Scan(&contactID, &fullName, &locale)
	if errors.Is(err, pgx.ErrNoRows) {
		respondOK()
		return
	}
	if err != nil {
		respondOK() // don't leak DB errors via timing/status either
		return
	}

	raw := randHex(32)
	if _, err := h.DB.Exec(ctx, `
		INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
		VALUES ($1, $2, NOW() + $3::interval, 'magic')`,
		contactID, sha256Hex(raw), magicTTL.String()); err != nil {
		respondOK()
		return
	}
	go h.dispatchMagicEmail(email, fullName, locale, raw)
	respondOK()
}

func (h *CustomerAuthHandler) dispatchMagicEmail(email, fullName, locale, rawToken string) {
	body, err := json.Marshal(map[string]any{
		"channel":    "email",
		"template":   "magic_link_customer",
		"to_address": email,
		"payload": map[string]any{
			"email":       email,
			"full_name":   fullName,
			"login_url":   h.Cfg.SiteURL + "/portal/magic/" + rawToken,
			"ttl_minutes": int(magicTTL.Minutes()),
		},
		"locale": locale,
	})
	if err != nil {
		log.Printf("magic-email marshal: %v", err)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(h.Cfg.NotificationAPIURL+"/api/notifications/", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("magic-email post: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("magic-email: notification-api returned %d", resp.StatusCode)
	}
}

type magicVerifyReq struct {
	Token string `json:"token"`
}

// POST /api/auth/customer/magic-link/verify — redeem the link → session.
func (h *CustomerAuthHandler) MagicLinkVerify(w http.ResponseWriter, r *http.Request) {
	var req magicVerifyReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil || strings.TrimSpace(req.Token) == "" {
		writeErr(w, http.StatusBadRequest, "token required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Consume the token atomically (single-use).
	var contactID string
	err := h.DB.QueryRow(ctx, `
		UPDATE password_resets SET used_at = NOW()
		 WHERE token_hash = $1 AND purpose = 'magic' AND used_at IS NULL AND expires_at > NOW()
		 RETURNING contact_id`, sha256Hex(req.Token)).Scan(&contactID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusBadRequest, "invalid or expired link")
		return
	}
	if err != nil || contactID == "" {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	var c customerContact
	if err := h.DB.QueryRow(ctx, `
        SELECT id, customer_id, email, password_hash, full_name, role, locale,
               must_change_password, (email_verified_at IS NOT NULL), mfa_enabled
        FROM customer_contacts WHERE id = $1 AND disabled_at IS NULL
    `, contactID).Scan(&c.ID, &c.CustomerID, &c.Email, &c.PasswordHash, &c.FullName, &c.Role, &c.Locale,
		&c.MustChangePassword, &c.EmailVerified, &c.MFAEnabled); err != nil {
		writeErr(w, http.StatusUnauthorized, "account unavailable")
		return
	}

	// MFA still applies — a magic link proves email, not the second factor.
	if c.MFAEnabled {
		pending, err := signMFAPending(h.Cfg, "mfa_customer", c.ID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "token sign failed")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"mfa_required": true, "mfa_token": pending})
		return
	}
	h.issueCustomerSession(w, r, ctx, c)
}
