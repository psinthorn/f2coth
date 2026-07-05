package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	ServicePort       string
	DatabaseURL       string
	AnthropicAPIKey   string
	AnthropicBaseURL  string
	OllamaBaseURL     string
	VoyageAPIKey      string
	JWTSecret         string
	CORSAllowedHosts  []string
	BudgetAlertUSD    float64
	// RoutingRefreshSeconds controls how often the in-memory routing
	// cache is refreshed from ai_routing. Admin toggles take effect at
	// most this many seconds after PATCH.
	RoutingRefreshSeconds int
}

func Load() Config {
	budget, _ := strconv.ParseFloat(getenv("AI_BUDGET_ALERT_USD", "150"), 64)
	refresh, _ := strconv.Atoi(getenv("AI_ROUTING_REFRESH_SECONDS", "30"))
	return Config{
		ServicePort:           getenv("SERVICE_PORT", "8009"),
		DatabaseURL:           getenv("DATABASE_URL", ""),
		AnthropicAPIKey:       getenv("ANTHROPIC_API_KEY", ""),
		AnthropicBaseURL:      getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
		OllamaBaseURL:         getenv("OLLAMA_BASE_URL", "http://host.docker.internal:11434"),
		VoyageAPIKey:          getenv("VOYAGE_API_KEY", ""),
		JWTSecret:             getenv("JWT_SECRET", ""),
		CORSAllowedHosts:      splitCSV(getenv("CORS_ALLOWED_ORIGINS", "*")),
		BudgetAlertUSD:        budget,
		RoutingRefreshSeconds: refresh,
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
