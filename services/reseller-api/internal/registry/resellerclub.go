package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

// ResellerClub wraps the HTTP API documented at:
//
//	https://manage.resellerclub.com/kb/answer/764
//
// We only implement the availability check for now (Phase 4B). Order
// placement is wired in Phase 4C once we trust the flow end-to-end.
type ResellerClub struct {
	BaseURL    string
	AuthUserID string
	APIKey     string
	HTTPClient *http.Client
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
