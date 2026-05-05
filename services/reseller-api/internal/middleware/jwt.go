package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxAud    ctxKey = "auth.aud"
	CtxUserID ctxKey = "auth.user_id"
	CtxRole   ctxKey = "auth.role"
)

// RequireStaffJWT validates HS256 tokens and gates by aud="staff".
// Mounted only on admin endpoints.
func RequireStaffJWT(secret string) func(http.Handler) http.Handler {
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

			aud, _ := claims["aud"].(string)
			if aud == "" {
				aud = "staff"
			}
			if aud != "staff" {
				http.Error(w, "wrong audience", http.StatusForbidden)
				return
			}

			ctx := r.Context()
			ctx = context.WithValue(ctx, CtxAud, aud)
			if v, ok := claims["sub"].(string); ok {
				ctx = context.WithValue(ctx, CtxUserID, v)
			}
			if v, ok := claims["role"].(string); ok {
				ctx = context.WithValue(ctx, CtxRole, v)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserID(ctx context.Context) string {
	v, _ := ctx.Value(CtxUserID).(string)
	return v
}

func Role(ctx context.Context) string {
	v, _ := ctx.Value(CtxRole).(string)
	return v
}
