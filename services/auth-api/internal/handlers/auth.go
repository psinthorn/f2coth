package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
	authmw "github.com/f2cothai/f2-website/services/auth-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/auth-api/internal/models"
)

type AuthHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type tokenResp struct {
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	ExpiresIn    int64       `json:"expires_in"`
	User         models.User `json:"user"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func sha256hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "email and password required")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var u models.User
	err := h.DB.QueryRow(ctx, `
        SELECT id, email, password_hash, full_name, role, locale, is_active, last_login_at, created_at, updated_at
        FROM users WHERE email = $1 AND is_active = TRUE
    `, req.Email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role, &u.Locale,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)

	logAttempt := func(success bool, userID *string) {
		_, _ = h.DB.Exec(context.Background(), `
            INSERT INTO login_events (user_id, email_attempt, success, ip_address, user_agent)
            VALUES ($1, $2, $3, NULLIF($4,'')::inet, $5)
        `, userID, req.Email, success, r.RemoteAddr, r.UserAgent())
	}

	if errors.Is(err, pgx.ErrNoRows) {
		logAttempt(false, nil)
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)); err != nil {
		logAttempt(false, &u.ID)
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	access, err := h.signAccessToken(u)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token sign failed")
		return
	}
	refresh, refreshHash := newRefreshToken()

	_, err = h.DB.Exec(ctx, `
        INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
        VALUES ($1, $2, $3, NULLIF($4,'')::inet, $5)
    `, u.ID, refreshHash, r.UserAgent(), r.RemoteAddr, time.Now().Add(h.Cfg.RefreshTTL))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not issue refresh token")
		return
	}

	_, _ = h.DB.Exec(ctx, `UPDATE users SET last_login_at = NOW() WHERE id = $1`, u.ID)
	logAttempt(true, &u.ID)

	writeJSON(w, http.StatusOK, tokenResp{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int64(h.Cfg.JWTTTL.Seconds()),
		User:         u,
	})
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
		writeErr(w, http.StatusBadRequest, "refresh_token required")
		return
	}
	hash := sha256hex(req.RefreshToken)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	var (
		tokenID   string
		userID    string
		expiresAt time.Time
		revoked   *time.Time
	)
	err := h.DB.QueryRow(ctx, `
        SELECT id, user_id, expires_at, revoked_at
        FROM refresh_tokens WHERE token_hash = $1
    `, hash).Scan(&tokenID, &userID, &expiresAt, &revoked)
	if err != nil || revoked != nil || time.Now().After(expiresAt) {
		writeErr(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	var u models.User
	err = h.DB.QueryRow(ctx, `
        SELECT id, email, password_hash, full_name, role, locale, is_active, last_login_at, created_at, updated_at
        FROM users WHERE id = $1 AND is_active = TRUE
    `, userID).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role, &u.Locale,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "user not found")
		return
	}

	// Rotate: revoke old, issue new.
	_, _ = h.DB.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, tokenID)

	access, _ := h.signAccessToken(u)
	newRefresh, newHash := newRefreshToken()
	_, _ = h.DB.Exec(ctx, `
        INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
        VALUES ($1, $2, $3, NULLIF($4,'')::inet, $5)
    `, u.ID, newHash, r.UserAgent(), r.RemoteAddr, time.Now().Add(h.Cfg.RefreshTTL))

	writeJSON(w, http.StatusOK, tokenResp{
		AccessToken:  access,
		RefreshToken: newRefresh,
		ExpiresIn:    int64(h.Cfg.JWTTTL.Seconds()),
		User:         u,
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.RefreshToken != "" {
		hash := sha256hex(req.RefreshToken)
		_, _ = h.DB.Exec(r.Context(),
			`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
			hash)
	}
	w.WriteHeader(http.StatusNoContent)
}

// SetLocale updates the signed-in user's preferred locale.
type setLocaleReq struct {
	Locale string `json:"locale"`
}

func (h *AuthHandler) SetLocale(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(authmw.CtxUserID).(string)
	if uid == "" {
		writeErr(w, http.StatusUnauthorized, "no user")
		return
	}
	var req setLocaleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Locale != "en" && req.Locale != "th" {
		writeErr(w, http.StatusBadRequest, "locale must be en or th")
		return
	}
	if _, err := h.DB.Exec(r.Context(),
		`UPDATE users SET locale = $1 WHERE id = $2`, req.Locale, uid); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	uid, _ := r.Context().Value(authmw.CtxUserID).(string)
	if uid == "" {
		writeErr(w, http.StatusUnauthorized, "no user")
		return
	}
	var u models.User
	err := h.DB.QueryRow(r.Context(), `
        SELECT id, email, password_hash, full_name, role, locale, is_active, last_login_at, created_at, updated_at
        FROM users WHERE id = $1
    `, uid).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.FullName, &u.Role, &u.Locale,
		&u.IsActive, &u.LastLoginAt, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// ----- helpers -----

func (h *AuthHandler) signAccessToken(u models.User) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":    h.Cfg.JWTIssuer,
		"aud":    "staff",
		"sub":    u.ID,
		"email":  u.Email,
		"role":   u.Role,
		"locale": u.Locale,
		"iat":    now.Unix(),
		"exp":    now.Add(h.Cfg.JWTTTL).Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(h.Cfg.JWTSecret))
}

func newRefreshToken() (raw, hash string) {
	// 32 random bytes, hex-encoded → 64-char opaque token.
	b := make([]byte, 32)
	if _, err := cryptoRandRead(b); err != nil {
		panic(err)
	}
	raw = hex.EncodeToString(b)
	hash = sha256hex(raw)
	return
}
