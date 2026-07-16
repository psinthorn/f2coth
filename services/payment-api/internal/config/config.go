package config

import (
	"log"
	"os"
	"sort"
	"strconv"
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

	// RenewalReminderOffsets are the "days before next_billing_at" tiers
	// at which the scheduler sends advance renewal heads-ups. Sorted
	// descending, de-duplicated, positive-only. Empty disables the pass
	// (kill-switch). Tiers should stay above the 7-day invoice-generation
	// lead so they don't overlap the invoice_issued email.
	RenewalReminderOffsets []int

	// Domain renewal engine (Phase 2, expiry-date driven off
	// customer_domains.expires_at).
	//   DomainRenewalNoticeOffsets — "days before expiry" customer notice
	//     tiers (descending, positive). Empty disables domain notices.
	//   DomainRenewalInvoiceLead — issue the renewal invoice this many
	//     days before expiry (auto_renew domains only). <=0 disables
	//     auto-invoicing.
	//   DomainPostExpiryNoticeDays — send the "domain expired" notice this
	//     many days after expiry. <=0 disables the post-expiry notice.
	//   DomainMaxRecoveryDays — keep issuing a (fee-loaded) renewal invoice
	//     up to this many days AFTER expiry, so lapsed domains in their
	//     grace/redemption window still get billed for recovery.
	DomainRenewalNoticeOffsets []int
	DomainRenewalInvoiceLead   int
	DomainPostExpiryNoticeDays int
	DomainMaxRecoveryDays      int

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

		RenewalReminderOffsets: parseOffsets(getenv("RENEWAL_REMINDER_OFFSETS", "30,14")),

		DomainRenewalNoticeOffsets: parseOffsets(getenv("DOMAIN_RENEWAL_NOTICE_OFFSETS", "60,30,7")),
		DomainRenewalInvoiceLead:   parseIntEnv("DOMAIN_RENEWAL_INVOICE_LEAD", 14),
		DomainPostExpiryNoticeDays: parseIntEnv("DOMAIN_POST_EXPIRY_NOTICE_DAYS", 1),
		DomainMaxRecoveryDays:      parseIntEnv("DOMAIN_MAX_RECOVERY_DAYS", 45),
	}
}

// parseIntEnv reads an integer env var, falling back to def on missing or
// unparseable input.
func parseIntEnv(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return n
		}
	}
	return def
}

// parseOffsets turns a CSV like "30,14" into a descending, de-duplicated,
// positive-only []int. Invalid or non-positive entries are dropped; an
// empty/blank input yields nil, which disables the renewal-reminder pass.
func parseOffsets(s string) []int {
	seen := map[int]bool{}
	var out []int
	for _, p := range strings.Split(s, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err != nil || n <= 0 || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(out)))
	return out
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
