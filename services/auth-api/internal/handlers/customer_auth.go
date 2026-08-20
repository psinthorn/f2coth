package handlers

import (
	"context"
	"crypto/rand"
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
)

// Customer-side authentication. Issues JWTs with `aud: "customer"` and
// embeds the parent `customer_id` so downstream services can enforce
// tenant isolation without an extra DB lookup.

type CustomerAuthHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type customerContact struct {
	ID           string
	CustomerID   string
	Email        string
	PasswordHash string
	FullName     string
	Role         string
	Locale       string

	MustChangePassword bool
	EmailVerified      bool
	MFAEnabled         bool
}

type customerLoginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type CustomerInfo struct {
	ID                 string `json:"id"`
	CustomerID         string `json:"customer_id"`
	Email              string `json:"email"`
	FullName           string `json:"full_name"`
	Role               string `json:"role"`
	Locale             string `json:"locale"`
	MustChangePassword bool   `json:"must_change_password"`
	EmailVerified      bool   `json:"email_verified"`
}

// MembershipInfo is one org the contact belongs to (multi-org, migration 071).
type MembershipInfo struct {
	CustomerID   string `json:"customer_id"`
	CustomerName string `json:"customer_name"`
	Role         string `json:"role"`
	IsPrimary    bool   `json:"is_primary"`
}

type customerTokenResp struct {
	AccessToken  string           `json:"access_token"`
	RefreshToken string           `json:"refresh_token"`
	ExpiresIn    int64            `json:"expires_in"`
	Contact      CustomerInfo     `json:"contact"`
	Memberships  []MembershipInfo `json:"memberships"`
}

// loadMemberships returns every active org the contact belongs to. The active
// org for a fresh login/refresh is the primary membership (is_primary), or the
// first row if none is marked primary.
func (h *CustomerAuthHandler) loadMemberships(ctx context.Context, contactID string) ([]MembershipInfo, error) {
	rows, err := h.DB.Query(ctx, `
		SELECT m.customer_id, c.name, m.role, m.is_primary
		FROM contact_org_memberships m
		JOIN customers c ON c.id = m.customer_id
		WHERE m.contact_id = $1 AND c.is_active = TRUE AND m.disabled_at IS NULL
		ORDER BY m.is_primary DESC, c.name`, contactID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]MembershipInfo, 0, 4)
	for rows.Next() {
		var m MembershipInfo
		if err := rows.Scan(&m.CustomerID, &m.CustomerName, &m.Role, &m.IsPrimary); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}

// pickActiveMembership returns the membership matching `want` (the org bound to
// the refresh token) if it's still a valid active membership, else the first
// (primary) membership. `memberships` is assumed non-empty.
func pickActiveMembership(memberships []MembershipInfo, want *string) MembershipInfo {
	if want != nil {
		for _, m := range memberships {
			if m.CustomerID == *want {
				return m
			}
		}
	}
	return memberships[0]
}

func (h *CustomerAuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req customerLoginReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
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

	var c customerContact
	err := h.DB.QueryRow(ctx, `
        SELECT id, customer_id, email, password_hash, full_name, role, locale,
               must_change_password, (email_verified_at IS NOT NULL), mfa_enabled
        FROM customer_contacts
        WHERE email = $1 AND disabled_at IS NULL
    `, req.Email).Scan(&c.ID, &c.CustomerID, &c.Email, &c.PasswordHash, &c.FullName, &c.Role, &c.Locale,
		&c.MustChangePassword, &c.EmailVerified, &c.MFAEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(c.PasswordHash), []byte(req.Password)); err != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// MFA gate: if enrolled, no session is issued yet — hand back a short-lived
	// mfa_pending token the client redeems at /customer/mfa/verify.
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

// issueCustomerSession resolves the active org, mints access + refresh tokens,
// and writes the login response. Shared by password login and MFA verify.
func (h *CustomerAuthHandler) issueCustomerSession(w http.ResponseWriter, r *http.Request, ctx context.Context, c customerContact) {
	memberships, err := h.loadMemberships(ctx, c.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if len(memberships) == 0 {
		writeErr(w, http.StatusUnauthorized, "account inactive")
		return
	}
	c.CustomerID = memberships[0].CustomerID
	c.Role = memberships[0].Role

	access, err := h.signCustomerToken(c)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token sign failed")
		return
	}
	refresh, refreshHash := newCustomerRefreshToken()
	_, err = h.DB.Exec(ctx, `
        INSERT INTO customer_refresh_tokens (contact_id, token_hash, user_agent, ip_address, expires_at, active_customer_id)
        VALUES ($1, $2, $3, NULLIF($4,'')::inet, $5, $6)
    `, c.ID, refreshHash, r.UserAgent(), r.RemoteAddr, time.Now().Add(h.Cfg.RefreshTTL), c.CustomerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "could not issue refresh token")
		return
	}
	_, _ = h.DB.Exec(ctx, `UPDATE customer_contacts SET last_login_at = NOW() WHERE id = $1`, c.ID)

	writeJSON(w, http.StatusOK, customerTokenResp{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int64(h.Cfg.JWTTTL.Seconds()),
		Contact: CustomerInfo{
			ID: c.ID, CustomerID: c.CustomerID, Email: c.Email,
			FullName: c.FullName, Role: c.Role, Locale: c.Locale,
			MustChangePassword: c.MustChangePassword, EmailVerified: c.EmailVerified,
		},
		Memberships: memberships,
	})
}

