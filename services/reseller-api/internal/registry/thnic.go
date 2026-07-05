package registry

import (
	"context"
	"strings"
	"time"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

// THNICStub: Thai ccTLDs (.co.th / .or.th / .in.th) need EPP-with-mTLS
// against THNIC, which is an ops conversation we haven't had yet. Until
// real auth is in place, we report "manual" — the UI shows an info badge,
// the lead drops into the queue, and F2 staff places the order via the
// THNIC partner portal. This keeps .th visible on /domains without lying
// about whether a name is actually available.
type THNICStub struct{}

var thOwnedTLDs = map[string]struct{}{
	"co.th": {}, "or.th": {}, "in.th": {}, "ac.th": {}, "go.th": {},
}

func (THNICStub) Name() string         { return "thnic_stub" }
func (THNICStub) Owns(tld string) bool { _, ok := thOwnedTLDs[strings.ToLower(tld)]; return ok }

func (THNICStub) Register(_ context.Context, _ PlaceRequest) (models.PlacementResult, error) {
	// THNIC EPP integration isn't wired yet — clicking "Place" moves the
	// order to "approved" with a note that F2 staff must complete the
	// registration via the THNIC partner portal. Once they have the
	// portal's order id they enter it via the Update endpoint and bump
	// status to "registered". registry_order_id stays empty here.
	return models.PlacementResult{
		Status: "approved",
		Raw:    map[string]any{"thnic_stub": true, "note": "F2 to complete via THNIC partner portal"},
	}, nil
}

func (THNICStub) CheckAvailability(_ context.Context, sld string, tlds []string) ([]models.AvailabilityResult, error) {
	now := time.Now().UTC()
	out := make([]models.AvailabilityResult, 0, len(tlds))
	for _, t := range tlds {
		out = append(out, models.AvailabilityResult{
			FQDN:           sld + "." + t,
			TLD:            t,
			Available:      false, // not assertable without EPP
			Classification: models.ClassManual,
			Source:         "thnic_stub",
			CheckedAt:      now,
		})
	}
	return out, nil
}
