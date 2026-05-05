package models

import "time"

type ChatSession struct {
	ID             string     `json:"id"`
	VisitorID      string     `json:"visitor_id"`
	LeadID         *string    `json:"lead_id,omitempty"`
	Locale         string     `json:"locale"`
	StartedAt      time.Time  `json:"started_at"`
	LastActivityAt time.Time  `json:"last_activity_at"`
	EndedAt        *time.Time `json:"ended_at,omitempty"`
}

type ChatMessage struct {
	ID           string    `json:"id"`
	SessionID    string    `json:"session_id"`
	Role         string    `json:"role"`
	Content      string    `json:"content"`
	Model        *string   `json:"model,omitempty"`
	InputTokens  *int      `json:"input_tokens,omitempty"`
	OutputTokens *int      `json:"output_tokens,omitempty"`
	LatencyMS    *int      `json:"latency_ms,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
