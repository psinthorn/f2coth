package providers

// Ollama HTTP client — talks to a local Ollama daemon (default port
// 11434 on the host Mac). Supports both generation (chat) and
// embeddings (BGE-m3 per pilot decision).
//
// Ollama runs on the HOST rather than in the docker network so that
// Metal-accelerated GPU access on Apple Silicon works. The container
// reaches it via host.docker.internal:11434 (docker-compose maps
// host-gateway on Linux to keep the compose file portable).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

type OllamaClient struct {
	BaseURL string
	HTTP    *http.Client
}

func NewOllamaClient(baseURL string) *OllamaClient {
	if baseURL == "" {
		baseURL = "http://host.docker.internal:11434"
	}
	return &OllamaClient{
		BaseURL: baseURL,
		// Local model inference can be slow on first token when the
		// model is cold-loaded — 3 minutes is a generous but not
		// unreasonable ceiling for a 32B model on M-series Metal.
		HTTP: &http.Client{Timeout: 180 * time.Second},
	}
}

func (c *OllamaClient) Name() string { return "ollama" }

// ---------- Generation ----------

type ollamaChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type ollamaChatOptions struct {
	Temperature float64 `json:"temperature,omitempty"`
	NumPredict  int     `json:"num_predict,omitempty"`
}
type ollamaChatReq struct {
	Model    string              `json:"model"`
	Messages []ollamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
	Options  ollamaChatOptions   `json:"options,omitempty"`
}
type ollamaChatResp struct {
	Model            string            `json:"model"`
	Message          ollamaChatMessage `json:"message"`
	Done             bool              `json:"done"`
	DoneReason       string            `json:"done_reason"`
	PromptEvalCount  int               `json:"prompt_eval_count"`  // input tokens
	EvalCount        int               `json:"eval_count"`         // output tokens
}

func (c *OllamaClient) Generate(ctx context.Context, req GenerateRequest) (*GenerateResult, error) {
	if c.BaseURL == "" {
		return nil, ErrNotConfigured
	}

	msgs := make([]ollamaChatMessage, 0, len(req.Messages)+1)
	// System prompt is passed as a role='system' message — Ollama's chat
	// endpoint takes this natively.
	if req.System != "" {
		msgs = append(msgs, ollamaChatMessage{Role: "system", Content: req.System})
	}
	for _, m := range req.Messages {
		msgs = append(msgs, ollamaChatMessage{Role: m.Role, Content: m.Content})
	}

	body, err := json.Marshal(ollamaChatReq{
		Model:    req.Model,
		Messages: msgs,
		Stream:   false,
		Options: ollamaChatOptions{
			Temperature: req.Temperature,
			NumPredict:  defaultInt(req.MaxTokens, 1024),
		},
	})
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, string(b))
	}

	var parsed ollamaChatResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	return &GenerateResult{
		Text:         parsed.Message.Content,
		Model:        parsed.Model,
		InputTokens:  parsed.PromptEvalCount,
		OutputTokens: parsed.EvalCount,
		LatencyMS:    int(time.Since(start) / time.Millisecond),
		FinishReason: parsed.DoneReason,
	}, nil
}

// ---------- Embeddings ----------

type ollamaEmbedReq struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}
type ollamaEmbedResp struct {
	Model      string      `json:"model"`
	Embeddings [][]float32 `json:"embeddings"`
	// Ollama returns prompt_eval_count on embed responses too.
	PromptEvalCount int `json:"prompt_eval_count"`
}

func (c *OllamaClient) Embed(ctx context.Context, req EmbedRequest) (*EmbedResult, error) {
	if c.BaseURL == "" {
		return nil, ErrNotConfigured
	}
	body, err := json.Marshal(ollamaEmbedReq{Model: req.Model, Input: req.Texts})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/api/embed", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	start := time.Now()
	resp, err := c.HTTP.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("ollama embed %d: %s", resp.StatusCode, string(b))
	}
	var parsed ollamaEmbedResp
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	return &EmbedResult{
		Vectors:     parsed.Embeddings,
		Model:       parsed.Model,
		InputTokens: parsed.PromptEvalCount,
		LatencyMS:   int(time.Since(start) / time.Millisecond),
	}, nil
}
