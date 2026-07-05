package config

import (
	"log"
	"os"
	"strings"
)

type Config struct {
	ServicePort        string
	DatabaseURL        string
	JWTSecret          string
	CORSAllowedHosts   []string
	NotificationAPIURL string
	BillingNotifyTo    string
	PortalBaseURL      string
	AdminBaseURL       string
	PublicBaseURL      string

	// PayPal credentials live in payment_methods_config.config (DB),
	// edited through /admin/payment-methods. No env-side knobs.
}

func Load() Config {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		log.Fatal("payment-api: JWT_SECRET must be set and at least 32 characters long")
	}
	cors := splitCSV(getenv("CORS_ALLOWED_ORIGINS", ""))
	if len(cors) == 0 {
		log.Fatal("payment-api: CORS_ALLOWED_ORIGINS must be set")
	}
	return Config{
		ServicePort:        getenv("SERVICE_PORT", "8008"),
		DatabaseURL:        getenv("DATABASE_URL", ""),
		JWTSecret:          secret,
		CORSAllowedHosts:   cors,
		NotificationAPIURL: getenv("NOTIFICATION_API_URL", "http://notification-api:8005"),
		BillingNotifyTo:    getenv("BILLING_NOTIFY_TO", "billing@f2.co.th"),
		PortalBaseURL:      getenv("PORTAL_BASE_URL", "http://localhost"),
		AdminBaseURL:       getenv("ADMIN_BASE_URL", "http://localhost"),
		PublicBaseURL:      getenv("PUBLIC_BASE_URL", "http://localhost"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
