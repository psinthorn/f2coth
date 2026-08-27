package handlers

// Staff-side membership role management. F2 staff (the top "super admin" tier)
// can assign an existing user any of the five per-org roles and change it later
// — parity with the org-owner Team page, but without the "only an owner can
// manage owners" restriction (staff sit above org roles). Last-owner protection
// still applies so an org can never be left ownerless.

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// PATCH /api/customer/admin/customers/{id}/contacts/{contactId}/role
func (h *AdminHandler) SetContactRole(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	contactID := chi.URLParam(r, "contactId")
	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !orgRoles[req.Role] {
		writeErr(w, http.StatusBadRequest, "invalid role")
		return
	}

	var exists bool
	if err := h.DB.QueryRow(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM contact_org_memberships WHERE contact_id = $1 AND customer_id = $2)`,
		contactID, cid).Scan(&exists); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if !exists {
		writeErr(w, http.StatusNotFound, "member not found in this org")
		return
	}

	// Atomic last-owner guard (staff may manage owners, but an org can never be
	// left ownerless; a disabled ex-owner can still be demoted).
	res, err := h.DB.Exec(r.Context(),
		`UPDATE contact_org_memberships SET role = $3
		  WHERE contact_id = $1 AND customer_id = $2
		    AND ($3 = 'owner' OR role <> 'owner' OR `+otherActiveOwnerExists+`)`,
		contactID, cid, req.Role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusConflict, "the organization must keep at least one owner")
		return
	}
	// Force the member to re-mint their token so the new role takes effect now.
	revokeContactSessions(r.Context(), h.DB, contactID, cid)
	w.WriteHeader(http.StatusNoContent)
}
