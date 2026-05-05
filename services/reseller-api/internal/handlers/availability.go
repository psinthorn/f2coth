package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/f2cothai/f2-website/services/reseller-api/internal/models"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/registry"
	"github.com/f2cothai/f2-website/services/reseller-api/internal/store"
)

type AvailabilityHandler struct {
	Router *registry.Router
	Cache  *store.AvailabilityCache
}

type availabilityReq struct {
	SLD  string   `json:"sld"`
	TLDs []string `json:"tlds"`
}

type availabilityRes struct {
	Results []models.AvailabilityResult `json:"results"`
}

// Check is a public endpoint. We require an SLD and at least one TLD.
// Cache hits are stamped with `cached:true`; misses go to the registry
// router and the result is written through.
func (h *AvailabilityHandler) Check(w http.ResponseWriter, r *http.Request) {
	var req availabilityReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	req.SLD = sanitizeSLD(req.SLD)
	if req.SLD == "" || len(req.TLDs) == 0 {
		writeErr(w, http.StatusBadRequest, "sld and tlds are required")
		return
	}
	if len(req.TLDs) > 10 {
		writeErr(w, http.StatusBadRequest, "too many tlds")
		return
	}

	ctx := r.Context()
	go h.Cache.PurgeExpired(ctx) // fire and forget, don't block the response

	results := make([]models.AvailabilityResult, 0, len(req.TLDs))
	missing := make([]string, 0, len(req.TLDs))
	for _, t := range req.TLDs {
		t = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(t)), ".")
		if t == "" {
			continue
		}
		fqdn := req.SLD + "." + t
		hit, _ := h.Cache.Lookup(ctx, fqdn)
		if hit != nil {
			hit.TLD = t
			results = append(results, *hit)
			continue
		}
		missing = append(missing, t)
	}

	if len(missing) > 0 {
		fresh, err := h.Router.CheckAvailability(ctx, req.SLD, missing)
		if err != nil {
			writeErr(w, http.StatusBadGateway, "registry lookup failed")
			return
		}
		for _, fr := range fresh {
			_ = h.Cache.Save(ctx, fr)
			results = append(results, fr)
		}
	}

	// Re-order to match the original tlds[] sequence.
	idx := map[string]int{}
	for i, t := range req.TLDs {
		idx[strings.ToLower(strings.TrimPrefix(strings.TrimSpace(t), "."))] = i
	}
	ordered := make([]models.AvailabilityResult, len(req.TLDs))
	for _, r := range results {
		if i, ok := idx[r.TLD]; ok {
			ordered[i] = r
		}
	}

	writeJSON(w, http.StatusOK, availabilityRes{Results: ordered})
}

// sanitizeSLD strips a TLD suffix if the user typed a full FQDN, then
// lower-cases and trims. Returns "" for input that isn't a valid label.
func sanitizeSLD(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimSuffix(s, ".")
	if i := strings.Index(s, "."); i > 0 {
		s = s[:i]
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return ""
		}
	}
	if len(s) < 1 || len(s) > 63 {
		return ""
	}
	return s
}
