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

	"github.com/f2cothai/f2-website/services/ai-chat-api/internal/claude"
	"github.com/f2cothai/f2-website/services/ai-chat-api/internal/config"
	"github.com/f2cothai/f2-website/services/ai-chat-api/internal/handlers"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.ChatHandler{
		DB:     pool,
		Cfg:    cfg,
		Claude: claude.NewClient(cfg.AnthropicAPIKey),
	}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(40 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"ai-chat-api"}`))
	})

	r.Route("/api/chat", func(r chi.Router) {
		r.Post("/messages", h.Send)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("ai-chat-api listening on :%s", cfg.ServicePort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)

	// PDPA anonymisation janitor: redact PII from chat sessions older than 90 days
	// (expires_at = updated_at + 90d, per migration 015). Deletes all chat messages
	// for the session (user content is PII), then redacts session metadata.
	// Runs immediately at startup then every 24 h.
	anonCtx, anonCancel := context.WithCancel(context.Background())
	defer anonCancel()
	go func() {
		anonymise := func() {
			ctx, cancel := context.WithTimeout(anonCtx, 60*time.Second)
			defer cancel()
			// Step 1: delete message content (contains user-typed PII).
			msgTag, err := pool.Exec(ctx, `
				DELETE FROM chat_messages
				WHERE session_id IN (
					SELECT id FROM chat_sessions
					WHERE expires_at < NOW() AND anonymised_at IS NULL
				)`)
			if err != nil {
				log.Printf("pdpa-janitor: delete chat messages: %v", err)
				return
			}
			// Step 2: redact session-level metadata.
			sesTag, err := pool.Exec(ctx, `
				UPDATE chat_sessions SET
					visitor_id    = '[redacted]',
					user_agent    = NULL,
					ip_address    = NULL,
					referrer      = NULL,
					landing_path  = NULL,
					anonymised_at = NOW()
				WHERE expires_at < NOW() AND anonymised_at IS NULL`)
			if err != nil {
				log.Printf("pdpa-janitor: anonymise sessions: %v", err)
			} else {
				log.Printf("pdpa-janitor: anonymised %d chat sessions, deleted %d messages",
					sesTag.RowsAffected(), msgTag.RowsAffected())
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
