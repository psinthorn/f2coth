package config

import (
	"os"
	"strings"
)

type Config struct {
	ServicePort      string
	DatabaseURL      string
	JWTSecret        string
	CORSAllowedHosts []string
	// TokenPepper is mixed into enrollment-token hashes so a DB leak alone
	// can't be used to forge a valid ingest token. Shared with nothing else.
	TokenPepper string
	// DocgenURL is the internal base URL of the docgen service (docx/pdf).
	DocgenURL string
	// NotificationURL is notification-api's internal base URL, used to email
	// finished handover reports without giving AssetHub its own SMTP path.
	NotificationURL string
	// ReportsDir is the volume-mounted directory where generated handover
	// files (xlsx/pdf/docx) are stored. Bytes never go in Postgres.
	ReportsDir string
	// BaseURL is the public origin, used to build enrollment/collector hints.
	BaseURL string
}

func Load() Config {
	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8010"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		JWTSecret:        getenv("JWT_SECRET", ""),
		CORSAllowedHosts: splitCSV(getenv("CORS_ALLOWED_ORIGINS", "*")),
		TokenPepper:      getenv("TOKEN_PEPPER", ""),
		DocgenURL:        getenv("DOCGEN_URL", "http://docgen:8080"),
		NotificationURL:  getenv("NOTIFICATION_API_URL", "http://notification-api:8005"),
		ReportsDir:       getenv("REPORTS_DIR", "/data/reports"),
		BaseURL:          getenv("BASE_URL", "http://localhost"),
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
