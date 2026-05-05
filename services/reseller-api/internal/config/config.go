package config

import (
	"os"
	"strings"
	"time"
)

type Config struct {
	ServicePort      string
	DatabaseURL      string
	JWTSecret        string
	CORSAllowedHosts []string

	// ResellerClub. If AuthUserID + APIKey are empty, the registry layer
	// falls back to a deterministic mock so dev works without real creds.
	// BaseURL defaults to the sandbox endpoint (test.httpapi.com).
	RCBaseURL    string
	RCAuthUserID string
	RCAPIKey     string

	// HTTP client timeout for outbound registry calls.
	OutboundTimeout time.Duration

	// Cache TTL for availability lookups.
	CacheTTL time.Duration
}

func Load() Config {
	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8007"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		JWTSecret:        getenv("JWT_SECRET", ""),
		CORSAllowedHosts: splitCSV(getenv("CORS_ALLOWED_ORIGINS", "*")),

		RCBaseURL:    getenv("RESELLERCLUB_BASE_URL", "https://test.httpapi.com"),
		RCAuthUserID: getenv("RESELLERCLUB_AUTH_USERID", ""),
		RCAPIKey:     getenv("RESELLERCLUB_API_KEY", ""),

		OutboundTimeout: parseDuration("RESELLER_OUTBOUND_TIMEOUT", 8*time.Second),
		CacheTTL:        parseDuration("RESELLER_CACHE_TTL", 15*time.Minute),
	}
}

func (c Config) RCConfigured() bool {
	return c.RCAuthUserID != "" && c.RCAPIKey != ""
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func parseDuration(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
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
