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

	"github.com/f2cothai/f2-website/services/auth-api/internal/config"
	"github.com/f2cothai/f2-website/services/auth-api/internal/handlers"
	authmw "github.com/f2cothai/f2-website/services/auth-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.AuthHandler{DB: pool, Cfg: cfg}
	uh := &handlers.UserHandler{DB: pool, Cfg: cfg}
	ch := &handlers.CustomerAuthHandler{DB: pool, Cfg: cfg}
	ph := &handlers.PrivacyHandler{DB: pool, Cfg: cfg}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"auth-api"}`))
	})

	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/login", h.Login)
		r.Post("/refresh", h.Refresh)
		r.Post("/logout", h.Logout)

		// Customer (portal) login flow — separate JWT audience.
		r.Route("/customer", func(r chi.Router) {
			r.Post("/login", ch.Login)
			r.Post("/refresh", ch.Refresh)
			r.Post("/logout", ch.Logout)
			r.Patch("/me/locale", ch.SetLocale)
		})

		r.Group(func(r chi.Router) {
			r.Use(authmw.RequireJWT(cfg.JWTSecret))
			r.Get("/me", h.Me)
			r.Patch("/me/locale", h.SetLocale)

			// Admin-only user management.
			r.Group(func(r chi.Router) {
				r.Use(authmw.RequireRole("admin"))
				r.Get("/users", uh.List)
				r.Post("/users", uh.Create)
				r.Patch("/users/{id}", uh.Update)
				r.Post("/users/{id}/disable", uh.Disable)
				r.Post("/users/{id}/enable", uh.Enable)
			})
		})
	})

	// Privacy / PDPA endpoints.
	r.Route("/api/privacy", func(r chi.Router) {
		// Public — any visitor can submit a data subject request.
		r.Post("/dsr", ph.SubmitDSR)

		// Admin — manage and respond to DSRs.
		r.Group(func(r chi.Router) {
			r.Use(authmw.RequireJWT(cfg.JWTSecret))
			r.Use(authmw.RequireRole("admin"))
			r.Get("/dsr", ph.ListDSRs)
			r.Get("/dsr/{id}", ph.GetDSR)
			r.Patch("/dsr/{id}", ph.UpdateDSR)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("auth-api listening on :%s", cfg.ServicePort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// Refresh-token janitor: purge expired rows from both token tables every 24 h.
	// Runs immediately at startup, then on a 24-hour ticker.
	// Cancelled automatically when the shutdown signal arrives.
	janitorCtx, janitorCancel := context.WithCancel(context.Background())
	defer janitorCancel()
	go func() {
		purge := func() {
			ctx, cancel := context.WithTimeout(janitorCtx, 30*time.Second)
			defer cancel()
			n1, err1 := pool.Exec(ctx,
				`DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL`)
			n2, err2 := pool.Exec(ctx,
				`DELETE FROM customer_refresh_tokens WHERE expires_at < NOW() OR revoked_at IS NOT NULL`)
			if err1 != nil || err2 != nil {
				log.Printf("janitor: error purging tokens: staff=%v customer=%v", err1, err2)
			} else {
				log.Printf("janitor: purged %d staff + %d customer refresh tokens",
					n1.RowsAffected(), n2.RowsAffected())
			}
		}
		purge()
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				purge()
			case <-janitorCtx.Done():
				return
			}
		}
	}()

	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