func (h *CustomerAuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
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
		contactID string
		expiresAt time.Time
		revoked   *time.Time
		activeOrg *string
	)
	err := h.DB.QueryRow(ctx, `
        SELECT id, contact_id, expires_at, revoked_at, active_customer_id
        FROM customer_refresh_tokens WHERE token_hash = $1
    `, hash).Scan(&tokenID, &contactID, &expiresAt, &revoked, &activeOrg)
	if err != nil || revoked != nil || time.Now().After(expiresAt) {
		writeErr(w, http.StatusUnauthorized, "invalid refresh token")
		return
	}

	var c customerContact
	err = h.DB.QueryRow(ctx, `
        SELECT id, customer_id, email, password_hash, full_name, role, locale,
               must_change_password, (email_verified_at IS NOT NULL)
        FROM customer_contacts WHERE id = $1 AND disabled_at IS NULL
    `, contactID).Scan(&c.ID, &c.CustomerID, &c.Email, &c.PasswordHash, &c.FullName, &c.Role, &c.Locale,
		&c.MustChangePassword, &c.EmailVerified)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "contact not found")
		return
	}

	memberships, err := h.loadMemberships(ctx, c.ID)
	if err != nil || len(memberships) == 0 {
		writeErr(w, http.StatusUnauthorized, "account inactive")
		return
	}
	// Preserve the active org the refresh token was bound to (a prior switch-org),
	// but only if it's still a valid active membership; otherwise fall back to
	// the primary org. This is what stops a refresh from silently reverting the
	// user's org selection.
	active := pickActiveMembership(memberships, activeOrg)
	c.CustomerID = active.CustomerID
	c.Role = active.Role

	_, _ = h.DB.Exec(ctx, `UPDATE customer_refresh_tokens SET revoked_at = NOW() WHERE id = $1`, tokenID)

	access, _ := h.signCustomerToken(c)
	newRefresh, newHash := newCustomerRefreshToken()
	_, _ = h.DB.Exec(ctx, `
        INSERT INTO customer_refresh_tokens (contact_id, token_hash, user_agent, ip_address, expires_at, active_customer_id)
        VALUES ($1, $2, $3, NULLIF($4,'')::inet, $5, $6)
    `, c.ID, newHash, r.UserAgent(), r.RemoteAddr, time.Now().Add(h.Cfg.RefreshTTL), c.CustomerID)

	writeJSON(w, http.StatusOK, customerTokenResp{
		AccessToken:  access,
		RefreshToken: newRefresh,
		ExpiresIn:    int64(h.Cfg.JWTTTL.Seconds()),
		Contact: CustomerInfo{
			ID: c.ID, CustomerID: c.CustomerID, Email: c.Email,
			FullName: c.FullName, Role: c.Role, Locale: c.Locale,
			MustChangePassword: c.MustChangePassword, EmailVerified: c.EmailVerified,
		},
		Memberships: memberships,
	})
}

func (h *CustomerAuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.RefreshToken != "" {
		_, _ = h.DB.Exec(r.Context(),
			`UPDATE customer_refresh_tokens SET revoked_at = NOW()
             WHERE token_hash = $1 AND revoked_at IS NULL`,
			sha256hex(req.RefreshToken))
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CustomerAuthHandler) signCustomerToken(c customerContact) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":         h.Cfg.JWTIssuer,
		"aud":         "customer",
		"sub":         c.ID,
		"customer_id": c.CustomerID,
		"email":       c.Email,
		"role":        c.Role,
		"locale":      c.Locale,
		// mcp = must-change-password. customer-api blocks mutating portal calls
		// while this is true, so the emailed temp password can't be used to do
		// anything except change the password.
		"mcp": c.MustChangePassword,
		"iat": now.Unix(),
		"exp": now.Add(h.Cfg.JWTTTL).Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(h.Cfg.JWTSecret))
}

// SetLocale lets a customer contact change their preferred locale.
func (h *CustomerAuthHandler) SetLocale(w http.ResponseWriter, r *http.Request) {
	// We accept the contact_id from a Bearer token via the same RequireJWT
	// middleware used elsewhere; auth-api doesn't import customer-api's
	// middleware, so we re-parse the token claim here.
	var req struct {
		Locale string `json:"locale"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Locale != "en" && req.Locale != "th" {
		writeErr(w, http.StatusBadRequest, "locale must be en or th")
		return
	}

	authz := r.Header.Get("Authorization")
	if !strings.HasPrefix(authz, "Bearer ") {
		writeErr(w, http.StatusUnauthorized, "missing bearer token")
		return
	}
	tokStr := strings.TrimPrefix(authz, "Bearer ")
	claims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(tokStr, claims, func(t *jwt.Token) (any, error) {
		return []byte(h.Cfg.JWTSecret), nil
	})
	if err != nil || !tok.Valid {
		writeErr(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if aud, _ := claims["aud"].(string); aud != "customer" {
		writeErr(w, http.StatusForbidden, "wrong audience")
		return
	}
	contactID, _ := claims["sub"].(string)
	if contactID == "" {
		writeErr(w, http.StatusUnauthorized, "no subject")
		return
	}
	if _, err := h.DB.Exec(r.Context(),
		`UPDATE customer_contacts SET locale = $1 WHERE id = $2`, req.Locale, contactID); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func newCustomerRefreshToken() (raw, hash string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	raw = hex.EncodeToString(b)
	hash = sha256hex(raw)
	return
}
