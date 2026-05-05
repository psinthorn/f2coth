package config

import (
	"log"
	"os"
	"strings"
)

type Config struct {
	ServicePort        string
	DatabaseURL        string
	NotificationAPIURL string
	SalesNotifyTo      string
	JWTSecret          string
	CORSAllowedHosts   []string
}

func Load() Config {
	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		log.Fatal("lead-api: JWT_SECRET must be set and at least 32 characters long")
	}

	cors := splitCSV(getenv("CORS_ALLOWED_ORIGINS", ""))
	if len(cors) == 0 {
		log.Fatal("lead-api: CORS_ALLOWED_ORIGINS must be set (e.g. https://f2.co.th)")
	}

	return Config{
		ServicePort:        getenv("SERVICE_PORT", "8002"),
		DatabaseURL:        getenv("DATABASE_URL", ""),
		NotificationAPIURL: getenv("NOTIFICATION_API_URL", "http://notification-api:8005"),
		SalesNotifyTo:      getenv("SALES_NOTIFY_TO", "sales@f2.co.th"),
		JWTSecret:          secret,
		CORSAllowedHosts:   cors,
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
