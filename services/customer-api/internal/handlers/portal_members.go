package handlers

// Organization self-administration (multi-tenant Phase 1). Lets an org Owner or
// Admin manage the members of their ACTIVE org — invite, change role, disable,
// remove — entirely scoped to customerID(r). Route-gated by RequireCap(
// ManageMembers); the owner-specific rules that a flat matrix can't express are
// enforced here (see §6 of docs/multitenant-phase1-org-rbac.md).

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	authmw "github.com/f2cothai/f2-website/services/customer-api/internal/middleware"
)

// orgRoles is the set of valid per-org membership roles (multi-tenant Phase 1).
// Shared by the portal (org self-admin) and staff admin paths.
var orgRoles = map[string]bool{"owner": true, "admin": true, "billing": true, "member": true, "viewer": true}

func callerRole(r *http.Request) string {
	v, _ := r.Context().Value(authmw.CtxRole).(string)
	return v
}

// activeOwnerCount returns how many active (non-disabled) owners an org has.
// Free function so both PortalHandler and AdminHandler can guard the last owner.
func activeOwnerCount(ctx context.Context, db *pgxpool.Pool, cid string) (int, error) {
	var n int
	err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM contact_org_memberships
		  WHERE customer_id = $1 AND role = 'owner' AND disabled_at IS NULL`, cid).Scan(&n)
	return n, err
}

// revokeContactSessions logs a contact out of all sessions so a role/status
// change takes effect on their next login (the customer JWT re-derives role from
// the active membership). Best-effort — a failed revoke shouldn't fail the write.
// revokeContactSessions logs a contact out of the sessions bound to THIS org
// (active_customer_id) so a role/status change takes effect on their next login
// without disturbing sessions they hold in other orgs. Mirrors admin.DisableContact.
func revokeContactSessions(ctx context.Context, db *pgxpool.Pool, contactID, cid string) {
	_, _ = db.Exec(ctx,
		`UPDATE customer_refresh_tokens SET revoked_at = NOW()
		  WHERE contact_id = $1 AND active_customer_id = $2 AND revoked_at IS NULL`,
		contactID, cid)
}

func (h *PortalHandler) revokeContactTokens(ctx context.Context, contactID, cid string) {
	revokeContactSessions(ctx, h.DB, contactID, cid)
}

// otherActiveOwnerExists is the guard subquery used to keep an org from ever
// dropping to zero active owners — atomically, inside the same statement that
// demotes/disables/removes, so there is no check-then-act race. Params: $1
// target contact, $2 customer.
const otherActiveOwnerExists = `EXISTS (SELECT 1 FROM contact_org_memberships o
	 WHERE o.customer_id = $2 AND o.contact_id <> $1
	   AND o.role = 'owner' AND o.disabled_at IS NULL)`

func (h *PortalHandler) ownerCount(ctx context.Context, cid string) (int, error) {
	return activeOwnerCount(ctx, h.DB, cid)
}

type memberResp struct {
	ContactID string  `json:"contact_id"`
	Email     string  `json:"email"`
	FullName  string  `json:"full_name"`
	Role      string  `json:"role"`
	IsPrimary bool    `json:"is_primary"`
	Disabled  bool    `json:"disabled"`
	Verified  bool    `json:"verified"`
	Pending   bool    `json:"pending"` // invited, hasn't set a real password yet
	LastLogin *string `json:"last_login_at"`
	InvitedAt *string `json:"invited_at"`
}

// GET /api/portal/members — list the active org's members.
func (h *PortalHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}
	rows, err := h.DB.Query(r.Context(), `
		SELECT cc.id, cc.email, cc.full_name, m.role, m.is_primary,
		       (m.disabled_at IS NOT NULL),
		       (cc.email_verified_at IS NOT NULL),
		       cc.must_change_password,
		       cc.last_login_at::text, cc.invited_at::text
		  FROM contact_org_memberships m
		  JOIN customer_contacts cc ON cc.id = m.contact_id
		 WHERE m.customer_id = $1
		 ORDER BY (m.role = 'owner') DESC, (m.role = 'admin') DESC, cc.full_name`, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	defer rows.Close()
	out := []memberResp{}
	for rows.Next() {
		var m memberResp
		if err := rows.Scan(&m.ContactID, &m.Email, &m.FullName, &m.Role, &m.IsPrimary,
			&m.Disabled, &m.Verified, &m.Pending, &m.LastLogin, &m.InvitedAt); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan error")
			return
		}
		out = append(out, m)
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": out})
}

type inviteReq struct {
	Email    string `json:"email"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
}

