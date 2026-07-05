package handlers

// Small helper to synthesize a chi URL-param context for internal calls
// (scheduler → handler). Isolated in its own file so the trick has a
// documented home and doesn't clutter the scheduler's business logic.

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// withChiURLParam returns a request whose chi URL parameters include
// {key: value}. Used by the scheduler to reuse HTTP handlers without
// going through the router. Equivalent to Chi's own approach in tests.
func withChiURLParam(r *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	ctx := context.WithValue(r.Context(), chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}
