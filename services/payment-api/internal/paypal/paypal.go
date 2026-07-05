// Package paypal is a minimal client for PayPal Orders v2 + webhook
// signature verification. We deliberately avoid the official SDK to keep
// dependency surface small — only Create Order, Capture Order, and
// Verify Webhook Signature are needed.
//
// Each call resolves its environment (sandbox vs live) at call time via
// a getMode() callback wired in from the DB. This lets admins flip the
// PayPal method between sandbox/production from /admin/payment-methods
// without restarting the service. Two credential sets are loaded from
// env up-front; the active one is picked per call.
//
// Docs:
//
//	https://developer.paypal.com/docs/api/orders/v2/
//	https://developer.paypal.com/api/rest/webhooks/rest/#link-verifywebhooksignature
package paypal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Environment string

const (
	Sandbox Environment = "sandbox"
	Live    Environment = "live"
)

func (e Environment) baseURL() string {
	if e == Live {
		return "https://api-m.paypal.com"
	}
	return "https://api-m.sandbox.paypal.com"
}

// CredSet bundles the credentials for one environment.
type CredSet struct {
	ClientID     string
	ClientSecret string
	WebhookID    string
}

func (c CredSet) ok() bool {
	return c.ClientID != "" && c.ClientSecret != ""
}

// ModeReader returns the active PayPal mode — "sandbox" or "production".
// Wired from the DB so the toggle in /admin/payment-methods takes effect
// immediately. A nil reader defaults to sandbox.
type ModeReader func(ctx context.Context) string

// CredsReader returns the credentials for the requested environment.
// Wired to a DB-backed cache so admins can rotate credentials through
// /admin/payment-methods without restarting the service.
type CredsReader func(ctx context.Context, env Environment) CredSet

type Client struct {
	getMode  ModeReader
	getCreds CredsReader
	http     *http.Client

	mu     sync.Mutex
	tokens map[Environment]cachedToken
}

type cachedToken struct {
	value string
	exp   time.Time
	// Track which credential the token was minted for. When the admin
	// rotates client_id we mustn't keep using the old token.
	clientID string
}

// New constructs a client that resolves both mode + credentials at call
// time. A nil getCreds returns empty CredSets (Enabled stays false).
func New(getMode ModeReader, getCreds CredsReader) *Client {
	return &Client{
		getMode:  getMode,
		getCreds: getCreds,
		http:     &http.Client{Timeout: 15 * time.Second},
		tokens:   map[Environment]cachedToken{},
	}
}

// env resolves the active environment based on the current mode.
func (c *Client) env(ctx context.Context) Environment {
	if c == nil || c.getMode == nil {
		return Sandbox
	}
	if c.getMode(ctx) == "production" {
		return Live
	}
	return Sandbox
}

func (c *Client) creds(ctx context.Context, env Environment) CredSet {
	if c == nil || c.getCreds == nil {
		return CredSet{}
	}
	return c.getCreds(ctx, env)
}

// Enabled is true when the credentials for the currently active mode
// are present.
func (c *Client) Enabled(ctx context.Context) bool {
	if c == nil {
		return false
	}
	return c.creds(ctx, c.env(ctx)).ok()
}

// WebhookID returns the webhook secret-id for the currently active mode.
func (c *Client) WebhookID(ctx context.Context) string {
	if c == nil {
		return ""
	}
	return c.creds(ctx, c.env(ctx)).WebhookID
}

// ClientID returns the public client id for the currently active mode.
// Safe to expose to the browser.
func (c *Client) ClientID(ctx context.Context) string {
	if c == nil {
		return ""
	}
	return c.creds(ctx, c.env(ctx)).ClientID
}

// ActiveMode is "sandbox" or "live" — string form, useful for status
// endpoints.
func (c *Client) ActiveMode(ctx context.Context) string {
	if c == nil {
		return "sandbox"
	}
	return string(c.env(ctx))
}

// accessToken returns a cached or freshly-minted OAuth2 token for the
// active environment. Tokens are cached per env AND per client_id so
// rotating credentials in the admin UI invalidates the cached token.
func (c *Client) accessToken(ctx context.Context, env Environment) (string, error) {
	creds := c.creds(ctx, env)
	if !creds.ok() {
		return "", fmt.Errorf("paypal %s: credentials not configured", env)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if t, ok := c.tokens[env]; ok && t.clientID == creds.ClientID && time.Until(t.exp) > 30*time.Second {
		return t.value, nil
	}

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		env.baseURL()+"/v1/oauth2/token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", "Basic "+basicAuth(creds.ClientID, creds.ClientSecret))
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("paypal %s token: %d %s", env, resp.StatusCode, string(body))
	}

	var out struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", err
	}
	c.tokens[env] = cachedToken{
		value:    out.AccessToken,
		exp:      time.Now().Add(time.Duration(out.ExpiresIn) * time.Second),
		clientID: creds.ClientID,
	}
	return out.AccessToken, nil
}

func basicAuth(u, p string) string {
	return base64.StdEncoding.EncodeToString([]byte(u + ":" + p))
}

// Money is PayPal's amount object.
type Money struct {
	CurrencyCode string `json:"currency_code"`
	Value        string `json:"value"`
}

type CreateOrderInput struct {
	InvoiceNumber string
	Description   string
	Amount        Money
	ReturnURL     string
	CancelURL     string
}

type Order struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Links  []Link `json:"links"`
}

type Link struct {
	Href   string `json:"href"`
	Rel    string `json:"rel"`
	Method string `json:"method"`
}

