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

	"github.com/f2cothai/f2-website/services/payment-api/internal/config"
	"github.com/f2cothai/f2-website/services/payment-api/internal/handlers"
	authmw "github.com/f2cothai/f2-website/services/payment-api/internal/middleware"
	"github.com/f2cothai/f2-website/services/payment-api/internal/notify"
	"github.com/f2cothai/f2-website/services/payment-api/internal/paypal"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	notifier := notify.NewClient(cfg.NotificationAPIURL)
	// PayPal client resolves both mode and credentials from the DB on
	// every call — admins can rotate keys + flip modes from the admin UI
	// without restarting payment-api.
	pp := paypal.New(
		func(ctx context.Context) string { return handlers.GetMethodMode(ctx, pool, "paypal") },
		func(ctx context.Context, env paypal.Environment) paypal.CredSet {
			return handlers.GetPayPalCreds(ctx, pool, env)
		},
	)

	ih := &handlers.InvoiceHandler{DB: pool, Cfg: cfg, Notify: notifier}
	ph := &handlers.PaymentHandler{DB: pool, Cfg: cfg, Notify: notifier, PayPal: pp}
	mh := &handlers.MethodHandler{DB: pool, Cfg: cfg}
	wh := &handlers.WebhookHandler{DB: pool, Cfg: cfg, Notify: notifier, PayPal: pp}
	sh := &handlers.SandboxHandler{DB: pool, Cfg: cfg, Notify: notifier, PayPal: pp}
	slh := &handlers.SlipHandler{DB: pool, Cfg: cfg}
	bph := &handlers.BillingProfileHandler{DB: pool, Cfg: cfg}
	subh := &handlers.SubscriptionHandler{DB: pool, Cfg: cfg}
	couponh := &handlers.CouponHandler{DB: pool}
	renh := &handlers.RenewalsHandler{DB: pool}
	rfh := &handlers.RefundHandler{DB: pool, Cfg: cfg, Notify: notifier, PayPal: pp}
	dh := &handlers.DashboardHandler{DB: pool, Cfg: cfg}
	cath := &handlers.CatalogHandler{DB: pool, Cfg: cfg}
	bih := &handlers.BankImportHandler{DB: pool, Cfg: cfg}
	bulk := &handlers.BulkOpsHandler{DB: pool, Cfg: cfg, Notify: notifier, InvoiceHandler: ih}
	wah := &handlers.WebhookAdminHandler{DB: pool, Cfg: cfg, Notify: notifier, PayPal: pp}
	exph := &handlers.ExportHandler{DB: pool, Cfg: cfg}
	pdfh := &handlers.InvoicePDFHandler{DB: pool, Cfg: cfg}
	dispute := &handlers.DisputeHandler{DB: pool, Cfg: cfg}
	anh := &handlers.AnalyticsHandler{DB: pool, Cfg: cfg}
	susp := &handlers.SuspensionHandler{DB: pool, Cfg: cfg}

	// Wire the pool so reconcileInvoice can fire the auto-restore
	// goroutine when an invoice flips to paid.
	handlers.SetAutoRestorePool(pool)

	// Background scheduler — flips overdue invoices + generates
	// subscription invoices + dispatches reminders every 5 minutes.
	sched := handlers.NewScheduler(pool, cfg, notifier)
	sched.Start()
	defer sched.Stop()

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"payment-api"}`))
	})

	r.Route("/api/payment", func(r chi.Router) {
		// Public
		r.Get("/methods", mh.PublicList)
		r.Post("/webhooks/paypal", wh.HandlePayPal)
		r.Get("/sandbox/status", sh.PublicStatus)

		// Customer portal — aud=customer
		r.Route("/portal", func(r chi.Router) {
			r.Use(authmw.RequireJWT(cfg.JWTSecret))
			r.Use(authmw.RequireAudience("customer"))

			r.Get("/invoices", ih.PortalList)
			r.Get("/invoices/{id}", ih.PortalGet)
			r.Post("/invoices/{id}/pay", ph.PortalInit)
			r.Post("/payments/{payID}/slip", ph.PortalUploadSlip)
			r.Post("/payments/{payID}/slip-file", slh.PortalUpload)
			r.Post("/payments/{payID}/paypal/capture", ph.PortalCapturePayPal)
			r.Get("/slips/{fileID}", slh.Serve)

			// Customer self-service: edit own tax-invoice billing profile.
			r.Get("/billing-profile", bph.PortalGet)
			r.Put("/billing-profile", bph.PortalUpsert)

			// Server-rendered invoice PDF (Thai-font-aware).
			r.Get("/invoices/{id}/pdf", pdfh.PortalDownload)

			// Active service suspensions (drives portal banner).
			r.Get("/suspensions", susp.PortalList)

			// Self-service recurring services: view own subscriptions and
			// cancel at period end.
			r.Get("/subscriptions", subh.PortalList)
			r.Post("/subscriptions/{id}/cancel", subh.PortalCancel)
		})

		// Admin — aud=staff, role admin|editor
		r.Route("/admin", func(r chi.Router) {
			r.Use(authmw.RequireJWT(cfg.JWTSecret))
			r.Use(authmw.RequireAudience("staff"))
			r.Use(authmw.RequireRole("admin", "editor"))

			r.Get("/invoices", ih.AdminList)
			r.Post("/invoices", ih.AdminCreate)
			r.Get("/invoices/{id}", ih.AdminGet)
			r.Patch("/invoices/{id}", ih.AdminUpdate)
			r.Post("/invoices/{id}/issue", ih.AdminIssue)
			r.Post("/invoices/{id}/void", ih.AdminVoid)
			// Bulk actions for the admin invoice list page.
			r.Post("/invoices/bulk-issue", bulk.AdminBulkIssue)
			r.Post("/invoices/bulk-void", bulk.AdminBulkVoid)

			r.Get("/payments", ph.AdminList)
			r.Post("/payments/{id}/verify", ph.AdminVerify)
			r.Post("/payments/{id}/reject", ph.AdminReject)

			r.Get("/methods", mh.AdminList)
			// PUT /methods/{method} now accepts a `mode` field — per-method
			// toggle. Admin-role required since a flip to 'production'
			// enables real money movement for that method.
			r.With(authmw.RequireRole("admin")).Put("/methods/{method}", mh.AdminUpdate)

			// Sandbox helpers — each one re-checks the relevant method's
			// mode at request time. Toggles take effect within the 5s
			// in-process cache without restarting.
			r.Get("/sandbox/invoices", sh.AdminList)
			r.Get("/sandbox/payments", sh.AdminListPayments)
			r.Post("/sandbox/seed", sh.AdminSeed)
			r.Post("/sandbox/payments/{id}/complete", sh.AdminCompletePayment)
			r.Post("/sandbox/payments/{id}/simulate-webhook", sh.AdminSimulateWebhook)
			r.Post("/sandbox/purge", sh.AdminPurge)

			// Slips (admin can view any customer's slip).
			r.Get("/slips/{fileID}", slh.Serve)

			// Customer billing profile (tax-invoice metadata).
			r.Get("/customers/{customerID}/billing-profile", bph.AdminGet)
			r.Put("/customers/{customerID}/billing-profile", bph.AdminUpsert)

			// Subscriptions (recurring billing).
			r.Get("/subscriptions", subh.AdminList)
			r.Post("/subscriptions", subh.AdminCreate)
			r.Patch("/subscriptions/{id}/status", subh.AdminUpdateStatus)
			r.Patch("/subscriptions/{id}/plan", subh.AdminChangePlan)
			r.Get("/coupons", couponh.AdminList)
			r.Post("/coupons", couponh.AdminCreate)
			r.Patch("/coupons/{id}/active", couponh.AdminSetActive)
			r.Get("/renewals", renh.AdminRenewals)

			// Refunds.
			r.Get("/refunds", rfh.AdminList)
			r.Post("/refunds", rfh.AdminCreate)

			// Dashboard summary widget data.
			r.Get("/dashboard/summary", dh.AdminSummary)

			// Product catalog for subscription create form.
			r.Get("/catalog", cath.AdminList)

			// Bank statement reconciliation (CSV upload + auto-match).
			r.Get("/bank-imports", bih.AdminList)
			r.Post("/bank-imports", bih.AdminUpload)
			r.Get("/bank-imports/{id}", bih.AdminGet)
			r.Post("/bank-imports/{id}/apply", bih.AdminApply)

			// Webhook event browser.
			r.Get("/webhooks", wah.AdminList)
			r.Get("/webhooks/{id}", wah.AdminGet)
			r.Post("/webhooks/{id}/replay", wah.AdminReplay)

			// CSV exports for the accounting team.
			r.Get("/exports/invoices.csv", exph.AdminInvoicesCSV)
			r.Get("/exports/payments.csv", exph.AdminPaymentsCSV)

			// Server-rendered invoice PDF (admin can download any).
			r.Get("/invoices/{id}/pdf", pdfh.AdminDownload)

			// Disputes / chargebacks (driven by PayPal webhooks).
			r.Get("/disputes", dispute.AdminList)

			// Analytics — MRR, AR aging, subscription churn.
			r.Get("/analytics/mrr", anh.AdminMRR)
			r.Get("/analytics/aging", anh.AdminAging)
			r.Get("/analytics/churn", anh.AdminChurn)

			// Service suspensions (driven by dunning scheduler).
			r.Get("/suspensions", susp.AdminList)
			r.Post("/suspensions/{id}/restore", susp.AdminRestore)
			r.Post("/suspensions/{id}/override", susp.AdminOverride)
		})
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("payment-api listening on :%s", cfg.ServicePort)
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
