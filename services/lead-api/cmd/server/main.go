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
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
