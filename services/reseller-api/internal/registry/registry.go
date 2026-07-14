// Package registry abstracts domain registries behind one interface so the
// rest of the app doesn't care whether a TLD goes through ResellerClub,
// THNIC, or the dev-only mock. The concrete adapters live in sibling files.
package registry

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

// ErrSyncUnsupported is returned by GetDetails for adapters that can't poll
// the registry for a domain's live state (the THNIC stub, the dev Mock).
// The sync worker treats it as "skip, not an error".
var ErrSyncUnsupported = errors.New("registry: detail sync not supported")

// DomainDetails is the authoritative registry state for a single domain,
// as returned by GetDetails. RegistryOrderID is echoed back (possibly
// freshly resolved) so the caller can cache it on customer_domains.
type DomainDetails struct {
	ExpiresAt       time.Time
	Status          string // registry currentstatus, e.g. "Active"
	RegistryOrderID string
}

// Registry knows how to answer availability and place orders for a set of
// TLDs. Each adapter declares which TLDs it owns via Owns.
//
// Register is the actual placement step: the adapter contacts the registry
// (or simulates the call in the case of Mock) and returns what to persist
// on the order row. PlaceRequest carries the minimum a registrar needs;
// Years and PrivacyEnabled are passed straight through.
//
// GetDetails polls the registry for a live domain's expiry/status, used by
// the sync worker. registryOrderID may be empty (the adapter resolves it
// from the FQDN). Adapters that can't sync return ErrSyncUnsupported.
type Registry interface {
	Name() string
	Owns(tld string) bool
	CheckAvailability(ctx context.Context, sld string, tlds []string) ([]models.AvailabilityResult, error)
	Register(ctx context.Context, req PlaceRequest) (models.PlacementResult, error)
	GetDetails(ctx context.Context, fqdn, registryOrderID string) (DomainDetails, error)
}

type PlaceRequest struct {
	SLD            string
	TLD            string
	Years          int
	PrivacyEnabled bool
	ContactName    string
	ContactEmail   string
	ContactPhone   string
	ContactCompany string
}

// Router fans out to the adapter that owns each TLD. ResellerClub gets all
// gTLDs, THNIC stub gets .th ccTLDs, and Mock catches the rest in dev.
type Router struct {
	Adapters []Registry
	Fallback Registry // used when no Adapter Owns the TLD
}

func (r *Router) For(tld string) Registry {
	for _, a := range r.Adapters {
		if a.Owns(tld) {
			return a
		}
	}
	return r.Fallback
}

// ForDomain routes a full FQDN (e.g. "example.co.th") to the owning
// adapter by testing progressively shorter suffixes, longest first so a
// multi-label ccTLD like "co.th" wins over "th". Falls back to Fallback
// when nothing claims it.
func (r *Router) ForDomain(fqdn string) Registry {
	labels := strings.Split(strings.ToLower(strings.TrimSuffix(fqdn, ".")), ".")
	for start := 1; start < len(labels); start++ {
		cand := strings.Join(labels[start:], ".")
		for _, a := range r.Adapters {
			if a.Owns(cand) {
				return a
			}
		}
	}
	return r.Fallback
}

// CheckAvailability splits the request by adapter, calls each, then merges.
// Order in the response mirrors the order of `tlds`.
func (r *Router) CheckAvailability(ctx context.Context, sld string, tlds []string) ([]models.AvailabilityResult, error) {
	byAdapter := map[Registry][]string{}
	for _, t := range tlds {
		a := r.For(t)
		byAdapter[a] = append(byAdapter[a], t)
	}

	resultsByFQDN := make(map[string]models.AvailabilityResult, len(tlds))
	for a, group := range byAdapter {
		got, err := a.CheckAvailability(ctx, sld, group)
		if err != nil {
			// One adapter failing shouldn't blank the whole response —
			// mark its TLDs as unknown and let the UI show a soft state.
			for _, t := range group {
				resultsByFQDN[sld+"."+t] = models.AvailabilityResult{
					FQDN:           sld + "." + t,
					TLD:            t,
					Available:      false,
					Classification: models.ClassUnknown,
					Source:         a.Name(),
				}
			}
			continue
		}
		for _, r := range got {
			resultsByFQDN[r.FQDN] = r
		}
	}

	out := make([]models.AvailabilityResult, 0, len(tlds))
	for _, t := range tlds {
		out = append(out, resultsByFQDN[sld+"."+t])
	}
	return out, nil
}
