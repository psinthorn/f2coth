package registry

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"hash/fnv"
	"strings"
	"time"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

// Mock is the dev-only fallback used when ResellerClub credentials are
// missing. It returns deterministic answers per FQDN so the same query
// keeps producing the same result while the cache is repopulated.
//
// Heuristic: SLD shorter than 4 chars is "premium", FNV hash modulo 3
// otherwise picks available / registered / available — biased toward
// "available" so demos feel useful.
type Mock struct{}

func (Mock) Name() string       { return "mock" }
func (Mock) Owns(_ string) bool { return false } // only used as fallback

func (Mock) CheckAvailability(_ context.Context, sld string, tlds []string) ([]models.AvailabilityResult, error) {
	now := time.Now().UTC()
	out := make([]models.AvailabilityResult, 0, len(tlds))
	for _, t := range tlds {
		fqdn := strings.ToLower(sld) + "." + strings.ToLower(t)
		cls := mockClassify(fqdn)
		out = append(out, models.AvailabilityResult{
			FQDN:           fqdn,
			TLD:            t,
			Available:      cls == models.ClassAvailable,
			Classification: cls,
			Source:         "mock",
			CheckedAt:      now,
		})
	}
	return out, nil
}

func (Mock) Register(_ context.Context, req PlaceRequest) (models.PlacementResult, error) {
	// Synthetic order ID, deterministic per run (timestamp + rand). The "MOCK-"
	// prefix makes it obvious in the admin queue that this isn't a live order.
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	id := "MOCK-" + strings.ToUpper(hex.EncodeToString(b))
	return models.PlacementResult{
		RegistryOrderID: id,
		Status:          "registered",
		Raw: map[string]any{
			"mock":            true,
			"fqdn":            req.SLD + "." + req.TLD,
			"years":           req.Years,
			"privacy_enabled": req.PrivacyEnabled,
		},
	}, nil
}

// GetDetails is unsupported for the dev Mock — there's no real registry to
// query, so the sync worker treats mock/dev domains as skip.
func (Mock) GetDetails(_ context.Context, _, _ string) (DomainDetails, error) {
	return DomainDetails{}, ErrSyncUnsupported
}

func mockClassify(fqdn string) models.Classification {
	sld := strings.SplitN(fqdn, ".", 2)[0]
	if len(sld) <= 3 {
		return models.ClassPremium
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(fqdn))
	switch h.Sum32() % 3 {
	case 0:
		return models.ClassRegistered
	default:
		return models.ClassAvailable
	}
}