// POST /api/portal/members/invite — invite (or link) a member to the active org.
// Mirrors staff CreateContact but scoped to the caller's active org and gated by
// the caller's own role (an admin cannot grant owner).
func (h *PortalHandler) InviteMember(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	if cid == "" {
		writeErr(w, http.StatusUnauthorized, "no customer in token")
		return
	}
	var req inviteReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FullName = strings.TrimSpace(req.FullName)
	if req.Email == "" || req.FullName == "" {
		writeErr(w, http.StatusBadRequest, "email and full_name required")
		return
	}
	if req.Role == "" {
		req.Role = "member"
	}
	if !orgRoles[req.Role] {
		writeErr(w, http.StatusBadRequest, "invalid role")
		return
	}
	// Only an owner may grant a privileged (owner/billing) role.
	if privilegedGrant(req.Role) && callerRole(r) != "owner" {
		writeErr(w, http.StatusForbidden, "only an owner can grant the owner or billing role")
		return
	}

	var orgName string
	if err := h.DB.QueryRow(r.Context(), `SELECT name FROM customers WHERE id = $1`, cid).Scan(&orgName); err != nil {
		writeErr(w, http.StatusNotFound, "org not found")
		return
	}

	// Existing email → link to this org (idempotent).
	var (
		existingID       string
		existingLocale   string
		existingName     string
		existingVerified bool
	)
	err := h.DB.QueryRow(r.Context(),
		`SELECT id, COALESCE(locale,'en'), full_name, (email_verified_at IS NOT NULL)
		   FROM customer_contacts WHERE email = $1`, req.Email).
		Scan(&existingID, &existingLocale, &existingName, &existingVerified)
	if err == nil {
		tag, e := h.DB.Exec(r.Context(), `
			INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
			VALUES ($1, $2, $3, FALSE)
			ON CONFLICT (contact_id, customer_id) DO NOTHING`, existingID, cid, req.Role)
		if e != nil {
			writeErr(w, http.StatusInternalServerError, "could not link member")
			return
		}
		newlyLinked := tag.RowsAffected() > 0
		if newlyLinked && !existingVerified {
			if raw, hash, e := mintContactToken(); e == nil {
				if _, e := h.DB.Exec(r.Context(), `
					INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
					VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, 'verification')`,
					existingID, hash, verifyTTLMinutes); e == nil {
					sendContactVerify(h.Notify, h.Cfg.PortalBaseURL, req.Email, existingName, raw, existingLocale)
				}
			}
		}
		writeJSON(w, http.StatusCreated, map[string]any{"contact_id": existingID, "linked": true, "newly_linked": newlyLinked})
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}

	// New person → temp password + verification email.
	tempPassword, err := genTempPassword()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "password gen error")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(tempPassword), 12)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash error")
		return
	}
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx error")
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	err = tx.QueryRow(r.Context(), `
		INSERT INTO customer_contacts (customer_id, email, password_hash, full_name, role, must_change_password, invited_at)
		VALUES ($1, $2, $3, $4, $5, TRUE, NOW()) RETURNING id`,
		cid, req.Email, string(hash), req.FullName, req.Role).Scan(&id)
	if err != nil {
		if strings.Contains(err.Error(), "customer_contacts_email_key") {
			writeErr(w, http.StatusConflict, "email already in use")
			return
		}
		writeErr(w, http.StatusInternalServerError, "could not create member")
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
		VALUES ($1, $2, $3, TRUE) ON CONFLICT (contact_id, customer_id) DO NOTHING`,
		id, cid, req.Role); err != nil {
		writeErr(w, http.StatusInternalServerError, "could not create membership")
		return
	}
	raw, tokenHash, err := mintContactToken()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "token error")
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO password_resets (contact_id, token_hash, expires_at, purpose)
		VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, 'verification')`,
		id, tokenHash, verifyTTLMinutes); err != nil {
		writeErr(w, http.StatusInternalServerError, "token store error")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit error")
		return
	}
	sendContactInvite(h.Notify, h.Cfg.PortalBaseURL, req.Email, req.FullName, orgName, tempPassword, raw, "")
	writeJSON(w, http.StatusCreated, map[string]any{"contact_id": id, "linked": false})
}

// loadTargetMembership fetches the target's role in the active org + guards that
// they are actually a member of it. Also enforces the "admin can't touch owner"
// rule against the caller.
func (h *PortalHandler) loadTargetMembership(r *http.Request, cid, targetID string) (role string, found bool, err error) {
	e := h.DB.QueryRow(r.Context(),
		`SELECT role FROM contact_org_memberships WHERE contact_id = $1 AND customer_id = $2`,
		targetID, cid).Scan(&role)
	if errors.Is(e, pgx.ErrNoRows) {
		return "", false, nil
	}
	if e != nil {
		return "", false, e // real DB error — surface as 500, not a spurious 404
	}
	return role, true, nil
}

