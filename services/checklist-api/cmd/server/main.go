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

	"github.com/f2cothai/f2-website/services/checklist-api/internal/config"
	"github.com/f2cothai/f2-website/services/checklist-api/internal/handlers"
	mw "github.com/f2cothai/f2-website/services/checklist-api/internal/middleware"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.Handler{DB: pool, JWTSecret: cfg.JWTSecret}

	// Weekly summary scheduler — hourly poll, fires on Fridays 09:00+
	// Asia/Bangkok. Idempotent via a marker row in visit_logs so restarts
	// or double-ticks don't double-send.
	sch := handlers.NewScheduler(pool, h)
	sch.Start()
	defer sch.Stop()

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
		_, _ = w.Write([]byte(`{"status":"ok","service":"checklist-api"}`))
	})

	r.Route("/api/checklists", func(r chi.Router) {
		// Public, no auth — uploads are non-guessable UUIDs. Portal + email
		// reports link directly to these URLs so they must be readable
		// without a JWT.
		r.Get("/uploads/{name}", h.ServeUpload)

		// Any authenticated staff can read templates + projects.
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAuth(cfg.JWTSecret))
			r.Get("/templates", h.ListTemplates)
			r.Get("/templates/{id}", h.GetTemplate)
			r.Get("/projects", h.ListProjects)
			r.Get("/projects/{id}", h.GetProject)
			r.Get("/projects/{id}/board", h.GetProjectBoard)
			r.Get("/projects/{id}/progress", h.GetProjectProgress)
			r.Get("/projects/{id}/report", h.GetProjectReport)
			r.Get("/projects/{id}/visits", h.ListVisits)

			// Attachments — staff read (metadata + streamed file).
			r.Group(func(r chi.Router) {
				r.Use(mw.GateModule("api.attachments"))
				r.Get("/attachments", h.ListAttachments)
				r.Get("/attachments/{id}", h.ServeAttachment)
			})
		})
		// Staff (admin + editor = tech) can write item state + visit logs,
		// and upload photos to attach to items.
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireStaff(cfg.JWTSecret))
			r.Patch("/items/{id}", h.UpdateItem)
			r.Post("/projects/{id}/visits", h.CreateVisit)
			r.Post("/uploads", h.UploadPhoto)

			// Attachments — staff write (documents, images, live GPS photos).
			r.Group(func(r chi.Router) {
				r.Use(mw.GateModule("api.attachments"))
				r.Post("/attachments", h.CreateAttachment)
				r.Delete("/attachments/{id}", h.DeleteAttachment)
			})
		})
		// Customer portal — read-only, scoped to the caller's customer_id.
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireCustomer(cfg.JWTSecret))
			r.Get("/portal/projects", h.PortalListProjects)
			r.Get("/portal/projects/{id}", h.PortalGetProject)
			r.Get("/portal/projects/{id}/board", h.PortalGetBoard)
			r.Get("/portal/projects/{id}/progress", h.PortalGetProgress)

			// Attachments — customer read, scoped to visible projects.
			r.Group(func(r chi.Router) {
				r.Use(mw.GateModule("api.attachments"))
				r.Get("/portal/attachments", h.PortalListAttachments)
				r.Get("/portal/attachments/{id}", h.PortalServeAttachment)
			})
		})
		// Admin-only: template CRUD + project lifecycle + module attach/detach/reorder.
		r.Group(func(r chi.Router) {
			r.Use(mw.RequireAdmin(cfg.JWTSecret))
			r.Post("/admin/templates", h.CreateTemplate)
			r.Patch("/admin/templates/{id}", h.UpdateTemplate)
			r.Delete("/admin/templates/{id}", h.DeleteTemplate)
			r.Post("/admin/templates/import", h.ImportTemplates)
			r.Post("/admin/projects", h.CreateProject)
			r.Patch("/admin/projects/{id}", h.UpdateProject)
			r.Delete("/admin/projects/{id}", h.DeleteProject)
			r.Post("/projects/{id}/modules", h.AttachModule)
			r.Delete("/projects/{id}/modules/{pmId}", h.DetachModule)
			r.Patch("/projects/{id}/modules/reorder", h.ReorderModules)
			r.Post("/admin/projects/{id}/send-weekly-summary", h.SendWeeklySummary)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("checklist-api listening on :%s", cfg.ServicePort)
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
