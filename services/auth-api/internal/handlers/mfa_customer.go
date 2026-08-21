package handlers

// Portal-user (customer) MFA: TOTP enrolment, the login second-step, and
// recovery codes. Enrolment/disable authenticate via the caller's normal
// customer Bearer token (parsed internally); verify authenticates via the
// short-lived mfa_pending token that password login hands back.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
	"github.com/f2cothai/f2-website/services/auth-api/internal/mfa"
)

const mfaPendingTTL = 5 * time.Minute
const recoveryCodeCount = 10

// signMFAPending mints a short-lived token whose only power is to complete the
// second factor. aud is "mfa_customer" or "mfa_staff". Shared by both audiences.
func signMFAPending(cfg config.Config, aud, sub string) (string, error) {
	now := time.Now()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss": cfg.JWTIssuer, "aud": aud, "sub": sub, "mfa_pending": true,
		"iat": now.Unix(), "exp": now.Add(mfaPendingTTL).Unix(),
	})
	return tok.SignedString([]byte(cfg.JWTSecret))
}

// parseMFAPending validates a pending token and returns its subject.
func parseMFAPending(cfg config.Config, tokenStr, wantAud string) (string, error) {
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrTokenSignatureInvalid
		}
		return []byte(cfg.JWTSecret), nil
	})
	if err != nil || !tok.Valid {
		return "", errors.New("invalid token")
	}
	if aud, _ := claims["aud"].(string); aud != wantAud {
		return "", errors.New("wrong audience")
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return "", errors.New("no subject")
	}
	return sub, nil
}

// POST /api/auth/customer/mfa/setup — generate a provisional secret + QR URI.
func (h *CustomerAuthHandler) MFASetup(w http.ResponseWriter, r *http.Request) {
	contactID, err := h.contactFromBearer(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	secret, err := mfa.GenerateSecret()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "secret error")
		return
	}
	enc, err := mfa.Encrypt(h.Cfg.MFAEncKey, secret)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "encrypt error")
		return
	}
	var email string
	if err := h.DB.QueryRow(r.Context(),
		`UPDATE customer_contacts SET mfa_secret = $2 WHERE id = $1 RETURNING email`,
		contactID, enc).Scan(&email); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":      secret,
		"otpauth_uri": mfa.OTPAuthURI("F2 Portal", email, secret),
	})
}

type mfaCodeReq struct {
	Code string `json:"code"`
}

// POST /api/auth/customer/mfa/enable — confirm a code, activate MFA, return
// one-time recovery codes.
func (h *CustomerAuthHandler) MFAEnable(w http.ResponseWriter, r *http.Request) {
	contactID, err := h.contactFromBearer(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req mfaCodeReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	var enc string
	if err := h.DB.QueryRow(r.Context(),
		`SELECT COALESCE(mfa_secret,'') FROM customer_contacts WHERE id = $1`, contactID).Scan(&enc); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if enc == "" {
		writeErr(w, http.StatusBadRequest, "run setup first")
		return
	}
	secret, err := mfa.Decrypt(h.Cfg.MFAEncKey, enc)
	if err != nil || !mfa.Validate(secret, req.Code) {
		writeErr(w, http.StatusBadRequest, "invalid code")
		return
	}

	plain, hashes, err := mfa.GenerateRecoveryCodes(recoveryCodeCount)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "recovery gen error")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(),
		`UPDATE customer_contacts SET mfa_enabled = TRUE, mfa_enrolled_at = NOW() WHERE id = $1`, contactID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM mfa_recovery_codes WHERE contact_id = $1`, contactID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	for _, hsh := range hashes {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO mfa_recovery_codes (contact_id, code_hash) VALUES ($1, $2)`, contactID, hsh); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"recovery_codes": plain})
}

// POST /api/auth/customer/mfa/disable — turn MFA off (requires a current code).
func (h *CustomerAuthHandler) MFADisable(w http.ResponseWriter, r *http.Request) {
	contactID, err := h.contactFromBearer(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req mfaCodeReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	var enc string
	var enabled bool
	if err := h.DB.QueryRow(r.Context(),
		`SELECT COALESCE(mfa_secret,''), mfa_enabled FROM customer_contacts WHERE id = $1`,
		contactID).Scan(&enc, &enabled); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if enabled {
		secret, err := mfa.Decrypt(h.Cfg.MFAEncKey, enc)
		if err != nil || !mfa.Validate(secret, req.Code) {
			writeErr(w, http.StatusBadRequest, "invalid code")
			return
		}
	}
	if _, err := h.DB.Exec(r.Context(),
		`UPDATE customer_contacts SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL WHERE id = $1`,
		contactID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	_, _ = h.DB.Exec(r.Context(), `DELETE FROM mfa_recovery_codes WHERE contact_id = $1`, contactID)
	w.WriteHeader(http.StatusNoContent)
}

type mfaVerifyReq struct {
	MFAToken     string `json:"mfa_token"`
	Code         string `json:"code"`
	RecoveryCode string `json:"recovery_code"`
}

// POST /api/auth/customer/mfa/verify — second factor → full session.
func (h *CustomerAuthHandler) MFAVerify(w http.ResponseWriter, r *http.Request) {
	var req mfaVerifyReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	sub, err := parseMFAPending(h.Cfg, req.MFAToken, "mfa_customer")
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid or expired session")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var c customerContact
	var enc string
	err = h.DB.QueryRow(ctx, `
        SELECT id, customer_id, email, password_hash, full_name, role, locale,
               must_change_password, (email_verified_at IS NOT NULL), mfa_enabled, COALESCE(mfa_secret,'')
        FROM customer_contacts WHERE id = $1 AND disabled_at IS NULL
    `, sub).Scan(&c.ID, &c.CustomerID, &c.Email, &c.PasswordHash, &c.FullName, &c.Role, &c.Locale,
		&c.MustChangePassword, &c.EmailVerified, &c.MFAEnabled, &enc)
	if errors.Is(err, pgx.ErrNoRows) || !c.MFAEnabled {
		writeErr(w, http.StatusUnauthorized, "invalid session")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	ok := false
	if code := strings.TrimSpace(req.Code); code != "" {
		if secret, e := mfa.Decrypt(h.Cfg.MFAEncKey, enc); e == nil {
			ok = mfa.Validate(secret, code)
		}
	} else if rc := strings.TrimSpace(req.RecoveryCode); rc != "" {
		tag, e := h.DB.Exec(ctx,
			`UPDATE mfa_recovery_codes SET used_at = NOW() WHERE contact_id = $1 AND code_hash = $2 AND used_at IS NULL`,
			c.ID, mfa.HashRecovery(rc))
		ok = e == nil && tag.RowsAffected() == 1
	}
	if !ok {
		writeErr(w, http.StatusUnauthorized, "invalid code")
		return
	}

	h.issueCustomerSession(w, r, ctx, c)
}
