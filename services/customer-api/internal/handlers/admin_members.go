package handlers

// Staff-side membership role management. F2 staff (the top "super admin" tier)
// can assign an existing user any of the five per-org roles and change it later
// — parity with the org-owner Team page, but without the "only an owner can
// manage owners" restriction (staff sit above org roles). Last-owner protection
// still applies so an org can never be left ownerless.

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
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

	var current string
	err := h.DB.QueryRow(r.Context(),
		`SELECT role FROM contact_org_memberships WHERE contact_id = $1 AND customer_id = $2`,
		contactID, cid).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusNotFound, "member not found in this org")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// Last-owner protection: don't demote the org's final owner.
	if current == "owner" && req.Role != "owner" {
		n, err := activeOwnerCount(r.Context(), h.DB, cid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "db error")
			return
		}
		if n <= 1 {
			writeErr(w, http.StatusConflict, "the organization must keep at least one owner")
			return
		}
	}

	if _, err := h.DB.Exec(r.Context(),
		`UPDATE contact_org_memberships SET role = $3 WHERE contact_id = $1 AND customer_id = $2`,
		contactID, cid, req.Role); err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	// Force the member to re-mint their token so the new role takes effect now.
	revokeContactSessions(r.Context(), h.DB, contactID)
	w.WriteHeader(http.StatusNoContent)
}
