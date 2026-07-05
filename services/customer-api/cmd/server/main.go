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

	"github.com/f2cothai/f2-website/services/customer-api/internal/config"
	"github.com/f2cothai/f2-website/services/customer-api/internal/handlers"
	authmw "github.com/f2cothai/f2-website/services/customer-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/customer-api/internal/notify"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	notifier := notify.NewClient(cfg.NotificationAPIURL)
	ph := &handlers.PortalHandler{DB: pool, Cfg: cfg, Notify: notifier}
	ah := &handlers.AdminHandler{DB: pool, Cfg: cfg, Notify: notifier}
	assets := &handlers.AssetHandler{DB: pool}

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
		w.Write([]byte(`{"status":"ok","service":"customer-api"}`))
	})

	// ---------- Customer-facing portal routes ----------
	r.Route("/api/portal", func(r chi.Router) {
		r.Use(authmw.RequireJWT(cfg.JWTSecret))
		r.Use(authmw.RequireAudience("customer"))

		r.Get("/me", ph.Me)
		r.Get("/tickets", ph.ListTickets)
		r.Post("/tickets", ph.CreateTicket)
		r.Get("/tickets/{id}", ph.GetTicket)
		r.Patch("/tickets/{id}/status", ph.UpdateStatus)
		r.Get("/tickets/{id}/messages", ph.ListMessages)
		r.Post("/tickets/{id}/messages", ph.AddMessage)

		// Entitlement-gated read endpoints (return 404 if customer
		// doesn't have the underlying service contracted).
		r.Get("/domains", assets.PortalListDomains)
		r.Get("/sla", assets.PortalListSLA)

		// Customer-initiated domain orders (no entitlement gate — any
		// customer can request to add a domain).
		r.Get("/domains/orders", assets.PortalListDomainOrders)
		r.Post("/domains/orders", assets.PortalCreateDomainOrder)
	})

	// ---------- Staff-facing customer-management routes ----------
	r.Route("/api/customer/admin", func(r chi.Router) {
		r.Use(authmw.RequireJWT(cfg.JWTSecret))
		r.Use(authmw.RequireAudience("staff"))
		r.Use(authmw.RequireRole("admin", "editor"))

		// Customers
		r.Get("/customers", ah.ListCustomers)
		r.Post("/customers", ah.CreateCustomer)
		r.Get("/customers/{id}", ah.GetCustomer)
		r.Patch("/customers/{id}", ah.UpdateCustomer)

		// Public showcase + PDPA consent (migration 046). Separate endpoint
		// from the generic PATCH so every consent change writes a discrete
		// audit_log row (resource_type='customer_showcase').
		r.Patch("/customers/{id}/showcase", ah.UpdateShowcase)
		r.Get("/customers/{id}/showcase/audit", ah.ListShowcaseAudit)

		// Customer contacts
		r.Get("/customers/{id}/contacts", ah.ListContacts)
		r.Post("/customers/{id}/contacts", ah.CreateContact)
		r.Post("/customers/{id}/contacts/{contactId}/disable", ah.DisableContact)
		r.Post("/customers/{id}/contacts/{contactId}/enable", ah.EnableContact)

		// Staff-on-behalf ticket creation.
		r.Post("/customers/{id}/tickets", ah.CreateTicketForCustomer)

		// Customer assets — domains.
		r.Get("/customers/{id}/domains", assets.AdminListDomains)
		r.Post("/customers/{id}/domains", assets.AdminCreateDomain)
		r.Patch("/customers/{id}/domains/{domainId}", assets.AdminUpdateDomain)
		r.Delete("/customers/{id}/domains/{domainId}", assets.AdminDeleteDomain)

		// Customer assets — SLA contracts.
		r.Get("/customers/{id}/sla", assets.AdminListSLA)
		r.Post("/customers/{id}/sla", assets.AdminCreateSLA)
		r.Patch("/customers/{id}/sla/{slaId}", assets.AdminUpdateSLA)
		r.Delete("/customers/{id}/sla/{slaId}", assets.AdminDeleteSLA)

		// Tickets (admin queue)
		r.Get("/tickets", ah.ListTickets)
		r.Get("/tickets/stats", ah.TicketStats)
		r.Get("/tickets/{id}", ah.GetTicket)
		r.Patch("/tickets/{id}", ah.UpdateTicket)
		r.Get("/tickets/{id}/messages", ah.ListAllMessages)
		r.Post("/tickets/{id}/messages", ah.AddMessage)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("customer-api listening on :%s", cfg.ServicePort)
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
