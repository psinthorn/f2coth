package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "s3cret"

func makeToken(t *testing.T, role, sub string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  sub,
		"role": role,
		"exp":  time.Now().Add(time.Hour).Unix(),
	})
	s, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func TestRoleGates(t *testing.T) {
	admin := makeToken(t, "admin", "u-1")
	editor := makeToken(t, "editor", "u-2")
	viewer := makeToken(t, "viewer", "u-3")
	nobody := makeToken(t, "guest", "u-4")

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	tests := []struct {
		name    string
		mw      func(http.Handler) http.Handler
		token   string
		wantHTS int
	}{
		{"auth: admin ok", RequireAuth(testSecret), admin, http.StatusOK},
		{"auth: editor ok", RequireAuth(testSecret), editor, http.StatusOK},
		{"auth: viewer ok", RequireAuth(testSecret), viewer, http.StatusOK},
		{"auth: guest forbidden", RequireAuth(testSecret), nobody, http.StatusForbidden},
		{"auth: no token", RequireAuth(testSecret), "", http.StatusUnauthorized},
		{"staff: admin ok", RequireStaff(testSecret), admin, http.StatusOK},
		{"staff: editor ok", RequireStaff(testSecret), editor, http.StatusOK},
		{"staff: viewer forbidden", RequireStaff(testSecret), viewer, http.StatusForbidden},
		{"admin: admin ok", RequireAdmin(testSecret), admin, http.StatusOK},
		{"admin: editor forbidden", RequireAdmin(testSecret), editor, http.StatusForbidden},
		{"admin: viewer forbidden", RequireAdmin(testSecret), viewer, http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := tt.mw(next)
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			if tt.token != "" {
				req.Header.Set("Authorization", "Bearer "+tt.token)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tt.wantHTS {
				t.Errorf("got %d, want %d", rec.Code, tt.wantHTS)
			}
		})
	}
}

func TestUserIDAndRoleContextHelpers(t *testing.T) {
	tests := []struct {
		name       string
		token      string
		wantUserID string
		wantRole   string
	}{
		{"admin token", makeToken(t, "admin", "abc-123"), "abc-123", "admin"},
		{"editor token", makeToken(t, "editor", "def-456"), "def-456", "editor"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotUID, gotRole string
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotUID = UserID(r.Context())
				gotRole = Role(r.Context())
			})
			h := RequireAuth(testSecret)(next)
			req := httptest.NewRequest(http.MethodGet, "/x", nil)
			req.Header.Set("Authorization", "Bearer "+tt.token)
			h.ServeHTTP(httptest.NewRecorder(), req)
			if gotUID != tt.wantUserID {
				t.Errorf("user id: got %q, want %q", gotUID, tt.wantUserID)
			}
			if gotRole != tt.wantRole {
				t.Errorf("role: got %q, want %q", gotRole, tt.wantRole)
			}
		})
	}
}

func TestSecretMissingReturns503(t *testing.T) {
	h := RequireAuth("")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("got %d, want 503", rec.Code)
	}
}
