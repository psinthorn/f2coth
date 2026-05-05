package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ServicePort      string
	DatabaseURL      string
	AnthropicAPIKey  string
	AnthropicModel   string
	AnthropicMaxTok  int
	CORSAllowedHosts []string
}

func Load() Config {
	maxTok, _ := strconv.Atoi(getenv("ANTHROPIC_MAX_TOKENS", "1024"))
	return Config{
		ServicePort:      getenv("SERVICE_PORT", "8003"),
		DatabaseURL:      getenv("DATABASE_URL", ""),
		AnthropicAPIKey:  getenv("ANTHROPIC_API_KEY", ""),
		AnthropicModel:   getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
		AnthropicMaxTok:  maxTok,
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
