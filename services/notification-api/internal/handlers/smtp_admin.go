package handlers

// SMTP settings — admin-editable via the DB, with env-var fallback so
// dev machines can still work without touching Postgres.
//
// Flow at delivery time:
//   1. `resolveSMTP(ctx)` reads the singleton row from `smtp_settings`.
//   2. If `host` is blank, fall back to the values baked into `h.Cfg`
//      (which came from env vars at startup — matches historical behaviour).
//   3. Otherwise the DB row wins for every field.
//
// Admin endpoints (JWT + role=admin, gated inline — notification-api
// doesn't have its own middleware package yet):
//   GET  /api/notifications/admin/smtp        — current row (password redacted)
//   PUT  /api/notifications/admin/smtp        — write new values
//   POST /api/notifications/admin/smtp/test   — send one email to the caller
//
// The test endpoint uses whatever's currently in the DB row (or env
// fallback) — it does NOT test against a to-be-saved payload. Save first,
// test second. Keeping this simple prevents "test looked good, then I
// forgot to save" surprises.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/smtp"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type smtpSettings struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	TLSMode     string `json:"tls_mode"`
}

// resolveSMTP returns the effective settings for one delivery attempt.
// Reads the singleton DB row (password decrypted via pgcrypto) and falls
// back to env vars per field so a partially-filled row still works.
//
// When SMTP_CRYPT_KEY is empty we decrypt with an empty key, which
// pgp_sym_decrypt handles by returning NULL — the caller then falls
// back to the env-var password. That lets dev machines without a key
// keep working with the .env-configured SMTP.
func (h *NotificationHandler) resolveSMTP(ctx context.Context) smtpSettings {
	s := smtpSettings{
		Host: h.Cfg.SMTPHost, Port: h.Cfg.SMTPPort,
		Username: h.Cfg.SMTPUser, Password: h.Cfg.SMTPPassword,
		FromAddress: h.Cfg.SMTPFrom, TLSMode: "starttls",
	}
	var (
		dbHost, dbUser, dbFrom, dbTLS string
		dbPass                        *string // nullable — pgp_sym_decrypt returns NULL on empty key
		dbPort                        int
	)
	err := h.DB.QueryRow(ctx, `
		SELECT host, port, username,
		       CASE WHEN password_enc IS NULL OR $1 = '' THEN NULL
		            ELSE pgp_sym_decrypt(password_enc, $1)
		       END AS password,
		       from_address, tls_mode
		  FROM smtp_settings WHERE id = 1
	`, h.Cfg.SMTPCryptKey).Scan(&dbHost, &dbPort, &dbUser, &dbPass, &dbFrom, &dbTLS)
	if err != nil {
		return s
	}
	if dbHost != "" {
		s.Host = dbHost
	}
	if dbPort > 0 {
		s.Port = dbPort
	}
	if dbUser != "" {
		s.Username = dbUser
	}
	if dbPass != nil && *dbPass != "" {
		s.Password = *dbPass
	}
	if dbFrom != "" {
		s.FromAddress = dbFrom
	}
	if dbTLS != "" {
		s.TLSMode = dbTLS
	}
	return s
}

// ── HTTP handlers ─────────────────────────────────────────────────────

// GET /api/notifications/admin/smtp
func (h *NotificationHandler) GetSMTP(w http.ResponseWriter, r *http.Request) {
	s := h.resolveSMTP(r.Context())
	// Redact the password so it doesn't leak on any client that inspects
	// the response. UI shows "leave blank to keep current".
	if s.Password != "" {
		s.Password = "••••••••"
	}
	writeJSON(w, http.StatusOK, s)
}

type smtpUpdateReq struct {
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	FromAddress string `json:"from_address"`
	TLSMode     string `json:"tls_mode"`
}

