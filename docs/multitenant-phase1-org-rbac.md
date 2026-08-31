# Multi-Tenant Phase 1 — Organization RBAC

**Status:** spec / not started
**Depends on:** nothing (foundation). Unblocks Phases 2–4.
**Delivers:** Goal 1 (users have a real level within their org) + org self-administration.

---

## 0. Decisions locked

- **D3 — "manage the sections related to them" = portal write-access to project checklist sections/sub-sections/items**, role-gated, behind a per-project opt-in flag. This is **Phase 4**, not Phase 1; recorded here so scope is unambiguous.
- **D1 — role set = 5 levels**: `owner · admin · billing · member · viewer`.
- **D4 — ticket privacy is role-based** (Members see own; Owner/Admin see all) — implemented in **Phase 2**; Phase 1 only lays the role plumbing.

Phase 1 makes roles *real* and gives Owners/Admins the ability to run their own org (invite + manage their own team). It deliberately does **not** touch tickets, checklists, entitlements, or self-registration.

---

## 1. Why this is small

The hard part is already done:

- The customer JWT already carries `role` = **the active org's membership role**, set at login (`customer_auth.go:164`), re-minted on switch-org (`customer_account.go:334`), and re-derived on refresh via `pickActiveMembership` (`customer_auth.go:242-244`).
- `customer-api` middleware already exposes it as `CtxRole` (`internal/middleware/jwt.go:70`) and already has a generic `RequireRole(allowed…)` gate (`jwt.go:118-134`).
- Role already lives on `contact_org_memberships.role` — correct per-org (a person can be Owner of A, Viewer of B).

So Phase 1 = widen the enum, add a **central permission map**, add **portal member-management endpoints** (today member management is staff-only), and **gate existing sensitive surfaces**.

---

## 2. Role model

| Role | Intent |
|---|---|
| `owner` | Full control of the org, incl. billing, member management (incl. other owners), and closing the org. At least one required at all times. |
| `admin` | Runs the org day-to-day: members (except owners), tickets, sections/assets. **No** billing, **cannot** manage owners or delete the org. |
| `billing` | Invoices, subscriptions, payments, billing profile. Read-only elsewhere. |
| `member` | Creates & manages **own** tickets; updates item status on editable sections (Phase 4). Read shared resources. |
| `viewer` | Read-only across the board. |

Authoritative role = the **membership** row. `customer_contacts.role` is legacy/denormalized and not consulted for authz (login overwrites `c.Role` from the membership).

---

## 3. Permission matrix (Phase 1 scope in **bold**)

| Capability (constant) | owner | admin | billing | member | viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| **`ManageOrgProfile`** | ✓ | ✓ | – | – | – |
| **`ManageMembers`** | ✓ | ✓* | – | – | – |
| **`ManageBilling`** | ✓ | – | ✓ | – | – |
| **`CloseOrg`** | ✓ | – | – | – | – |
| `ViewAllTickets` (P2) | ✓ | ✓ | view | own | view |
| `CreateTicket` (P2) | ✓ | ✓ | – | ✓ | – |
| `AdminTicket` close/reassign (P2) | ✓ | ✓ | – | – | – |
| `ManageSections` (P4) | ✓ | ✓ | – | status | – |
| `ViewReports` | ✓ | ✓ | ✓ | ✓ | ✓ |

`*` Admin may manage members with role ≤ admin; may not create/modify/remove **owners**.

Phase 1 implements the **bold** rows plus the member-management sub-rules in §6. The rest are stubbed in the same map (so Phases 2/4 just flip them on).

---

## 4. Data model — migration `078_org_roles.sql`

Additive, idempotent, no backfill (existing `owner`/`member` stay valid).

