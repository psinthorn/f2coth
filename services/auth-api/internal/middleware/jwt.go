package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxUserID ctxKey = "auth.user_id"
	CtxRole   ctxKey = "auth.role"
)

// RequireJWT validates the bearer token using the supplied secret and stores
// the user_id and role in the request context.
func RequireJWT(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				http.Error(w, "missing bearer token", http.StatusUnauthorized)
				return
			}
			tokenStr := strings.TrimPrefix(h, "Bearer ")

			claims := jwt.MapClaims{}
			tok, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrTokenSignatureInvalid
				}
				return []byte(secret), nil
			})
			if err != nil || !tok.Valid {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			ctx := r.Context()
			if sub, ok := claims["sub"].(string); ok {
				ctx = context.WithValue(ctx, CtxUserID, sub)
			}
			if role, ok := claims["role"].(string); ok {
				ctx = context.WithValue(ctx, CtxRole, role)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRole gates the handler to one of the allowed roles. Must be chained
// after RequireJWT.
func RequireRole(allowed ...string) func(http.Handler) http.Handler {
	set := make(map[string]struct{}, len(allowed))
	for _, r := range allowed {
		set[r] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			role, _ := r.Context().Value(CtxRole).(string)
			if _, ok := set[role]; !ok {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
