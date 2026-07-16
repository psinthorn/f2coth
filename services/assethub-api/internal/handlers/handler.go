package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB              *pgxpool.Pool
	JWTSecret       string
	TokenPepper     string
	DocgenURL       string
	NotificationURL string
	ReportsDir      string
	BaseURL         string
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// hashToken returns the hex SHA-256 of pepper||plaintext. The same function
// is used at token creation (store) and at ingest (lookup), so a peppered DB
// leak cannot be replayed as a valid bearer token.
func hashToken(pepper, plaintext string) string {
	sum := sha256.Sum256([]byte(pepper + plaintext))
	return hex.EncodeToString(sum[:])
}

// nilIfEmpty returns nil for an empty string so we store SQL NULL rather than ”.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// isInside reports whether path is contained within dir (defends the report
// download route against path traversal via a tampered file_path).
func isInside(dir, path string) bool {
	rel, err := filepath.Rel(filepath.Clean(dir), path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// zeroTime is a fixed modtime for http.ServeContent (we don't rely on caching).
func zeroTime() time.Time { return time.Unix(0, 0) }
