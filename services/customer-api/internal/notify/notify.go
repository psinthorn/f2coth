// Package notify is a thin client that POSTs notification jobs to
// notification-api. We never block the caller on the network call:
// notify.Send returns immediately after enqueuing in a goroutine.
package notify

import (
	"bytes"
	"context"
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
	Locale        string         `json:"locale,omitempty"` // "en" | "th", default en
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

// Send enqueues a notification asynchronously. Best-effort — if the
// notification-api is down we log and move on. Customers and staff
// see the in-portal record either way.
func (c *Client) Send(j Job) {
	if c == nil || c.BaseURL == "" || j.ToAddress == "" || j.Template == "" {
		return
	}
	if j.Channel == "" {
		j.Channel = "email"
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
