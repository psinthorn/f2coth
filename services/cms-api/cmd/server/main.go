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

	"github.com/f2cothai/f2-website/services/cms-api/internal/config"
	"github.com/f2cothai/f2-website/services/cms-api/internal/handlers"
	mw "github.com/f2cothai/f2-website/services/cms-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.CMSHandler{DB: pool, JWTSecret: cfg.JWTSecret}

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
		w.Write([]byte(`{"status":"ok","service":"cms-api"}`))
	})

	r.Route("/api/cms", func(r chi.Router) {
		r.Use(mw.Locale)

		r.Get("/services", h.ListServices)
		r.Get("/services/{slug}", h.GetService)
		r.Get("/case-studies", h.ListCaseStudies)
		r.Get("/case-studies/{slug}", h.GetCaseStudy)
		r.Get("/blog", h.ListBlogPosts)
		r.Get("/blog/{slug}", h.GetBlogPost)
		r.Get("/pages/{slug}", h.GetPage)
		r.Get("/domain-pricing", h.ListDomainPricing)
		r.Get("/hosting-plans", h.ListHostingPlans)
		r.Get("/modules", h.ListModules)

		// Admin-only write endpoints (require admin or editor JWT).
		r.Route("/admin", func(r chi.Router) {
			r.Use(h.RequireAdminOrEditor)
			r.Get("/blog", h.AdminListBlogPosts)
			r.Post("/blog", h.AdminCreateBlogPost)
			r.Get("/blog/{slug}", h.AdminGetBlogPost)
			r.Patch("/blog/{slug}", h.AdminUpdateBlogPost)
			r.Delete("/blog/{slug}", h.AdminDeleteBlogPost)
			r.Get("/modules", h.AdminListModules)
			r.Patch("/modules/{key}", h.AdminToggleModule)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("cms-api listening on :%s", cfg.ServicePort)
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
