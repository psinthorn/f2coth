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

	"github.com/f2cothai/f2-website/services/reseller-api/internal/config"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/handlers"
	mw "github.com/f2cothai/f2-website/services/reseller-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/registry"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/store"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	httpClient := &http.Client{Timeout: cfg.OutboundTimeout}

	router := buildRegistryRouter(cfg, httpClient)
	cache := &store.AvailabilityCache{DB: pool, TTL: cfg.CacheTTL}

	availability := &handlers.AvailabilityHandler{Router: router, Cache: cache}
	orders := &handlers.OrdersHandler{DB: pool, Router: router}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"reseller-api"}`))
	})

	r.Route("/api/reseller", func(r chi.Router) {
		// Public — domain availability lookup used by the marketplace.
		// Gated by api.reseller so admins can pause new searches without
		// taking the admin order queue offline.
		r.Group(func(r chi.Router) {
			r.Use(mw.GateModule("api.reseller"))
			r.Post("/availability", availability.Check)
		})

		// Admin only — not gated so operators can still process existing
		// orders while public availability is paused.
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireStaffJWT(cfg.JWTSecret))
			r.Get("/orders", orders.List)
			r.Post("/orders", orders.Create)
			r.Get("/orders/{id}", orders.Get)
			r.Patch("/orders/{id}", orders.Update)
			r.Post("/orders/{id}/place", orders.Place)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		mode := "mock"
		if cfg.RCConfigured() {
			mode = "resellerclub-live"
		}
		log.Printf("reseller-api listening on :%s (registry: %s, base=%s)", cfg.ServicePort, mode, cfg.RCBaseURL)
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

// buildRegistryRouter wires the active set of registry adapters. THNIC is
// always present (stub). ResellerClub goes live when creds exist; otherwise
// gTLDs route to Mock too.
func buildRegistryRouter(cfg config.Config, hc *http.Client) *registry.Router {
	thnic := registry.THNICStub{}
	mock := registry.Mock{}
	router := &registry.Router{Fallback: mock}

	router.Adapters = append(router.Adapters, thnic)
	if cfg.RCConfigured() {
		router.Adapters = append(router.Adapters, &registry.ResellerClub{
			BaseURL:           cfg.RCBaseURL,
			AuthUserID:        cfg.RCAuthUserID,
			APIKey:            cfg.RCAPIKey,
			HTTPClient:        hc,
			DefaultCustomerID: cfg.RCDefaultCustomerID,
			DefaultContactID:  cfg.RCDefaultContactID,
			DefaultNS1:        cfg.RCDefaultNS1,
			DefaultNS2:        cfg.RCDefaultNS2,
		})
	}
	return router
}
