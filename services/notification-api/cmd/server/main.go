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

	"github.com/f2cothai/f2-website/services/notification-api/internal/config"
	"github.com/f2cothai/f2-website/services/notification-api/internal/handlers"
)

func main() {
	cfg := config.Load()

	pool, err := pgxpool.New(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("pgx pool: %v", err)
	}
	defer pool.Close()

	h := &handlers.NotificationHandler{DB: pool, Cfg: cfg}

	workerCtx, cancelWorker := context.WithCancel(context.Background())
	go h.StartWorker(workerCtx)

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(15 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORSAllowedHosts,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"notification-api"}`))
	})

	r.Route("/api/notifications", func(r chi.Router) {
		r.Post("/", h.Enqueue)
	})

	srv := &http.Server{
		Addr:              ":" + cfg.ServicePort,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("notification-api listening on :%s", cfg.ServicePort)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	cancelWorker()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
