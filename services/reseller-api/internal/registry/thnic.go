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
//
// EPP INTEGRATION BOUNDARY (blocked): turning this stub into a live adapter
// requires a THNIC/T.H.NIC registrar agreement + EPP credentials (mTLS
// client cert/key, login, EPP host). The wiring points are marked below
// (CheckAvailability → domain:check, Register → domain:create, GetDetails →
// domain:info for expiry). See docs/thnic-epp-integration.md for the full
// requirements and rollout. Nothing here can be completed without those
// credentials, so it stays a stub by design.
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

// GetDetails is unsupported: THNIC EPP/mTLS isn't wired, so expiry for .th
// domains stays manually maintained. The sync worker skips these.
func (THNICStub) GetDetails(_ context.Context, _, _ string) (DomainDetails, error) {
	return DomainDetails{}, ErrSyncUnsupported
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
