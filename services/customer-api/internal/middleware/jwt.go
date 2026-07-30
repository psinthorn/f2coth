package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const (
	CtxAud          ctxKey = "auth.aud"
	CtxUserID       ctxKey = "auth.user_id"     // sub for staff (users.id)
	CtxContactID    ctxKey = "auth.contact_id"  // sub for customer (customer_contacts.id)
	CtxCustomerID   ctxKey = "auth.customer_id" // customer_id claim, set on customer tokens only
	CtxRole         ctxKey = "auth.role"
	CtxMustChangePw ctxKey = "auth.mcp" // must-change-password claim (customer tokens)
)

// RequireJWT validates HS256 tokens, stores the audience plus identity claims
// in the request context. Does NOT enforce a specific audience — chain
// RequireAudience after this.
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
			aud, _ := claims["aud"].(string)
			ctx = context.WithValue(ctx, CtxAud, aud)
			if v, ok := claims["sub"].(string); ok {
				// sub is a staff user id (users.id) on staff tokens and a
				// customer contact id (customer_contacts.id) on customer tokens.
				// Store it under the key that matches the audience so
				// staffID()/contactID() never cross over — otherwise a customer
				// token looks like a staff user to handlers shared across both
				// route groups (e.g. attachment uploads, which pick
				// uploaded_by_user_id vs uploaded_by_contact_id from these).
				// aud=="" is a legacy pre-audience token, treated as staff (see
				// RequireAudience).
				if aud == "customer" {
					ctx = context.WithValue(ctx, CtxContactID, v)
				} else {
					ctx = context.WithValue(ctx, CtxUserID, v)
				}
			}
			if v, ok := claims["customer_id"].(string); ok {
				ctx = context.WithValue(ctx, CtxCustomerID, v)
			}
			if v, ok := claims["role"].(string); ok {
				ctx = context.WithValue(ctx, CtxRole, v)
			}
			if v, ok := claims["mcp"].(bool); ok {
				ctx = context.WithValue(ctx, CtxMustChangePw, v)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAudience rejects tokens that don't match. "" is treated as "staff"
// for backwards compatibility with tokens issued before the aud claim landed.
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

// BlockIfMustChangePassword rejects mutating requests (POST/PATCH/PUT/DELETE)
// from a customer whose token carries mcp=true. This enforces the temp-password
// forced-change server-side — reads still work so the portal can render, but the
// account can't be used to do anything until the password is changed (via
// auth-api, which is not behind this gate). Use after RequireJWT.
func BlockIfMustChangePassword(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			// reads allowed
		default:
			if mcp, _ := r.Context().Value(CtxMustChangePw).(bool); mcp {
				http.Error(w, "password change required", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole gates by role claim. Use after RequireJWT.
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
