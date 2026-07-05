package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxAud        ctxKey = "auth.aud"
	CtxUserID     ctxKey = "auth.user_id"
	CtxContactID  ctxKey = "auth.contact_id"
	CtxCustomerID ctxKey = "auth.customer_id"
	CtxRole       ctxKey = "auth.role"
)

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
			if v, ok := claims["aud"].(string); ok {
				ctx = context.WithValue(ctx, CtxAud, v)
			}
			if v, ok := claims["sub"].(string); ok {
				ctx = context.WithValue(ctx, CtxUserID, v)
				ctx = context.WithValue(ctx, CtxContactID, v)
			}
			if v, ok := claims["customer_id"].(string); ok {
				ctx = context.WithValue(ctx, CtxCustomerID, v)
			}
			if v, ok := claims["role"].(string); ok {
				ctx = context.WithValue(ctx, CtxRole, v)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAudience(want string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got, _ := r.Context().Value(CtxAud).(string)
			if got == "" {
				got = "staff"
			}
			if got != want {
				http.Error(w, "wrong audience", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

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
