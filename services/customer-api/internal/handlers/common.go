package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// makeCtx returns a short-lived context for synchronous helper lookups that
// aren't tied to an inbound request lifetime. Callers must call cancel() to
// release resources.
func makeCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 3*time.Second)
}
