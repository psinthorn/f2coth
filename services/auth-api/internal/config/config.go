package config

import (
	"crypto/sha256"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServicePort        string
	DatabaseURL        string
	JWTSecret          string
	JWTIssuer          string
	JWTTTL             time.Duration
	RefreshTTL         time.Duration
	BcryptCost         int
	CORSAllowedHosts   []string
	NotificationAPIURL string
	PrivacyNotifyTo    string
	SiteURL            string
	MFAEncKey          [32]byte // AES-256 key for encrypting TOTP secrets at rest
}

func Load() Config {
	jwtTTLMin, _ := strconv.Atoi(getenv("JWT_TTL_MINUTES", "60"))
	refTTLHr, _ := strconv.Atoi(getenv("REFRESH_TTL_HOURS", "720"))
	bcryptCost, _ := strconv.Atoi(getenv("BCRYPT_COST", "12"))

	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		log.Fatal("auth-api: JWT_SECRET must be set and at least 32 characters long")
	}

	cors := splitCSV(getenv("CORS_ALLOWED_ORIGINS", ""))
	if len(cors) == 0 {
		log.Fatal("auth-api: CORS_ALLOWED_ORIGINS must be set (e.g. https://f2.co.th)")
	}
	for _, o := range cors {
		if o == "*" {
			log.Println("auth-api: WARNING — CORS_ALLOWED_ORIGINS contains '*'; lock this down before production")
		}
	}

	// AES-256 key for TOTP-secret encryption: explicit MFA_ENC_KEY if provided,
	// else derived from JWT_SECRET so dev works without extra config.
	mfaSeed := getenv("MFA_ENC_KEY", secret)
	mfaKey := sha256.Sum256([]byte(mfaSeed))

	return Config{
		ServicePort:        getenv("SERVICE_PORT", "8004"),
		DatabaseURL:        getenv("DATABASE_URL", ""),
		JWTSecret:          secret,
		MFAEncKey:          mfaKey,
		JWTIssuer:          getenv("JWT_ISSUER", "f2.co.th"),
		JWTTTL:             time.Duration(jwtTTLMin) * time.Minute,
		RefreshTTL:         time.Duration(refTTLHr) * time.Hour,
		BcryptCost:         bcryptCost,
		CORSAllowedHosts:   cors,
		NotificationAPIURL: getenv("NOTIFICATION_API_URL", "http://notification-api:8005"),
		PrivacyNotifyTo:    getenv("PRIVACY_NOTIFY_TO", "privacy@f2.co.th"),
		SiteURL:            getenv("SITE_URL", "https://f2.co.th"),
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
