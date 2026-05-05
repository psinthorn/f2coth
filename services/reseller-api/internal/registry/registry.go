// Package registry abstracts domain registries behind one interface so the
// rest of the app doesn't care whether a TLD goes through ResellerClub,
// THNIC, or the dev-only mock. The concrete adapters live in sibling files.
package registry

import (
	"context"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
)

// Registry knows how to answer availability and (eventually) place orders
// for a set of TLDs. Each adapter declares which TLDs it owns via Owns.
type Registry interface {
	Name() string
	Owns(tld string) bool
	CheckAvailability(ctx context.Context, sld string, tlds []string) ([]models.AvailabilityResult, error)
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