func (c *Client) CreateOrder(ctx context.Context, in CreateOrderInput) (*Order, error) {
	env := c.env(ctx)
	tok, err := c.accessToken(ctx, env)
	if err != nil {
		return nil, err
	}

	body := map[string]any{
		"intent": "CAPTURE",
		"purchase_units": []map[string]any{{
			"invoice_id":  in.InvoiceNumber,
			"description": truncate(in.Description, 127),
			"amount":      in.Amount,
		}},
		"application_context": map[string]any{
			"brand_name":          "F2 Co., Ltd.",
			"user_action":         "PAY_NOW",
			"shipping_preference": "NO_SHIPPING",
			"return_url":          in.ReturnURL,
			"cancel_url":          in.CancelURL,
		},
	}
	raw, _ := json.Marshal(body)

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		env.baseURL()+"/v2/checkout/orders", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("paypal create order: %d %s", resp.StatusCode, string(out))
	}
	var o Order
	if err := json.Unmarshal(out, &o); err != nil {
		return nil, err
	}
	return &o, nil
}

type CaptureResult struct {
	OrderID     string
	CaptureID   string
	Status      string
	GrossAmount Money
	Raw         json.RawMessage
}

func (c *Client) CaptureOrder(ctx context.Context, orderID string) (*CaptureResult, error) {
	env := c.env(ctx)
	tok, err := c.accessToken(ctx, env)
	if err != nil {
		return nil, err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		env.baseURL()+"/v2/checkout/orders/"+orderID+"/capture",
		bytes.NewReader([]byte("{}")))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("paypal capture: %d %s", resp.StatusCode, string(raw))
	}

	var parsed struct {
		ID            string `json:"id"`
		Status        string `json:"status"`
		PurchaseUnits []struct {
			Payments struct {
				Captures []struct {
					ID     string `json:"id"`
					Status string `json:"status"`
					Amount Money  `json:"amount"`
				} `json:"captures"`
			} `json:"payments"`
		} `json:"purchase_units"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}

	res := &CaptureResult{
		OrderID: parsed.ID,
		Status:  parsed.Status,
		Raw:     raw,
	}
	if len(parsed.PurchaseUnits) > 0 && len(parsed.PurchaseUnits[0].Payments.Captures) > 0 {
		cap := parsed.PurchaseUnits[0].Payments.Captures[0]
		res.CaptureID = cap.ID
		res.GrossAmount = cap.Amount
	}
	return res, nil
}

type VerifyWebhookInput struct {
	AuthAlgo         string          `json:"auth_algo"`
	CertURL          string          `json:"cert_url"`
	TransmissionID   string          `json:"transmission_id"`
	TransmissionSig  string          `json:"transmission_sig"`
	TransmissionTime string          `json:"transmission_time"`
	WebhookID        string          `json:"webhook_id"`
	WebhookEvent     json.RawMessage `json:"webhook_event"`
}

type RefundInput struct {
	CaptureID   string
	Amount      Money // empty value = full refund
	NoteToPayer string
	InvoiceID   string
}

// RefundCapture issues a refund against a capture. Returns PayPal's
// refund id on success. Supports partial refunds when Amount.Value
// is non-empty.
func (c *Client) RefundCapture(ctx context.Context, in RefundInput) (string, error) {
	env := c.env(ctx)
	tok, err := c.accessToken(ctx, env)
	if err != nil {
		return "", err
	}
	body := map[string]any{}
	if in.Amount.Value != "" {
		body["amount"] = in.Amount
	}
	if in.NoteToPayer != "" {
		body["note_to_payer"] = truncate(in.NoteToPayer, 255)
	}
	if in.InvoiceID != "" {
		body["invoice_id"] = in.InvoiceID
	}
	raw, _ := json.Marshal(body)

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		env.baseURL()+"/v2/payments/captures/"+in.CaptureID+"/refund",
		bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("paypal refund: %d %s", resp.StatusCode, string(out))
	}
	var parsed struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return "", err
	}
	if parsed.Status != "COMPLETED" {
		return parsed.ID, fmt.Errorf("paypal refund status: %s", parsed.Status)
	}
	return parsed.ID, nil
}

func (c *Client) VerifyWebhook(ctx context.Context, headers http.Header, eventBody []byte) (bool, error) {
	env := c.env(ctx)
	creds := c.creds(ctx, env)
	if !creds.ok() {
		return false, errors.New("paypal: credentials not configured for active mode")
	}
	if creds.WebhookID == "" {
		return false, errors.New("paypal: webhook_id not set for active mode")
	}
	tok, err := c.accessToken(ctx, env)
	if err != nil {
		return false, err
	}

	in := VerifyWebhookInput{
		AuthAlgo:         headers.Get("Paypal-Auth-Algo"),
		CertURL:          headers.Get("Paypal-Cert-Url"),
		TransmissionID:   headers.Get("Paypal-Transmission-Id"),
		TransmissionSig:  headers.Get("Paypal-Transmission-Sig"),
		TransmissionTime: headers.Get("Paypal-Transmission-Time"),
		WebhookID:        creds.WebhookID,
		WebhookEvent:     eventBody,
	}
	raw, _ := json.Marshal(in)

	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		env.baseURL()+"/v1/notifications/verify-webhook-signature",
		bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		return false, fmt.Errorf("paypal verify: %d %s", resp.StatusCode, string(body))
	}
	var out struct {
		VerificationStatus string `json:"verification_status"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return false, err
	}
	return out.VerificationStatus == "SUCCESS", nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