```sql
-- Widen the authoritative per-org role enum.
ALTER TABLE contact_org_memberships DROP CONSTRAINT IF EXISTS contact_org_memberships_role_check;
ALTER TABLE contact_org_memberships
  ADD CONSTRAINT contact_org_memberships_role_check
  CHECK (role IN ('owner','admin','billing','member','viewer'));

-- Keep the denormalized column in sync-able (not authoritative, but avoid insert failures).
ALTER TABLE customer_contacts DROP CONSTRAINT IF EXISTS customer_contacts_role_check;
ALTER TABLE customer_contacts
  ADD CONSTRAINT customer_contacts_role_check
  CHECK (role IN ('owner','admin','billing','member','viewer'));
```

No new tables in Phase 1. (`customers.status`, entitlements, `projects.customer_editable` belong to later phases.)

---

## 5. Backend — authorization layer (`customer-api`)

### 5.1 Central permission map — `internal/authz/authz.go` (new)

Single source of truth mirroring §3 — no scattered string checks.

```go
package authz

type Capability string

const (
    ManageOrgProfile Capability = "manage_org_profile"
    ManageMembers    Capability = "manage_members"
    ManageBilling    Capability = "manage_billing"
    CloseOrg         Capability = "close_org"
    ViewAllTickets   Capability = "view_all_tickets" // P2
    // …
)

var matrix = map[Capability]map[string]bool{
    ManageOrgProfile: {"owner": true, "admin": true},
    ManageMembers:    {"owner": true, "admin": true},
    ManageBilling:    {"owner": true, "billing": true},
    CloseOrg:         {"owner": true},
}

func Can(role string, cap Capability) bool { return matrix[cap][role] }
```

### 5.2 Middleware — `RequireCap`

Thin wrapper over the existing `CtxRole` plumbing:

```go
func RequireCap(cap authz.Capability) func(http.Handler) http.Handler {
    // read CtxRole; 403 unless authz.Can(role, cap)
}
```

Reuse the existing `RequireRole` for the simplest gates if preferred, but `RequireCap` keeps intent readable and the matrix authoritative.

### 5.3 Member-management endpoints (new) — portal, Owner/Admin only

Mounted under the existing customer portal group (`RequireJWT` + `RequireAudience("customer")` + `BlockIfMustChangePassword`) in `customer-api/cmd/server/main.go`, each additionally `RequireCap(ManageMembers)`:

| Method / path | Handler | Notes |
|---|---|---|
| `GET  /portal/members` | `ListMembers` | Active org's members (join `contact_org_memberships` + `customer_contacts`), with role, status, verified/invited state. |
| `POST /portal/members/invite` | `InviteMember` | Reuse the invite machinery in `contacts_invite.go` (temp pw, `must_change_password`, verification email) — but scoped to the caller's **active** `customer_id`, not a staff-chosen one. |
| `PATCH /portal/members/{contactId}/role` | `SetMemberRole` | Change membership role. Rules in §6. |
| `PATCH /portal/members/{contactId}/status` | `SetMemberStatus` | Toggle `disabled_at` (enable/disable in this org). |
| `DELETE /portal/members/{contactId}` | `RemoveMember` | Delete the membership for this org (not the global contact). |

All scoped by `customerID(r)` (active org from JWT). None can touch a contact who isn't a member of the caller's active org.

### 5.4 Gate existing sensitive surfaces

Add `RequireCap(...)` to routes that already exist:

- Billing / invoices / subscriptions / payments / billing-profile → `RequireCap(ManageBilling)`.
- Org-profile/settings mutations (if/when portal-editable) → `RequireCap(ManageOrgProfile)`.
- **Own profile & password stay ungated** (every member manages themselves).

### 5.5 Make role changes near-immediate

Role is a JWT claim, so a change only takes effect on the target's next refresh (≤ access-token TTL, 60 min). To tighten:

- On `SetMemberRole` / `SetMemberStatus` / `RemoveMember`, **revoke the target contact's `customer_refresh_tokens`** (same pattern password-change already uses). Their next request 401s → refresh fails → they re-login with the new role/state. Document the ≤60-min residual on the *access* token as acceptable, or add an optional active-membership re-check on sensitive caps.

---

## 6. Member-management authorization rules

