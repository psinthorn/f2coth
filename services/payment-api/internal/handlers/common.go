package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	authmw "github.com/f2cothai/f2-website/services/payment-api/internal/middleware"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func makeCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}

func customerID(r *http.Request) string {
	v, _ := r.Context().Value(authmw.CtxCustomerID).(string)
	return v
}

func userID(r *http.Request) string {
	v, _ := r.Context().Value(authmw.CtxUserID).(string)
	return v
}
