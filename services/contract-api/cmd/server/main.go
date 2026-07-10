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

	"github.com/f2cothai/f2-website/services/contract-api/internal/config"
	"github.com/f2cothai/f2-website/services/contract-api/internal/docgen"
	"github.com/f2cothai/f2-website/services/contract-api/internal/handlers"
	mw "github.com/f2cothai/f2-website/services/contract-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.Handler{
		DB:         pool,
		JWTSecret:  cfg.JWTSecret,
		Docgen:     docgen.New(cfg.DocgenURL),
		UploadsDir: cfg.UploadsDir,
	}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(120 * time.Second)) // generation calls LibreOffice
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","service":"contract-api"}`))
	})

	r.Route("/api/contracts", func(r chi.Router) {
		// ── Reads: any authenticated staff (admin, editor/tech, viewer).
		// Tech is read-only on contracts per the RBAC spec.
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAuth(cfg.JWTSecret))
			r.Use(mw.GateModule("api.contracts"))
			r.Get("/", h.ListContracts)
			r.Get("/templates", h.ListTemplates)
			r.Get("/templates/{id}", h.GetTemplate)
			r.Get("/parties", h.ListParties)
			r.Get("/parties/{id}", h.GetParty)
			r.Get("/{id}", h.GetContract)
			r.Get("/{id}/files/{fileId}", h.DownloadFile)
		})

		// ── Writes: admin only (create/edit/generate/upload/transition).
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAdmin(cfg.JWTSecret))
			r.Use(mw.GateModule("api.contracts"))
			r.Post("/templates", h.CreateTemplate)
			r.Patch("/templates/{id}", h.UpdateTemplate)
			r.Post("/parties", h.CreateParty)
			r.Patch("/parties/{id}", h.UpdateParty)
			r.Post("/", h.CreateContract)
			r.Patch("/{id}", h.UpdateContract)
			r.Delete("/{id}", h.DeleteContract)
			r.Post("/{id}/generate", h.GenerateContract)
			r.Post("/{id}/status", h.ChangeStatus)
			r.Post("/{id}/files", h.UploadFile)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("contract-api listening on :%s (docgen=%s)", cfg.ServicePort, cfg.DocgenURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
