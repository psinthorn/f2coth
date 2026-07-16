package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxUserID     ctxKey = "contract.user_id"
	CtxRole       ctxKey = "contract.role"
	CtxCustomerID ctxKey = "contract.customer_id"
)

// UserID returns the JWT subject (users.id) from ctx, empty if not authenticated.
func UserID(ctx context.Context) string {
	if v, ok := ctx.Value(CtxUserID).(string); ok {
		return v
	}
	return ""
}

// Role returns the caller's role from ctx (admin/editor/viewer), empty if not authenticated.
func Role(ctx context.Context) string {
	if v, ok := ctx.Value(CtxRole).(string); ok {
		return v
	}
	return ""
}

// CustomerID returns the customers.id claim from a customer-audience JWT.
// Empty when the request came through a staff gate rather than RequireCustomer.
func CustomerID(ctx context.Context) string {
	if v, ok := ctx.Value(CtxCustomerID).(string); ok {
		return v
	}
	return ""
}

// RequireAuth accepts any authenticated staff user (admin, editor, viewer).
// Techs = editor; read-only viewers get GET-only routes at the handler level.
func RequireAuth(secret string) func(http.Handler) http.Handler {
	return require(secret, "admin", "editor", "viewer")
}

// RequireStaff allows admin + editor (writes item status, adds visit logs).
func RequireStaff(secret string) func(http.Handler) http.Handler {
	return require(secret, "admin", "editor")
}

// RequireAdmin allows only admin (manages templates, projects, module attach/detach).
func RequireAdmin(secret string) func(http.Handler) http.Handler {
	return require(secret, "admin")
}

// RequireCustomer accepts customer-audience JWTs (aud="customer") issued by
// auth-api's CustomerAuthHandler. The customer_id claim is stashed in ctx
// so the portal handlers can scope queries to that customer's rows only.
func RequireCustomer(secret string) func(http.Handler) http.Handler {
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
			tok, err := jwt.ParseWithClaims(strings.TrimPrefix(bearer, "Bearer "), claims, func(t *jwt.Token) (any, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrTokenSignatureInvalid
				}
				return []byte(secret), nil
			})
			if err != nil || !tok.Valid {
				writeErr(w, http.StatusUnauthorized, "invalid token")
				return
			}
			// Must be a customer-audience token — staff tokens use a different
			// audience and would otherwise leak into these portal endpoints.
			if aud, _ := claims["aud"].(string); aud != "customer" {
				writeErr(w, http.StatusForbidden, "customer token required")
				return
			}
			customerID, _ := claims["customer_id"].(string)
			if customerID == "" {
				writeErr(w, http.StatusForbidden, "customer_id missing")
				return
			}
			ctx := r.Context()
			if sub, ok := claims["sub"].(string); ok {
				ctx = context.WithValue(ctx, CtxUserID, sub)
			}
			ctx = context.WithValue(ctx, CtxCustomerID, customerID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func require(secret string, roles ...string) func(http.Handler) http.Handler {
	roleSet := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		roleSet[r] = struct{}{}
	}
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
			tokenStr := strings.TrimPrefix(bearer, "Bearer ")
			claims := jwt.MapClaims{}
			tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrTokenSignatureInvalid
				}
				return []byte(secret), nil
			})
			if err != nil || !tok.Valid {
				writeErr(w, http.StatusUnauthorized, "invalid token")
				return
			}
			role, _ := claims["role"].(string)
			if _, ok := roleSet[role]; !ok {
				writeErr(w, http.StatusForbidden, "insufficient role")
				return
			}
			ctx := r.Context()
			if sub, ok := claims["sub"].(string); ok {
				ctx = context.WithValue(ctx, CtxUserID, sub)
			}
			ctx = context.WithValue(ctx, CtxRole, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + msg + `"}`))
}
