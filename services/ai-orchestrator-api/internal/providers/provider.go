// Package providers defines the interface that every AI backend must
// implement, plus the pricing table used to attribute per-request cost.
//
// A provider is any concrete engine that can generate tokens or produce
// embeddings — Anthropic API, Ollama (local), OpenAI, Voyage, and so on.
// Business logic (agents, RAG, chat) never touches a provider directly;
// it goes through router.Router which reads the ai_routing table and
// picks the right provider for the task.
package providers

import (
	"context"
	"fmt"
)

// GenerateRequest is the provider-neutral shape callers hand to any
// generate provider. Fields not applicable to a given backend (System
// prompt for a bare completion model, etc.) are ignored by that impl.
type GenerateRequest struct {
	Model       string
	System      string
	Messages    []Message
	MaxTokens   int
	Temperature float64
	// EnablePromptCache is honoured by providers that support it
	// (Anthropic). Local providers ignore.
	EnablePromptCache bool
}

type Message struct {
	Role    string `json:"role"`    // "user" | "assistant" | "system"
	Content string `json:"content"`
}

type GenerateResult struct {
	Text              string
	Model             string
	InputTokens       int
	OutputTokens      int
	CacheReadTokens   int
	CacheWriteTokens  int
	LatencyMS         int
	// FinishReason is a hint for callers ("stop", "length", "error", ...).
	FinishReason string
}

type EmbedRequest struct {
	Model string
	Texts []string
}

type EmbedResult struct {
	Vectors     [][]float32
	Model       string
	InputTokens int
	LatencyMS   int
}

// Generator implementations turn text into text (chat/completion).
type Generator interface {
	Generate(ctx context.Context, req GenerateRequest) (*GenerateResult, error)
	Name() string // provider identifier ("anthropic", "ollama", ...)
}

// Embedder implementations turn text into vectors.
type Embedder interface {
	Embed(ctx context.Context, req EmbedRequest) (*EmbedResult, error)
	Name() string
}

// ErrNotConfigured is returned when a provider is asked to do work but
// its credentials / endpoint are missing. The router treats this as a
// fallback trigger.
var ErrNotConfigured = fmt.Errorf("provider not configured")