// privilegedGrant reports whether granting/managing this role is owner-only.
// owner AND billing carry capabilities an admin doesn't itself hold, so only an
// owner may grant or modify them (prevents capability escalation by proxy).
func privilegedGrant(role string) bool { return role == "owner" || role == "billing" }

type roleReq struct {
	Role string `json:"role"`
}

// PATCH /api/portal/members/{contactId}/role
func (h *PortalHandler) SetMemberRole(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	targetID := chi.URLParam(r, "contactId")
	var req roleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || !orgRoles[req.Role] {
		writeErr(w, http.StatusBadRequest, "invalid role")
		return
	}
	targetRole, found, err := h.loadTargetMembership(r, cid, targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if !found {
		writeErr(w, http.StatusNotFound, "member not found")
		return
	}
	// Only an owner may grant or modify a privileged (owner/billing) role.
	if (privilegedGrant(req.Role) || privilegedGrant(targetRole)) && callerRole(r) != "owner" {
		writeErr(w, http.StatusForbidden, "only an owner can manage owner or billing roles")
		return
	}
	// Atomic last-owner guard: demoting an owner only succeeds while another
	// active owner remains (no check-then-act race; a disabled ex-owner can
	// still be demoted because the guard requires ANOTHER *active* owner).
	res, err := h.DB.Exec(r.Context(),
		`UPDATE contact_org_memberships SET role = $3
		  WHERE contact_id = $1 AND customer_id = $2
		    AND ($3 = 'owner' OR role <> 'owner' OR `+otherActiveOwnerExists+`)`,
		targetID, cid, req.Role)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusConflict, "the organization must keep at least one owner")
		return
	}
	h.revokeContactTokens(r.Context(), targetID, cid)
	w.WriteHeader(http.StatusNoContent)
}

type memberStatusReq struct {
	Disabled bool `json:"disabled"`
}

// PATCH /api/portal/members/{contactId}/status — enable/disable in this org.
func (h *PortalHandler) SetMemberStatus(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	targetID := chi.URLParam(r, "contactId")
	var req memberStatusReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	targetRole, found, err := h.loadTargetMembership(r, cid, targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if !found {
		writeErr(w, http.StatusNotFound, "member not found")
		return
	}
	if targetRole == "owner" && callerRole(r) != "owner" {
		writeErr(w, http.StatusForbidden, "only an owner can manage owners")
		return
	}
	if !req.Disabled {
		if _, err := h.DB.Exec(r.Context(),
			`UPDATE contact_org_memberships SET disabled_at = NULL WHERE contact_id = $1 AND customer_id = $2`,
			targetID, cid); err != nil {
			writeErr(w, http.StatusInternalServerError, "db error")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// Disable, guarded atomically against removing the last active owner.
	res, err := h.DB.Exec(r.Context(),
		`UPDATE contact_org_memberships SET disabled_at = NOW()
		  WHERE contact_id = $1 AND customer_id = $2
		    AND (role <> 'owner' OR `+otherActiveOwnerExists+`)`,
		targetID, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusConflict, "the organization must keep at least one active owner")
		return
	}
	h.revokeContactTokens(r.Context(), targetID, cid)
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/portal/members/{contactId} — remove from this org (contact and
// their other orgs are untouched).
func (h *PortalHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	cid := customerID(r)
	targetID := chi.URLParam(r, "contactId")
	targetRole, found, err := h.loadTargetMembership(r, cid, targetID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if !found {
		writeErr(w, http.StatusNotFound, "member not found")
		return
	}
	if targetRole == "owner" && callerRole(r) != "owner" {
		writeErr(w, http.StatusForbidden, "only an owner can remove an owner")
		return
	}
	// Atomic last-owner guard (allows removing a disabled ex-owner).
	res, err := h.DB.Exec(r.Context(),
		`DELETE FROM contact_org_memberships
		  WHERE contact_id = $1 AND customer_id = $2
		    AND (role <> 'owner' OR `+otherActiveOwnerExists+`)`,
		targetID, cid)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "db error")
		return
	}
	if res.RowsAffected() == 0 {
		writeErr(w, http.StatusConflict, "the organization must keep at least one owner")
		return
	}
	h.revokeContactTokens(r.Context(), targetID, cid)
	w.WriteHeader(http.StatusNoContent)
}