// PUT /api/notifications/admin/smtp
func (h *NotificationHandler) PutSMTP(w http.ResponseWriter, r *http.Request) {
	var req smtpUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Port <= 0 || req.Port > 65535 {
		writeErr(w, http.StatusBadRequest, "port out of range")
		return
	}
	switch req.TLSMode {
	case "", "none", "starttls", "tls":
		// ok
	default:
		writeErr(w, http.StatusBadRequest, "tls_mode must be one of none|starttls|tls")
		return
	}
	// Empty or redacted password = keep current stored password.
	// A real new password is encrypted with pgp_sym_encrypt using the
	// server-side crypt key. Refuse to write when the key isn't set —
	// silently storing plaintext would defeat the point.
	if req.Password == "" || req.Password == "••••••••" {
		_, err := h.DB.Exec(r.Context(), `
			UPDATE smtp_settings SET
			  host = $1, port = $2, username = $3,
			  from_address = $4, tls_mode = COALESCE(NULLIF($5,''), tls_mode),
			  updated_by = $6
			WHERE id = 1`,
			req.Host, req.Port, req.Username, req.FromAddress, req.TLSMode, staffID(r))
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
			return
		}
	} else {
		if h.Cfg.SMTPCryptKey == "" {
			writeErr(w, http.StatusServiceUnavailable, "SMTP_CRYPT_KEY not set — cannot store password securely")
			return
		}
		_, err := h.DB.Exec(r.Context(), `
			UPDATE smtp_settings SET
			  host = $1, port = $2, username = $3,
			  password_enc = pgp_sym_encrypt($4, $8),
			  from_address = $5, tls_mode = COALESCE(NULLIF($6,''), tls_mode),
			  updated_by = $7
			WHERE id = 1`,
			req.Host, req.Port, req.Username, req.Password,
			req.FromAddress, req.TLSMode, staffID(r), h.Cfg.SMTPCryptKey)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db error: "+err.Error())
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

type smtpTestReq struct {
	To string `json:"to"`
}

// POST /api/notifications/admin/smtp/test
func (h *NotificationHandler) TestSMTP(w http.ResponseWriter, r *http.Request) {
	var req smtpTestReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	to := strings.TrimSpace(req.To)
	if to == "" || !strings.Contains(to, "@") {
		writeErr(w, http.StatusBadRequest, "valid to_address required")
		return
	}
	s := h.resolveSMTP(r.Context())
	if s.Host == "" {
		writeErr(w, http.StatusBadRequest, "SMTP host not configured")
		return
	}

	subject := "F2 SMTP test"
	body := "This is a test email from the F2 admin SMTP settings page.\n\nIf you received this, your SMTP configuration is working.\n"
	msg := buildEmail(s.FromAddress, to, subject, body, nil)
	addr := fmt.Sprintf("%s:%d", s.Host, s.Port)
	var auth smtp.Auth
	if s.Username != "" {
		auth = smtp.PlainAuth("", s.Username, s.Password, s.Host)
	}
	if err := smtp.SendMail(addr, auth, s.FromAddress, []string{to}, msg); err != nil {
		writeErr(w, http.StatusBadGateway, "SMTP send failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "to": to})
}

// ── Middleware (inline — no separate package yet) ─────────────────────

type ctxKey string

const ctxStaffID ctxKey = "notif.staff_id"

// RequireAdmin is a chi middleware that validates a Bearer JWT and only
// admits role=admin. Matches the pattern in checklist-api's middleware.
func RequireAdmin(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" {
				writeErr(w, http.StatusServiceUnavailable, "auth not configured")
				return
			}
			bearer := r.Header.Get("Authorization")
			if !strings.HasPrefix(bearer, "Bearer ") {
				writeErr(w, http.StatusUnauthorized, "missing bearer token")
				return
			}
			claims := jwt.MapClaims{}
			tok, err := jwt.ParseWithClaims(strings.TrimPrefix(bearer, "Bearer "), claims,
				func(t *jwt.Token) (any, error) {
					if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
						return nil, errors.New("bad signing method")
					}
					return []byte(secret), nil
				})
			if err != nil || !tok.Valid {
				writeErr(w, http.StatusUnauthorized, "invalid token")
				return
			}
			if role, _ := claims["role"].(string); role != "admin" {
				writeErr(w, http.StatusForbidden, "admin required")
				return
			}
			if sub, ok := claims["sub"].(string); ok {
				r = r.WithContext(withStaffID(r.Context(), sub))
			}
			next.ServeHTTP(w, r)
		})
	}
}

func withStaffID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxStaffID, id)
}

// staffID returns the JWT subject (users.id) if set, else nil so pgx
// writes NULL into audit columns.
func staffID(r *http.Request) any {
	if v, ok := r.Context().Value(ctxStaffID).(string); ok && v != "" {
		return v
	}
	return nil
}
