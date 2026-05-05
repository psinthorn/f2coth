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
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
