package config

import (
	"os"
	"strings"
)

type Config struct {
	ServicePort      string
	DatabaseURL      string
	CORSAllowedHosts []string
}

func Load() Config {
	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8001"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		CORSAllowedHosts: splitCSV(getenv("CORS_ALLOWED_ORIGINS", "*")),
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
