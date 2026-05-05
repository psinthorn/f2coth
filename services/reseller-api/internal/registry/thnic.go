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

func (THNICStub) Name() string        { return "thnic_stub" }
func (THNICStub) Owns(tld string) bool { _, ok := thOwnedTLDs[strings.ToLower(tld)]; return ok }

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
