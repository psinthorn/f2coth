package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxUserID     ctxKey = "assethub.user_id"
	CtxRole       ctxKey = "assethub.role"
	CtxCustomerID ctxKey = "assethub.customer_id"
)

// UserID returns the JWT subject (users.id) from ctx, empty if not authenticated.
func UserID(ctx context.Context) string {
	if v, ok := ctx.Value(CtxUserID).(string); ok {
		return v
	}
	return ""
}

// Role returns the caller's staff role from ctx (admin/editor/viewer).
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
// Maps AssetHub's engineer/superadmin roles onto the existing staff roles:
// admin = superadmin, editor = engineer, viewer = read-only staff.
func RequireAuth(secret string) func(http.Handler) http.Handler {
	return require(secret, "admin", "editor", "viewer")
}

// RequireStaff allows admin + editor (engineers): triage, edit devices,
// generate reports.
func RequireStaff(secret string) func(http.Handler) http.Handler {
	return require(secret, "admin", "editor")
}

// RequireAdmin allows only admin (superadmin): sites, tokens, deletes.
func RequireAdmin(secret string) func(http.Handler) http.Handler {
	return require(secret, "admin")
}

// RequireCustomer accepts customer-audience JWTs (aud="customer"). The
// customer_id claim is stashed in ctx so portal handlers scope queries to
// that customer's rows only. org_admin = contact role "owner",
// org_viewer = "member" (enforced at the handler level where needed).
func RequireCustomer(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if secret == "" {
				writeErr(w, http.StatusServiceUnavailable, "auth not configured")
				return
			}
			claims, ok := parseBearer(w, r, secret)
			if !ok {
				return
			}
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
			if role, ok := claims["role"].(string); ok {
				ctx = context.WithValue(ctx, CtxRole, role)
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
			claims, ok := parseBearer(w, r, secret)
			if !ok {
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

// parseBearer validates an HS256 bearer token and returns its claims. On any
// failure it writes the error response and returns ok=false.
func parseBearer(w http.ResponseWriter, r *http.Request, secret string) (jwt.MapClaims, bool) {
	bearer := r.Header.Get("Authorization")
	if !strings.HasPrefix(bearer, "Bearer ") {
		writeErr(w, http.StatusUnauthorized, "missing bearer token")
		return nil, false
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
		return nil, false
	}
	return claims, true
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(`{"error":"` + msg + `"}`))
}
