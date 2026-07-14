package config

import (
	"os"
	"strconv"
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

	// Required for live ResellerClub Register. With creds set but these
	// missing, the place endpoint returns a clear "set ENV_VAR_X" error
	// rather than failing at the registry call.
	RCDefaultCustomerID string
	RCDefaultContactID  string
	RCDefaultNS1        string
	RCDefaultNS2        string

	// HTTP client timeout for outbound registry calls.
	OutboundTimeout time.Duration

	// Cache TTL for availability lookups.
	CacheTTL time.Duration

	// Registrar sync worker (Phase 3). SyncMode: "off" (default — inert),
	// "notify" (alert on expiry drift, don't overwrite), "write" (update
	// customer_domains.expires_at from the registry). SyncInterval is the
	// tick + per-domain re-sync staleness; SyncBatch caps domains per tick
	// to throttle registrar calls.
	SyncMode     string
	SyncInterval time.Duration
	SyncBatch    int

	// Support wiring for the sync worker's drift alerts.
	NotificationAPIURL string
	BillingNotifyTo    string
	AdminBaseURL       string
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

		RCDefaultCustomerID: getenv("RESELLERCLUB_DEFAULT_CUSTOMER_ID", ""),
		RCDefaultContactID:  getenv("RESELLERCLUB_DEFAULT_CONTACT_ID", ""),
		RCDefaultNS1:        getenv("RESELLERCLUB_DEFAULT_NS1", ""),
		RCDefaultNS2:        getenv("RESELLERCLUB_DEFAULT_NS2", ""),

		OutboundTimeout: parseDuration("RESELLER_OUTBOUND_TIMEOUT", 8*time.Second),
		CacheTTL:        parseDuration("RESELLER_CACHE_TTL", 15*time.Minute),

		SyncMode:     strings.ToLower(getenv("RESELLER_SYNC_MODE", "off")),
		SyncInterval: parseDuration("RESELLER_SYNC_INTERVAL", 24*time.Hour),
		SyncBatch:    parseInt("RESELLER_SYNC_BATCH", 50),

		NotificationAPIURL: getenv("NOTIFICATION_API_URL", "http://notification-api:8005"),
		BillingNotifyTo:    getenv("BILLING_NOTIFY_TO", "billing@f2.co.th"),
		AdminBaseURL:       getenv("ADMIN_BASE_URL", "http://localhost"),
	}
}

func parseInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return def
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
