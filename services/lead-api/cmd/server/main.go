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

	"github.com/f2cothai/f2-website/services/lead-api/internal/config"
	"github.com/f2cothai/f2-website/services/lead-api/internal/handlers"
	authmw "github.com/f2cothai/f2-website/services/lead-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.LeadHandler{DB: pool, Cfg: cfg}
	ch := &handlers.ConsentHandler{DB: pool, Cfg: cfg}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"lead-api"}`))
	})

	r.Route("/api/leads", func(r chi.Router) {
		// Public — contact form intake.
		r.Post("/", h.Create)

		// Admin — JWT-required + admin/editor role only.
		r.Group(func(r chi.Router) {
			r.Use(authmw.RequireJWT(cfg.JWTSecret))
			r.Use(authmw.RequireRole("admin", "editor"))
			r.Get("/", h.List)
			r.Get("/stats", h.Stats)
			r.Get("/activities/recent", h.RecentActivities)
			r.Get("/{id}", h.Get)
			r.Get("/{id}/activities", h.ListActivities)
			r.Post("/{id}/notes", h.AddNote)
			r.Patch("/{id}/status", h.UpdateStatus)
		})
	})

	// Cookie consent endpoints (PDPA).
	r.Route("/api/consent", func(r chi.Router) {
		r.Post("/", ch.RecordConsent)
		r.Get("/{visitorId}", ch.GetConsent)
		r.Post("/{visitorId}/withdraw", ch.WithdrawConsent)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("lead-api listening on :%s", cfg.ServicePort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// PDPA anonymisation janitor: redact PII from leads whose retention period
	// has expired (2 years from creation, per migration 015). Runs immediately at
	// startup then every 24 h so stale PII is purged without manual intervention.
	anonCtx, anonCancel := context.WithCancel(context.Background())
	defer anonCancel()
	go func() {
		anonymise := func() {
			ctx, cancel := context.WithTimeout(anonCtx, 60*time.Second)
			defer cancel()
			tag, err := pool.Exec(ctx, `
				UPDATE leads SET
					full_name     = '[redacted]',
					email         = 'redacted-' || id::text || '@f2.co.th',
					phone         = NULL,
					company       = NULL,
					property_name = NULL,
					message       = '[redacted]',
					ip_address    = NULL,
					user_agent    = NULL,
					utm_source    = NULL,
					utm_medium    = NULL,
					utm_campaign  = NULL,
					notes         = NULL,
					anonymised_at = NOW()
				WHERE retention_expires_at < NOW() AND anonymised_at IS NULL`)
			if err != nil {
				log.Printf("pdpa-janitor: leads anonymisation error: %v", err)
			} else {
				log.Printf("pdpa-janitor: anonymised %d expired leads", tag.RowsAffected())
			}
		}
		anonymise()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				anonymise()
			case <-anonCtx.Done():
				return
			}
		}
	}()

	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
