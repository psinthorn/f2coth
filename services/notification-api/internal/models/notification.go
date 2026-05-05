package models

import (
	"encoding/json"
	"time"
)

type Notification struct {
	ID            string          `json:"id"`
	Channel       string          `json:"channel"`
	Template      string          `json:"template"`
	ToAddress     string          `json:"to_address"`
	CCAddress     *string         `json:"cc_address,omitempty"`
	BCCAddress    *string         `json:"bcc_address,omitempty"`
	Subject       *string         `json:"subject,omitempty"`
	Payload       json.RawMessage `json:"payload"`
	Status        string          `json:"status"`
	Attempts      int             `json:"attempts"`
	LastError     *string         `json:"last_error,omitempty"`
	RelatedLeadID *string         `json:"related_lead_id,omitempty"`
	ScheduledAt   time.Time       `json:"scheduled_at"`
	SentAt        *time.Time      `json:"sent_at,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}
