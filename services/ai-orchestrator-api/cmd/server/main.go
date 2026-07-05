package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/config"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/handlers"
	mw "github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/providers"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/router"
	"github.com/f2cothai/f2-website/services/ai-orchestrator-api/internal/usage"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	// Wire providers. Ollama is instantiated even when unreachable so
	// the router can log a clean fallback error instead of a panic.
	gens := map[string]providers.Generator{
		"anthropic": providers.NewAnthropicClient(cfg.AnthropicAPIKey, cfg.AnthropicBaseURL),
		"ollama":    providers.NewOllamaClient(cfg.OllamaBaseURL),
	}
	embs := map[string]providers.Embedder{
		"ollama": providers.NewOllamaClient(cfg.OllamaBaseURL),
	}
	// Voyage embed client is left un-wired for the pilot — pilot uses
	// BGE-m3 local. Add here when cloud embeddings come back on-menu.

	rt := router.New(pool, gens, embs, time.Duration(cfg.RoutingRefreshSeconds)*time.Second)
	rt.Start(context.Background())

	usageLogger := usage.New(pool, cfg.BudgetAlertUSD)
	usageLogger.Start(context.Background())

	h := &handlers.Handler{DB: pool, Router: rt, Usage: usageLogger}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(120 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Inject the budget cap into every request context so the usage
	// summary handler can echo it without a second env read.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(handlers.WithBudget(req.Context(), cfg.BudgetAlertUSD)))
		})
	})

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"ai-orchestrator-api"}`))
	})

	r.Route("/api/ai", func(r chi.Router) {
		r.Use(mw.GateModule("api.ai_orchestrator"))

		// Generate + embed are staff-only for the pilot. Later phases
		// will open scoped access to customer portal via a different
		// module (portal.ai).
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAdmin(cfg.JWTSecret))
			r.Post("/generate", h.Generate)
			r.Post("/embed", h.Embed)
		})

		// Admin console endpoints.
		r.Route("/admin", func(r chi.Router) {
			r.Use(mw.RequireAdmin(cfg.JWTSecret))
			r.Get("/routing", h.AdminListRouting)
			r.Patch("/routing/{id}", h.AdminPatchRoute)
			r.Get("/usage", h.AdminUsageSummary)
			r.Get("/usage/entries", h.AdminUsageEntries)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("ai-orchestrator-api listening on :%s", cfg.ServicePort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
