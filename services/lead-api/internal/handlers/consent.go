package handlers

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/f2cothai/f2-website/services/lead-api/internal/config"
)

var uuidRE = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// ConsentHandler records and retrieves cookie consent for PDPA compliance.
//   Public: POST /api/consent          — record visitor's consent choice
//   Public: GET  /api/consent/{visitorId} — retrieve current consent for a visitor

type ConsentHandler struct {
	DB  *pgxpool.Pool
	Cfg config.Config
}

type consentReq struct {
	VisitorID string `json:"visitor_id"`
	Analytics bool   `json:"analytics"`
	Marketing bool   `json:"marketing"`
	Locale    string `json:"locale"`
}

type consentResp struct {
	ID          string  `json:"id"`
	VisitorID   string  `json:"visitor_id"`
	Status      string  `json:"status"` // "active" | "withdrawn" | "none"
	Analytics   bool    `json:"analytics"`
	Marketing   bool    `json:"marketing"`
	ConsentedAt string  `json:"consented_at,omitempty"`
	WithdrawnAt *string `json:"withdrawn_at,omitempty"`
}

// RecordConsent stores or updates a visitor's consent. Upserts on visitor_id so
// re-consent (preference change) simply updates the existing row without creating duplicates.
// POST /api/consent
func (h *ConsentHandler) RecordConsent(w http.ResponseWriter, r *http.Request) {
	var req consentReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	req.VisitorID = strings.TrimSpace(req.VisitorID)
	if req.VisitorID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "visitor_id required"})
		return
	}
	if !uuidRE.MatchString(req.VisitorID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "visitor_id must be a UUID"})
		return
	}
	if req.Locale != "en" && req.Locale != "th" {
		req.Locale = "en"
	}

	// Capture IP and user-agent at the consent boundary (PDPA evidentiary requirement).
	// NULLIF + cast lets us store NULL when the address is missing or unparseable
	// rather than letting the whole insert error out and losing the consent record.
	ipAddr := clientIP(r)
	ua := r.UserAgent()

	var id, consentedAt string
	err := h.DB.QueryRow(r.Context(), `
		INSERT INTO cookie_consents (visitor_id, locale, analytics, marketing, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, NULLIF($5,'')::inet, $6)
		ON CONFLICT (visitor_id) DO UPDATE
			SET analytics    = EXCLUDED.analytics,
			    marketing    = EXCLUDED.marketing,
			    locale       = EXCLUDED.locale,
			    ip_address   = EXCLUDED.ip_address,
			    user_agent   = EXCLUDED.user_agent,
			    consented_at = NOW(),
			    withdrawn_at = NULL
		RETURNING id, consented_at::text`,
		req.VisitorID, req.Locale, req.Analytics, req.Marketing, ipAddr, ua,
	).Scan(&id, &consentedAt)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not record consent"})
		return
	}

	writeJSON(w, http.StatusOK, consentResp{
		ID:          id,
		VisitorID:   req.VisitorID,
		Status:      "active",
		Analytics:   req.Analytics,
		Marketing:   req.Marketing,
		ConsentedAt: consentedAt,
	})
}

// WithdrawConsent marks consent as withdrawn (sets withdrawn_at).
// POST /api/consent/{visitorId}/withdraw
func (h *ConsentHandler) WithdrawConsent(w http.ResponseWriter, r *http.Request) {
	visitorID := chi.URLParam(r, "visitorId")
	if visitorID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "visitorId required"})
		return
	}

	_, err := h.DB.Exec(r.Context(), `
		UPDATE cookie_consents
		SET withdrawn_at = NOW(),
		    analytics    = false,
		    marketing    = false
		WHERE visitor_id = $1 AND withdrawn_at IS NULL`,
		visitorID,
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "withdraw failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "withdrawn"})
}

// GetConsent retrieves the current stored consent for a visitor by their UUID.
// Always returns 200 with a `status` discriminator so the frontend can tell
// "first visit" from "previously withdrew" — the banner needs both cases but
// shows different copy:
//
//	status = "none"      → no record at all; show first-visit banner
//	status = "withdrawn" → existing record with withdrawn_at set; re-prompt
//	                       with "you previously withdrew" context
//	status = "active"    → live consent; banner stays hidden
//
// GET /api/consent/{visitorId}
func (h *ConsentHandler) GetConsent(w http.ResponseWriter, r *http.Request) {
	visitorID := chi.URLParam(r, "visitorId")
	if visitorID == "" || !uuidRE.MatchString(visitorID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid visitorId"})
		return
	}

	var resp consentResp
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, visitor_id, analytics, marketing, consented_at::text, withdrawn_at::text
		FROM cookie_consents
		WHERE visitor_id = $1`, visitorID,
	).Scan(&resp.ID, &resp.VisitorID, &resp.Analytics, &resp.Marketing, &resp.ConsentedAt, &resp.WithdrawnAt)
	if err != nil {
		writeJSON(w, http.StatusOK, consentResp{VisitorID: visitorID, Status: "none"})
		return
	}

	if resp.WithdrawnAt != nil {
		// Withdrawn rows zero out the consent flags on POST /withdraw, so
		// returning them as-is is accurate. Status discriminator carries the
		// "explicitly withdrew" signal the banner needs.
		resp.Status = "withdrawn"
	} else {
		resp.Status = "active"
	}
	writeJSON(w, http.StatusOK, resp)
}
