package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

// ResellerClub wraps the HTTP API documented at:
//
//	https://manage.resellerclub.com/kb/answer/764
//
// Availability is wired in Phase 4B; live registration in Phase 4C uses the
// reseller's own customer + contact records (every domain is registered
// under F2's umbrella account, with optional WHOIS privacy). This keeps the
// payload small and avoids creating a Customer record per end-customer in
// the reseller system. End-customer details are still captured in
// domain_orders for our own records.
type ResellerClub struct {
	BaseURL    string
	AuthUserID string
	APIKey     string
	HTTPClient *http.Client

	// Required for Register. If any are empty, Register returns an error
	// telling the operator which env var is missing.
	DefaultCustomerID string
	DefaultContactID  string // used for reg/admin/tech/billing contact
	DefaultNS1        string
	DefaultNS2        string
}

var rcOwnedTLDs = map[string]struct{}{
	"com": {}, "net": {}, "org": {}, "asia": {}, "biz": {},
	"info": {}, "co": {}, "io": {}, "app": {}, "shop": {},
}

func (r *ResellerClub) Name() string        { return "resellerclub" }
func (r *ResellerClub) Owns(tld string) bool { _, ok := rcOwnedTLDs[strings.ToLower(tld)]; return ok }

// rcAvailableResponse: the API returns a map keyed by the FQDN, each value:
//
//	{ "status": "available" | "regthroughus" | "regthroughothers" | "unknown",
//	  "classkey": "..." }
type rcAvailableEntry struct {
	Status   string `json:"status"`
	ClassKey string `json:"classkey,omitempty"`
}

func (r *ResellerClub) CheckAvailability(ctx context.Context, sld string, tlds []string) ([]models.AvailabilityResult, error) {
	if len(tlds) == 0 {
		return nil, nil
	}
	q := url.Values{}
	q.Set("auth-userid", r.AuthUserID)
	q.Set("api-key", r.APIKey)
	q.Set("domain-name", sld)
	for _, t := range tlds {
		q.Add("tlds", t)
	}

	endpoint := fmt.Sprintf("%s/api/domains/available.json?%s", strings.TrimRight(r.BaseURL, "/"), q.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	res, err := r.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return nil, fmt.Errorf("resellerclub: status %d", res.StatusCode)
	}

	var raw map[string]rcAvailableEntry
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("resellerclub: decode: %w", err)
	}

	now := time.Now().UTC()
	out := make([]models.AvailabilityResult, 0, len(tlds))
	for _, t := range tlds {
		fqdn := sld + "." + t
		entry, ok := raw[fqdn]
		cls := classifyRC(entry.Status)
		out = append(out, models.AvailabilityResult{
			FQDN:           fqdn,
			TLD:            t,
			Available:      cls == models.ClassAvailable,
			Classification: cls,
			Source:         r.Name(),
			CheckedAt:      now,
		})
		_ = ok // entry presence is captured by status
	}
	return out, nil
}

// rcRegisterResponse is the relevant subset of the register-domain response.
// status: "Success" / "Failed" / "InvoicePaid" / "PendingExecution" — the API
// is chatty here and we treat anything starting with "Success" as a win.
type rcRegisterResponse struct {
	OrderID      json.Number `json:"entityid,omitempty"`
	ActionStatus string      `json:"actionstatus,omitempty"`
	Status       string      `json:"status,omitempty"`
	Message      string      `json:"actionstatusdesc,omitempty"`
	ErrorMessage string      `json:"message,omitempty"`
}

func (r *ResellerClub) Register(ctx context.Context, req PlaceRequest) (models.PlacementResult, error) {
	if r.DefaultCustomerID == "" {
		return models.PlacementResult{}, fmt.Errorf("resellerclub: RESELLERCLUB_DEFAULT_CUSTOMER_ID is required for live registration")
	}
	if r.DefaultContactID == "" {
		return models.PlacementResult{}, fmt.Errorf("resellerclub: RESELLERCLUB_DEFAULT_CONTACT_ID is required for live registration")
	}
	if r.DefaultNS1 == "" || r.DefaultNS2 == "" {
		return models.PlacementResult{}, fmt.Errorf("resellerclub: RESELLERCLUB_DEFAULT_NS1 and _NS2 are required for live registration")
	}

	q := url.Values{}
	q.Set("auth-userid", r.AuthUserID)
	q.Set("api-key", r.APIKey)
	q.Set("domain-name", req.SLD+"."+req.TLD)
	q.Set("years", strconv.Itoa(req.Years))
	q.Add("ns", r.DefaultNS1)
	q.Add("ns", r.DefaultNS2)
	q.Set("customer-id", r.DefaultCustomerID)
	q.Set("reg-contact-id", r.DefaultContactID)
	q.Set("admin-contact-id", r.DefaultContactID)
	q.Set("tech-contact-id", r.DefaultContactID)
	q.Set("billing-contact-id", r.DefaultContactID)
	q.Set("invoice-option", "NoInvoice") // bills against reseller balance
	if req.PrivacyEnabled {
		q.Set("protect-privacy", "true")
	} else {
		q.Set("protect-privacy", "false")
	}

	endpoint := fmt.Sprintf("%s/api/domains/register.json", strings.TrimRight(r.BaseURL, "/"))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"?"+q.Encode(), nil)
	if err != nil {
		return models.PlacementResult{}, err
	}
	res, err := r.HTTPClient.Do(httpReq)
	if err != nil {
		return models.PlacementResult{}, err
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(res.Body)
	var parsed rcRegisterResponse
	_ = json.Unmarshal(body, &parsed)

	raw := map[string]any{
		"http_status": res.StatusCode,
		"body":        string(body),
	}

	// API returns 200 with status in the body; treat anything not-Success as failure.
	winning := strings.EqualFold(parsed.ActionStatus, "Success") ||
		strings.EqualFold(parsed.Status, "Success") ||
		strings.HasPrefix(strings.ToLower(parsed.ActionStatus), "success")
	if res.StatusCode >= 400 || !winning {
		msg := parsed.ErrorMessage
		if msg == "" {
			msg = parsed.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("registry returned status %d", res.StatusCode)
		}
		return models.PlacementResult{
			Status: "failed",
			Raw:    raw,
		}, fmt.Errorf("resellerclub register: %s", msg)
	}

	return models.PlacementResult{
		RegistryOrderID: parsed.OrderID.String(),
		Status:          "registered",
		Raw:             raw,
	}, nil
}

func classifyRC(status string) models.Classification {
	switch strings.ToLower(status) {
	case "available":
		return models.ClassAvailable
	case "regthroughus", "regthroughothers", "regthrough":
		return models.ClassRegistered
	case "premium":
		return models.ClassPremium
	default:
		return models.ClassUnknown
	}
}
