package providers

// Direct-HTTP Anthropic Messages API client. No SDK — the whole service
// stays small and predictable. Extends the ai-chat-api pattern with two
// things the orchestrator needs:
//   1) Prompt caching (cache_control on system prompt) — 90% cost cut on
//      RAG/agent workloads with a stable system prompt.
//   2) cache_read / cache_write token accounting into GenerateResult so
//      the usage logger can attribute cost accurately.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type AnthropicClient struct {
	APIKey  string
	BaseURL string
	HTTP    *http.Client
}

func NewAnthropicClient(apiKey, baseURL string) *AnthropicClient {
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	return &AnthropicClient{
		APIKey:  apiKey,
		BaseURL: baseURL,
		HTTP:    &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *AnthropicClient) Name() string { return "anthropic" }

// anthropicMessageContent supports both plain string and structured
// blocks. Structured is required when we mark a system prompt for
// caching via cache_control.
type anthropicSystemBlock struct {
	Type         string             `json:"type"` // "text"
	Text         string             `json:"text"`
	CacheControl *anthropicCacheCtl `json:"cache_control,omitempty"`
}
type anthropicCacheCtl struct {
	Type string `json:"type"` // "ephemeral"
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicReq struct {
	Model       string                 `json:"model"`
	MaxTokens   int                    `json:"max_tokens"`
	Temperature float64                `json:"temperature,omitempty"`
	System      []anthropicSystemBlock `json:"system,omitempty"`
	Messages    []anthropicMessage     `json:"messages"`
}

type anthropicUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

type anthropicContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type anthropicResp struct {
	ID           string             `json:"id"`
	Model        string             `json:"model"`
	Content      []anthropicContent `json:"content"`
	Usage        anthropicUsage     `json:"usage"`
	StopReason   string             `json:"stop_reason"`
}

func (c *AnthropicClient) Generate(ctx context.Context, req GenerateRequest) (*GenerateResult, error) {
	if c.APIKey == "" {
		return nil, ErrNotConfigured
	}

	// Convert generic messages to Anthropic wire format. A system
	// message in req.Messages is promoted to the top-level System
	// blocks (Anthropic doesn't accept role='system' in Messages).
	sysText := req.System
	msgs := make([]anthropicMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			if sysText == "" {
				sysText = m.Content
			} else {
				sysText += "\n\n" + m.Content
			}
			continue
		}
		msgs = append(msgs, anthropicMessage{Role: m.Role, Content: m.Content})
	}

	var sysBlocks []anthropicSystemBlock
	if sysText != "" {
		blk := anthropicSystemBlock{Type: "text", Text: sysText}
		if req.EnablePromptCache {
			// Marking the system prompt as cacheable is the single
			// biggest cost win for stable-prompt workloads (RAG,
			// agent loops with a fixed persona). 5-minute cache TTL
			// on Anthropic's side.
			blk.CacheControl = &anthropicCacheCtl{Type: "ephemeral"}
		}
		sysBlocks = []anthropicSystemBlock{blk}
	}

	body, err := json.Marshal(anthropicReq{
		Model:       req.Model,
		MaxTokens:   defaultInt(req.MaxTokens, 1024),
		Temperature: req.Temperature,
		System:      sysBlocks,
		Messages:    msgs,
	})
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	start := time.Now()
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("anthropic %d: %s", resp.StatusCode, string(b))
	}

	var parsed anthropicResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	var text string
	for _, blk := range parsed.Content {
		if blk.Type == "text" {
			text += blk.Text
		}
	}
	return &GenerateResult{
		Text:             text,
		Model:            parsed.Model,
		InputTokens:      parsed.Usage.InputTokens,
		OutputTokens:     parsed.Usage.OutputTokens,
		CacheReadTokens:  parsed.Usage.CacheReadInputTokens,
		CacheWriteTokens: parsed.Usage.CacheCreationInputTokens,
		LatencyMS:        int(time.Since(start) / time.Millisecond),
		FinishReason:     parsed.StopReason,
	}, nil
}

func defaultInt(v, def int) int {
	if v <= 0 {
		return def
	}
	return v
}
