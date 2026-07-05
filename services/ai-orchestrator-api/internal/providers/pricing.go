package providers

// pricing.go — USD/token rates keyed by (provider, model). Used by the
// usage logger to attribute cost per request. When a rate is missing
// the cost recorded is 0 — better than crashing, and the row still
// contributes to the token count. Local providers (Ollama) resolve to
// zero rates because tokens have no marginal cash cost.
//
// Rates are per 1M tokens in USD, matching each vendor's published rate
// card in Q1 2026. Update as vendors adjust pricing.

// Rate holds per-1M-token USD rates for a model.
type Rate struct {
	InputPer1M         float64 // standard input tokens
	OutputPer1M        float64
	CacheReadPer1M     float64 // Anthropic prompt-cache read (usually 10% of input)
	CacheWritePer1M    float64 // Anthropic prompt-cache write (usually 125% of input)
}

// modelRates is the lookup table. Provider+model must be canonical
// lowercase to match how the router writes into ai_usage_log.
var modelRates = map[string]map[string]Rate{
	"anthropic": {
		// Q1 2026 published rates.
		"claude-opus-4-7": {
			InputPer1M: 15.00, OutputPer1M: 75.00,
			CacheReadPer1M: 1.50, CacheWritePer1M: 18.75,
		},
		"claude-sonnet-4-6": {
			InputPer1M: 3.00, OutputPer1M: 15.00,
			CacheReadPer1M: 0.30, CacheWritePer1M: 3.75,
		},
		"claude-haiku-4-5": {
			InputPer1M: 0.80, OutputPer1M: 4.00,
			CacheReadPer1M: 0.08, CacheWritePer1M: 1.00,
		},
		// Legacy fallbacks
		"claude-sonnet-4-6-20250929": {
			InputPer1M: 3.00, OutputPer1M: 15.00,
			CacheReadPer1M: 0.30, CacheWritePer1M: 3.75,
		},
	},
	"openai": {
		// Kept for future — not used in the seeded routing table.
		"gpt-4o-mini": {InputPer1M: 0.15, OutputPer1M: 0.60},
	},
	"voyage": {
		"voyage-3": {InputPer1M: 0.06},
	},
	// Local providers have no per-token cash cost.
	"ollama": {},
}

// CostUSD calculates USD cost for a single request. Unknown model
// resolves to zero cost — logs the row without crashing so admins can
// still see it (and update the pricing table if the vendor released a
// new model we haven't priced yet).
func CostUSD(provider, model string, inputTokens, outputTokens, cacheRead, cacheWrite int) float64 {
	rates, ok := modelRates[provider]
	if !ok {
		return 0
	}
	r, ok := rates[model]
	if !ok {
		return 0
	}
	// Anthropic accounting: cache_read tokens are BILLED SEPARATELY from
	// regular input (they don't double-count). Subtract from input to
	// avoid double-billing.
	regularIn := inputTokens - cacheRead - cacheWrite
	if regularIn < 0 {
		regularIn = 0
	}
	cost := (float64(regularIn) * r.InputPer1M / 1_000_000) +
		(float64(outputTokens) * r.OutputPer1M / 1_000_000) +
		(float64(cacheRead) * r.CacheReadPer1M / 1_000_000) +
		(float64(cacheWrite) * r.CacheWritePer1M / 1_000_000)
	return cost
}
