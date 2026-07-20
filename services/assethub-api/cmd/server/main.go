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
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/assethub-api/internal/config"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/handlers"
	mw "github.com/f2cothai/f2-website/services/assethub-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/assethub-api/internal/report"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.Handler{
		DB:              pool,
		JWTSecret:       cfg.JWTSecret,
		TokenPepper:     cfg.TokenPepper,
		DocgenURL:       cfg.DocgenURL,
		NotificationURL: cfg.NotificationURL,
		ReportsDir:      cfg.ReportsDir,
		BaseURL:         cfg.BaseURL,
	}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"ok","service":"assethub-api"}`))
	})

	r.Route("/api/assethub", func(r chi.Router) {
		// ── Machine ingest (enrollment-token auth, NOT JWT). Rate-limited
		//    60/min per token, 2 MB body cap in the handler.
		r.Group(func(r chi.Router) {
			r.Use(mw.GateModule("api.assethub"))
			r.Use(httprate.Limit(60, time.Minute, httprate.WithKeyFuncs(tokenKey)))
			r.Post("/ingest", h.Ingest)
			r.Post("/discovery", h.Discovery)
			r.Post("/enroll", h.EnrollDevice)
			// Daemon coordination (run.sh --daemon): "should I scan now?" + ack.
			r.Get("/agent/poll", h.AgentPoll)
			r.Post("/agent/ack", h.AgentAck)
		})

		// ── Client-tool downloads (collect.sh / collect.ps1 / discover.sh /
		//    probe compose). Public behind the module gate — no secrets in the
		//    scripts; techs curl them onto client machines with no F2 login.
		r.Group(func(r chi.Router) {
			r.Use(mw.GateModule("api.assethub"))
			r.Get("/collector/{name}", h.DownloadCollector)
		})

		// ── Staff admin console (aud=staff). Reads: any staff; writes:
		//    editor+ (engineer); destructive: admin (superadmin).
		r.Route("/admin", func(r chi.Router) {
			r.Use(mw.GateModule("api.assethub"))

			r.Group(func(r chi.Router) {
				r.Use(mw.RequireAuth(cfg.JWTSecret))
				r.Get("/orgs", h.ListOrgs)
				r.Get("/overview", h.Overview)
				r.Get("/sites", h.ListSites)
				r.Get("/tokens", h.ListTokens)
				r.Get("/devices", h.ListDevices)
				r.Get("/devices.csv", h.ExportDevicesCSV)
				r.Get("/devices/{id}", h.GetDevice)
				r.Get("/devices/{id}/history", h.DeviceHistory)
				r.Get("/discovery/findings", h.ListFindings)
				r.Get("/reports", h.ListReports)
				r.Get("/reports/{id}/download", h.DownloadReport)
			})

			r.Group(func(r chi.Router) {
				r.Use(mw.RequireStaff(cfg.JWTSecret))
				r.Post("/sites", h.CreateSite)
				r.Patch("/sites/{id}", h.UpdateSite)
				r.Post("/tokens", h.CreateToken)
				r.Patch("/tokens/{id}", h.UpdateToken)
				r.Post("/tokens/{id}/revoke", h.RevokeToken)
				r.Post("/tokens/{id}/scan", h.ScanNow)
				r.Post("/devices", h.CreateDevice)
				r.Patch("/devices/{id}", h.PatchDevice)
				r.Post("/devices/{id}/generate-tag", h.GenerateTag)
				r.Post("/discovery/findings/{id}/promote", h.PromoteFinding)
				r.Post("/discovery/findings/{id}/ignore", h.IgnoreFinding)
				r.Post("/reports", h.CreateReport)
				r.Post("/reports/{id}/retry", h.RetryReport)
			})

			r.Group(func(r chi.Router) {
				r.Use(mw.RequireAdmin(cfg.JWTSecret))
				r.Delete("/sites/{id}", h.DeleteSite)
				r.Delete("/devices/{id}", h.DeleteDevice)
				r.Delete("/tokens/{id}", h.DeleteToken)
				r.Delete("/reports/{id}", h.DeleteReport)
			})
		})

		// ── Customer portal (aud=customer). Read-only register scoped to the
		//    caller's own customer_id claim.
		r.Route("/portal", func(r chi.Router) {
			r.Use(mw.GateModule("portal.assethub"))
			r.Use(mw.RequireCustomer(cfg.JWTSecret))
			r.Get("/overview", h.Overview)
			r.Get("/sites", h.ListSites)
			r.Get("/devices", h.ListDevices)
			r.Get("/devices.csv", h.ExportDevicesCSV)
			r.Get("/devices/{id}", h.GetDevice)
			r.Get("/devices/{id}/history", h.DeviceHistory)
		})
	})

	// Background report worker (same binary; runs alongside the API).
	workerCtx, cancelWorker := context.WithCancel(context.Background())
	wk := &report.Worker{DB: pool, DocgenURL: cfg.DocgenURL, ReportsDir: cfg.ReportsDir}
	go wk.Start(workerCtx)

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("assethub-api listening on :%s", cfg.ServicePort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	cancelWorker()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// tokenKey rate-limits ingest per enrollment token (falls back to IP).
func tokenKey(r *http.Request) (string, error) {
	if auth := r.Header.Get("Authorization"); auth != "" {
		return auth, nil
	}
	return httprate.KeyByIP(r)
}
