package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	DB        *pgxpool.Pool
	JWTSecret string
}

// exists runs a boolean EXISTS(...) query and returns its result (false on
// error — callers treat a failed lookup as "no duplicate" and let the write
// surface any real error). Used for case-insensitive duplicate guards.
func (h *Handler) exists(ctx context.Context, sql string, args ...any) bool {
	var b bool
	_ = h.DB.QueryRow(ctx, sql, args...).Scan(&b)
	return b
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
