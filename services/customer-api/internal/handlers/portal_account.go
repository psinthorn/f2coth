package handlers

// Portal self-service account endpoints (migration 071):
//   - PATCH /api/portal/me           — edit own profile
//   - the email-verification gate used by CreateTicket / AddMessage
//   - admin GET/PATCH /api/customer/admin/portal-settings — enforcement toggle

import (
	"encoding/json"
	"net/http"
	"strings"
)

// emailUnverifiedBlocked reports whether this contact should be blocked from a
// sensitive action. True only when the admin has turned enforcement ON *and*
// the contact's email is not yet verified. Fails open (returns false) on any
// DB error so a settings hiccup never locks customers out.
func (h *PortalHandler) emailUnverifiedBlocked(r *http.Request, conid string) bool {
	if conid == "" {
		return false
	}
	var blocked bool
	err := h.DB.QueryRow(r.Context(), `
        SELECT ps.require_email_verification
               AND cc.email_verified_at IS NULL
        FROM portal_settings ps
        CROSS JOIN customer_contacts cc
        WHERE ps.id = 1 AND cc.id = $1
    `, conid).Scan(&blocked)
	if err != nil {
		return false
	}
	return blocked
}

type profileUpdateReq struct {
	FullName *string `json:"full_name"`
	Phone    *string `json:"phone"`
	JobTitle *string `json:"job_title"`
	Locale   *string `json:"locale"`
}

// UpdateProfile lets a logged-in portal user edit their own profile.
// PATCH /api/portal/me
func (h *PortalHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	conid := contactID(r)
	if conid == "" {
		writeErr(w, http.StatusUnauthorized, "no contact in token")
		return
	}
	var req profileUpdateReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.FullName != nil {
		trimmed := strings.TrimSpace(*req.FullName)
		if trimmed == "" || len(trimmed) > 200 {
			writeErr(w, http.StatusBadRequest, "full_name must be 1–200 characters")
			return
		}
		req.FullName = &trimmed
	}
	if req.Locale != nil && *req.Locale != "en" && *req.Locale != "th" {
		writeErr(w, http.StatusBadRequest, "locale must be en or th")
		return
	}
	tag, err := h.DB.Exec(r.Context(), `
        UPDATE customer_contacts SET
            full_name = COALESCE($2, full_name),
            phone     = COALESCE($3, phone),
            job_title = COALESCE($4, job_title),
            locale    = COALESCE($5, locale),
            updated_at = NOW()
        WHERE id = $1
    `, conid, req.FullName, req.Phone, req.JobTitle, req.Locale)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if tag.RowsAffected() == 0 {
		writeErr(w, http.StatusNotFound, "contact not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- Admin: portal settings (email-verification enforcement) ----------

type portalSettings struct {
	RequireEmailVerification bool `json:"require_email_verification"`
}

// GetPortalSettings — GET /api/customer/admin/portal-settings
func (h *AdminHandler) GetPortalSettings(w http.ResponseWriter, r *http.Request) {
	var s portalSettings
	if err := h.DB.QueryRow(r.Context(),
		`SELECT require_email_verification FROM portal_settings WHERE id = 1`).
		Scan(&s.RequireEmailVerification); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	writeJSON(w, http.StatusOK, s)
}

// UpdatePortalSettings — PATCH /api/customer/admin/portal-settings
func (h *AdminHandler) UpdatePortalSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RequireEmailVerification *bool `json:"require_email_verification"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.RequireEmailVerification == nil {
		writeErr(w, http.StatusBadRequest, "require_email_verification required")
		return
	}
	if _, err := h.DB.Exec(r.Context(), `
        UPDATE portal_settings
        SET require_email_verification = $1, updated_by = NULLIF($2,'')::uuid
        WHERE id = 1
    `, *req.RequireEmailVerification, staffID(r)); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
