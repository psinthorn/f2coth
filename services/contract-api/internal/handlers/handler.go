package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/contract-api/internal/docgen"
)

type Handler struct {
	DB         *pgxpool.Pool
	JWTSecret  string
	Docgen     *docgen.Client
	UploadsDir string
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