Enforced in the handlers (not expressible in the flat matrix):

1. **Last-owner protection** — cannot demote, disable, or remove the org's only remaining `owner`. Return `409 "the organization must keep at least one owner"`.
2. **Admins can't touch owners** — an `admin` caller may not create, promote-to, demote, disable, or remove any `owner`. `403`.
3. **Admins can't grant owner** — `SetMemberRole` to `owner` requires the caller be `owner`.
4. **Self-guard** — a caller cannot remove or demote **themselves** below their current power if it would violate rule 1 (e.g. sole owner). Changing your own role otherwise is allowed but discouraged in UI.
5. **Scope** — target must be a member of the caller's active org; email is the global identity, but the mutation only affects the `contact_org_memberships` row for `customer_id = active`.

---

## 7. Frontend (`web-app`)

### 7.1 New portal section — Team

- Route `src/app/[locale]/portal/team/page.tsx`. Nav entry in `PortalShell.tsx`, shown only when the active-org role ∈ {`owner`,`admin`}.
- Table of members: name, email, **role badge**, status (active / invited / disabled / unverified), last login. Actions per row (role `<select>`, disable/enable, remove) with the §6 rules reflected in disabled states.
- "Invite member" button → modal (email, full name, role). Admins can't pick `owner`.

### 7.2 API client — `src/lib/portal-api.ts`

Add: `listMembers()`, `inviteMember({email, full_name, role})`, `setMemberRole(contactId, role)`, `setMemberStatus(contactId, disabled)`, `removeMember(contactId)`.

### 7.3 Role-aware nav & guards

- `/me` must return the **active-org role** (confirm the portal `/me` payload includes it; add if missing). PortalShell reads it once and exposes it via context.
- Hide the **Billing** nav for roles without `ManageBilling`; hide **Team** for non-managers. (Server still enforces — nav hiding is UX only.)
- Add a tiny client mirror of the capability map for nav/enable decisions (server remains authoritative).

### 7.4 i18n

EN + TH keys for the Team page, role names, statuses, invite modal, and the §6 error messages. Maintain `npm run i18n-check` parity.

---

## 8. Module toggle

Register a `portal.team` module (matching the platform's module-toggle convention) so org self-administration can be switched off globally if needed.

---

## 9. Out of scope (later phases)

- Ticket own/all visibility + close/reassign/priority → **Phase 2**.
- Self-registration (`/register`, `customers.status`) → **Phase 3**.
- Per-tenant entitlements + customer-managed checklist sections (`customer_editable`) → **Phase 4**.
- Postgres row-level security → **Phase 5**.

---

## 10. Acceptance criteria

1. Migration 078 applies; existing owner/member data still valid; all five roles insertable.
2. A `member` calling any `/portal/members*` write → `403`. A `viewer` calling billing → `403`.
3. An `owner` can invite a teammate (email arrives, invitee completes verify + set-password), set their role, disable, and remove them — all scoped to the active org only; a second org the invitee belongs to is untouched.
4. Last-owner protection, admin-can't-touch-owner, and admin-can't-grant-owner all return the right 4xx.
5. Changing a member's role revokes their refresh tokens; after their next login the new role is in effect (verified via the JWT `role` claim and a previously-forbidden action now allowed / forbidden).
6. `go test` + `go vet` green; `tsc` clean; `i18n-check` parity holds.
7. End-to-end verified through the real portal UI (invite → accept → role change → gate enforced), per the project's verify workflow.

---

## 11. Rough effort

| Area | Work |
|---|---|
| Migration 078 | trivial |
| authz map + `RequireCap` | small |
| Member-management handlers (5) + §6 rules | medium (reuses invite machinery) |
| Gate existing billing/settings routes | small |
| Refresh-token revoke on role change | small |
| Portal Team page + API client + nav | medium |
| i18n EN/TH | small |
| Tests + Playwright verify | medium |

One focused change set — no cross-service ripple beyond `customer-api` + `web-app` (auth-api unchanged; it already mints the per-org role).
