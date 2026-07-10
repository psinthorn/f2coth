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
	// DocgenURL is the internal base URL of the docgen service (no Traefik).
	DocgenURL string
	// UploadsDir is the volume-mounted directory where generated docx/pdf and
	// signed scans are stored. Bytes never go in Postgres.
	UploadsDir string
}

func Load() Config {
	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8008"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		JWTSecret:        getenv("JWT_SECRET", ""),
		CORSAllowedHosts: splitCSV(getenv("CORS_ALLOWED_ORIGINS", "*")),
		DocgenURL:        getenv("DOCGEN_URL", "http://docgen:8080"),
		UploadsDir:       getenv("UPLOADS_DIR", "/data/uploads"),
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
