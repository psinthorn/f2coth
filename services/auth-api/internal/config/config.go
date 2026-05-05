package config

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServicePort      string
	DatabaseURL      string
	JWTSecret        string
	JWTIssuer        string
	JWTTTL           time.Duration
	RefreshTTL       time.Duration
	BcryptCost       int
	CORSAllowedHosts []string
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

	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8004"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		JWTSecret:        secret,
		JWTIssuer:        getenv("JWT_ISSUER", "f2.co.th"),
		JWTTTL:           time.Duration(jwtTTLMin) * time.Minute,
		RefreshTTL:       time.Duration(refTTLHr) * time.Hour,
		BcryptCost:       bcryptCost,
		CORSAllowedHosts: cors,
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
