package handlers

// Portal-user invite / activation helpers (migration 071).
//
// Tokens mirror the auth-api password_resets design: 32 bytes of CSPRNG
// entropy, hex-encoded; only the SHA-256 hash is stored, so a DB dump can't
// redeem them. Verification links live in the same password_resets table
// with purpose='verification'.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/customer-api/internal/notify"
)

const (
	// verifyTTLMinutes is a string so it can be interpolated straight into the
	// `($3 || ' minutes')::interval` SQL used by the invite/resend inserts.
	verifyTTLMinutes = "1440" // 24h
	// verifyTTLHours is what the customer-facing email renders ({{ttl_hours}}).
	verifyTTLHours  = "24"
	tokenBytes      = 32
	tempPasswordLen = 16
)

// genTempPassword returns a URL-safe temporary password with at least one
// letter and one digit (satisfies the auth-api password policy so the user
// can log in, then is forced to change it).
func genTempPassword() (string, error) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
	buf := make([]byte, tempPasswordLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, tempPasswordLen)
	for i, b := range buf {
		out[i] = alphabet[int(b)%len(alphabet)]
	}
	// Guarantee policy compliance (≥1 letter, ≥1 digit) regardless of draw.
	out[0] = 'F'
	out[tempPasswordLen-1] = '7'
	return string(out), nil
}

// mintContactToken returns (rawToken, sha256HexHash). Only the hash is stored.
func mintContactToken() (string, string, error) {
	buf := make([]byte, tokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	raw := hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

// sendInviteEmail dispatches login instructions (username + temp password) and
// a verification link for a newly created portal user.
func (h *AdminHandler) sendInviteEmail(email, fullName, orgName, tempPassword, rawToken, locale string) {
	if locale == "" {
		locale = "en"
	}
	loginURL := h.Cfg.PortalBaseURL + "/portal/login"
	verifyURL := h.Cfg.PortalBaseURL + "/portal/verify-email/" + rawToken
	h.Notify.Send(notify.Job{
		Channel:   "email",
		Template:  "contact_invite_customer",
		ToAddress: email,
		Payload: map[string]any{
			"full_name":     fullName,
			"email":         email,
			"org_name":      orgName,
			"temp_password": tempPassword,
			"login_url":     loginURL,
			"verify_url":    verifyURL,
			"ttl_hours":     verifyTTLHours,
		},
		Locale: locale,
	})
}

// sendVerifyEmail dispatches a standalone email-verification link (resend).
func (h *AdminHandler) sendVerifyEmail(email, fullName, rawToken, locale string) {
	if locale == "" {
		locale = "en"
	}
	verifyURL := h.Cfg.PortalBaseURL + "/portal/verify-email/" + rawToken
	h.Notify.Send(notify.Job{
		Channel:   "email",
		Template:  "email_verification_customer",
		ToAddress: email,
		Payload: map[string]any{
			"full_name":  fullName,
			"email":      email,
			"verify_url": verifyURL,
			"ttl_hours":  verifyTTLHours,
		},
		Locale: locale,
	})
}

// ResendInvite lets an admin re-send an email-verification link to a member of
// this org. Idempotent from the caller's view: always 204 if the contact is a
// member, whether or not they were already verified.
//
// POST /customer/admin/customers/{id}/contacts/{contactId}/resend
func (h *AdminHandler) ResendInvite(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")

	var (
		email, fullName, locale string
		verifiedAt              *string
	)
	err := h.DB.QueryRow(r.Context(), `
        SELECT cc.email, cc.full_name, COALESCE(cc.locale,'en'),
               cc.email_verified_at::text
        FROM customer_contacts cc
        JOIN contact_org_memberships m ON m.contact_id = cc.id
        WHERE cc.id = $1 AND m.customer_id = $2
    `, contactID, cid).Scan(&email, &fullName, &locale, &verifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "contact not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	rawToken, tokenHash, err := mintContactToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	if _, err := h.DB.Exec(r.Context(), `
        INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
        VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, 'verification')
    `, contactID, tokenHash, verifyTTLMinutes); err != nil {
		writeErr(w, http.StatusInternalServerError, "token store error")
		return
	}
	h.sendVerifyEmail(email, fullName, rawToken, locale)
	w.WriteHeader(http.StatusNoContent)
}
