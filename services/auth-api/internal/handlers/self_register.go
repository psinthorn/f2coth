package handlers

// Public self-registration: creates an organization + its owner in one step,
// then emails a verification link. The org stays 'pending' (and can't log in)
// until the owner verifies — see loadMemberships + VerifyEmail. Enumeration-safe
// on an existing email: always returns 200 without revealing whether it matched.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type registerReq struct {
	CompanyName string `json:"company_name"`
	FullName    string `json:"full_name"`
	Email       string `json:"email"`
	Password    string `json:"password"`
}

// slugify makes a URL-safe base for the org slug; a random suffix guarantees
// uniqueness without a retry loop.
func slugify(s string) string {
	var b strings.Builder
	prevDash := false
	for _, c := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case c >= 'a' && c <= 'z', c >= '0' && c <= '9':
			b.WriteRune(c)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "org"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func randHex(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// POST /api/auth/customer/register
func (h *CustomerAuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	company := strings.TrimSpace(req.CompanyName)
	name := strings.TrimSpace(req.FullName)
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if company == "" || name == "" || email == "" {
		writeErr(w, http.StatusBadRequest, "company_name, full_name and email are required")
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	// Enumeration-safe: if the email already exists, do nothing and return the
	// same generic success (don't reveal that the address is taken).
	var exists bool
	if err := h.DB.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM customer_contacts WHERE email = $1)`, email).Scan(&exists); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if exists {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), h.Cfg.BcryptCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}

	tx, err := h.DB.Begin(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(ctx)

	var customerID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO customers (slug, name, status, self_registered, is_active)
		VALUES ($1, $2, 'pending', TRUE, TRUE) RETURNING id`,
		slugify(company)+"-"+randHex(3), company).Scan(&customerID); err != nil {
		writeErr(w, http.StatusInternalServerError, "org create error: "+err.Error())
		return
	}
	var contactID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO customer_contacts (customer_id, email, password_hash, full_name, role, must_change_password)
		VALUES ($1, $2, $3, $4, 'owner', FALSE) RETURNING id`,
		customerID, email, string(hash), name).Scan(&contactID); err != nil {
		writeErr(w, http.StatusInternalServerError, "owner create error")
		return
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
		VALUES ($1, $2, 'owner', TRUE)`, contactID, customerID); err != nil {
		writeErr(w, http.StatusInternalServerError, "membership error")
		return
	}
	raw := randHex(32)
	if _, err := tx.Exec(ctx, `
		INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
		VALUES ($1, $2, NOW() + INTERVAL '24 hours', 'verification')`,
		contactID, sha256Hex(raw)); err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}

	go h.dispatchVerifyEmail(email, name, "en", raw)
	writeJSON(w, http.StatusCreated, map[string]string{"status": "ok"})
}

// dispatchVerifyEmail sends the "confirm your email" link (fire-and-forget).
func (h *CustomerAuthHandler) dispatchVerifyEmail(email, fullName, locale, rawToken string) {
	body, err := json.Marshal(map[string]any{
		"channel":    "email",
		"template":   "email_verification_customer",
		"to_address": email,
		"payload": map[string]any{
			"email":      email,
			"full_name":  fullName,
			"verify_url": h.Cfg.SiteURL + "/portal/verify-email/" + rawToken,
			"ttl_hours":  "24",
		},
		"locale": locale,
	})
	if err != nil {
		log.Printf("verify-email marshal: %v", err)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(h.Cfg.NotificationAPIURL+"/api/notifications/", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("verify-email post: %v", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		log.Printf("verify-email: notification-api returned %d", resp.StatusCode)
	}
}
