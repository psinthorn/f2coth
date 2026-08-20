package handlers

// Staff (users) MFA — mirrors the customer flow against the users table.
// setup/enable/disable run under RequireJWT (CtxUserID); verify is public and
// authenticates via the mfa_pending token from staff login.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/f2cothai/f2-website/services/auth-api/internal/mfa"
	authmw "github.com/f2cothai/f2-website/services/auth-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/auth-api/internal/models"
)

// POST /api/auth/mfa/setup
func (h *AuthHandler) MFASetup(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(authmw.CtxUserID).(string)
	if uid == "" {
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
		`UPDATE users SET mfa_secret = $2 WHERE id = $1 RETURNING email`, uid, enc).Scan(&email); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":      secret,
		"otpauth_uri": mfa.OTPAuthURI("F2 Admin", email, secret),
	})
}

// POST /api/auth/mfa/enable
func (h *AuthHandler) MFAEnable(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(authmw.CtxUserID).(string)
	if uid == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req mfaCodeReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	var enc string
	if err := h.DB.QueryRow(r.Context(),
		`SELECT COALESCE(mfa_secret,'') FROM users WHERE id = $1`, uid).Scan(&enc); err != nil {
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
		`UPDATE users SET mfa_enabled = TRUE, mfa_enrolled_at = NOW() WHERE id = $1`, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM mfa_recovery_codes WHERE user_id = $1`, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	for _, hsh := range hashes {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, uid, hsh); err != nil {
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

// POST /api/auth/mfa/disable
func (h *AuthHandler) MFADisable(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(authmw.CtxUserID).(string)
	if uid == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req mfaCodeReq
	_ = json.NewDecoder(r.Body).Decode(&req)

	var enc string
	var enabled bool
	if err := h.DB.QueryRow(r.Context(),
		`SELECT COALESCE(mfa_secret,''), mfa_enabled FROM users WHERE id = $1`, uid).Scan(&enc, &enabled); err != nil {
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
		`UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_enrolled_at = NULL WHERE id = $1`, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	_, _ = h.DB.Exec(r.Context(), `DELETE FROM mfa_recovery_codes WHERE user_id = $1`, uid)
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/auth/mfa/verify — staff second factor → full session.
func (h *AuthHandler) MFAVerify(w http.ResponseWriter, r *http.Request) {
	var req mfaVerifyReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	sub, err := parseMFAPending(h.Cfg, req.MFAToken, "mfa_staff")
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid or expired session")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var u models.User
	var enc string
	err = h.DB.QueryRow(ctx, `
        SELECT id, email, password_hash, full_name, role, locale, is_active, last_login_at, created_at, updated_at, mfa_enabled, COALESCE(mfa_secret,'')
        FROM users WHERE id = $1 AND is_active = TRUE
    `, sub).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role, &u.Locale,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt, &u.MFAEnabled, &enc)
	if errors.Is(err, pgx.ErrNoRows) || !u.MFAEnabled {
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
			`UPDATE mfa_recovery_codes SET used_at = NOW() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
			u.ID, mfa.HashRecovery(rc))
		ok = e == nil && tag.RowsAffected() == 1
	}
	if !ok {
		writeErr(w, http.StatusUnauthorized, "invalid code")
		return
	}

	h.issueStaffSession(w, r, ctx, u, nil)
}
