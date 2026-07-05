// Package notify is a thin client that POSTs notification jobs to
// notification-api. Mirrors services/customer-api/internal/notify.
package notify

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

type Job struct {
	Channel       string         `json:"channel"`
	Template      string         `json:"template"`
	ToAddress     string         `json:"to_address"`
	Payload       map[string]any `json:"payload"`
	RelatedLeadID string         `json:"related_lead_id,omitempty"`
	Locale        string         `json:"locale,omitempty"`
	// Attachments are smuggled inside Payload under `_attachments` so
	// notification-api can pick them up without a schema change.
	Attachments []Attachment `json:"-"`
}

// Attachment is the in-memory shape used by callers; we base64-encode
// here and inject into payload._attachments before POSTing.
type Attachment struct {
	Filename    string
	ContentType string
	Content     []byte
}

type Client struct {
	BaseURL string
	HTTP    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: baseURL,
		HTTP:    &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *Client) Send(j Job) {
	if c == nil || c.BaseURL == "" || j.ToAddress == "" || j.Template == "" {
		return
	}
	if j.Channel == "" {
		j.Channel = "email"
	}
	if len(j.Attachments) > 0 {
		// Encode and tuck under payload._attachments — notification-api
		// extracts this key, decodes each item, and assembles a
		// multipart/mixed MIME message.
		if j.Payload == nil {
			j.Payload = map[string]any{}
		}
		atts := make([]map[string]any, 0, len(j.Attachments))
		for _, a := range j.Attachments {
			atts = append(atts, map[string]any{
				"filename":     a.Filename,
				"content_type": a.ContentType,
				"content_b64":  base64.StdEncoding.EncodeToString(a.Content),
			})
		}
		j.Payload["_attachments"] = atts
	}
	go func() {
		body, err := json.Marshal(j)
		if err != nil {
			log.Printf("notify: marshal: %v", err)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			c.BaseURL+"/api/notifications/", bytes.NewReader(body))
		if err != nil {
			log.Printf("notify: req: %v", err)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.HTTP.Do(req)
		if err != nil {
			log.Printf("notify: do: %v", err)
			return
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 400 {
			log.Printf("notify: %s → %d", j.Template, resp.StatusCode)
		}
	}()
}
