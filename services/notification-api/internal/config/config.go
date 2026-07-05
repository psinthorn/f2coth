package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ServicePort      string
	DatabaseURL      string
	JWTSecret        string
	SMTPHost         string
	SMTPPort         int
	SMTPUser         string
	SMTPPassword     string
	SMTPFrom         string
	// Symmetric key used to encrypt smtp_settings.password_enc at rest
	// (pgcrypto). Non-empty in prod; empty in dev falls back to the
	// env-var SMTP password so local development keeps working.
	SMTPCryptKey     string
	CORSAllowedHosts []string
}

func Load() Config {
	port, _ := strconv.Atoi(getenv("SMTP_PORT", "587"))
	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8005"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		JWTSecret:        getenv("JWT_SECRET", ""),
		SMTPHost:         getenv("SMTP_HOST", ""),
		SMTPPort:         port,
		SMTPUser:         getenv("SMTP_USER", ""),
		SMTPPassword:     getenv("SMTP_PASSWORD", ""),
		SMTPFrom:         getenv("SMTP_FROM", "F2 Co., Ltd. <info@f2.co.th>"),
		SMTPCryptKey:     getenv("SMTP_CRYPT_KEY", ""),
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
