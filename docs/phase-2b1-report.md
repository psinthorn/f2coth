# Phase 2B.1 Report — Customer portal MVP

**Date:** 2026-04-30
**Status:** ✅ Shipped, live at http://localhost/portal

---

## Email summary (≤ 150 words)

The F2 client portal is live. SALA, Putahracsa, and Miskawaan now each have a
dedicated login at `/portal/login` where they can see what F2 does for their
account, contact their account manager, and raise support tickets that arrive
in F2's `/admin/tickets` queue. F2 staff reply from the admin side, can add
internal notes the customer never sees, and can route tickets between team
members. Cross-tenant isolation is enforced at four layers (DB filter on every
query, JWT audience separation, role check on admin routes, defensive `internal=FALSE` on portal message reads), and all 17 smoke checks pass — including the
critical cross-tenant ones (Putahracsa cannot see SALA tickets, customers
cannot reach admin endpoints, customers never see internal notes). Phase 2B.2
(domain portfolio + SLA dashboard + email notifications) is next.

---

## What shipped

### Database — `009_customers.sql`
Five new tables:
- `customers` — orgs (slug, services_used, account_manager_id, is_active)
- `customer_contacts` — login records (email, bcrypt password, role: owner/member, disabled_at)
- `customer_refresh_tokens` — separate from staff refresh_tokens
- `tickets` — customer_id, opened_by_contact_id, status, priority, assigned_to_user_id
- `ticket_messages` — author either user OR contact (CHECK enforced), `internal BOOLEAN`

**Seed:** 3 case-study clients pre-loaded with placeholder logins (password `Welcome2026!` — rotate on real handover).

### Backend — auth-api
- `POST /api/auth/customer/login` — returns JWT with `aud: "customer"` and embedded `customer_id`
- `POST /api/auth/customer/refresh`, `POST /api/auth/customer/logout`
- Staff JWTs now carry `aud: "staff"` (backwards compatible — middleware treats missing aud as staff)

### Backend — new `customer-api` service (port 8006)

**Customer-facing routes (`/api/portal/*`, `aud: customer`):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/portal/me` | Contact + parent customer info |
| GET | `/portal/tickets` | List tickets (filtered by customer_id from JWT) |
| POST | `/portal/tickets` | Create ticket + initial message |
| GET | `/portal/tickets/{id}` | Detail (404 if wrong tenant) |
| PATCH | `/portal/tickets/{id}/status` | Customer can set `resolved` or `open` only |
| GET | `/portal/tickets/{id}/messages` | Public messages only (`internal=FALSE`) |
| POST | `/portal/tickets/{id}/messages` | Reply (blocked when status=closed) |

**Staff-facing routes (`/api/customer/admin/*`, `aud: staff` + `RequireRole("admin","editor")`):**

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/customer/admin/customers` | List + create org |
| GET/PATCH | `/customer/admin/customers/{id}` | Detail + update |
| GET/POST | `/customer/admin/customers/{id}/contacts` | List + add contact |
| POST | `/customer/admin/customers/{id}/contacts/{contactId}/disable` | Soft-disable + revoke refresh tokens |
| POST | `/customer/admin/customers/{id}/contacts/{contactId}/enable` | Re-enable |
| GET | `/customer/admin/tickets[?status=...]` | Queue, sorted by priority then last_activity_at |
| GET | `/customer/admin/tickets/stats` | Open / in_progress / waiting / urgent_open counts |
| GET/PATCH | `/customer/admin/tickets/{id}` | Detail + status/priority/assignee |
| GET | `/customer/admin/tickets/{id}/messages` | All messages including internal |
| POST | `/customer/admin/tickets/{id}/messages` | Reply (with optional `internal: true`) |

### Frontend — Next.js

**Portal (3 routes + login):**
- `/portal/login` — separate from staff login, separate sessionStorage keys (`f2_portal_*`)
- `/portal` — account home (services contracted, account manager card, recent tickets)
- `/portal/tickets` — list with status badges and priority colours
- `/portal/tickets/new` — subject, body, priority, related-service dropdown (auto-populated from customer's contracted services)
- `/portal/tickets/[id]` — thread view, customer can reply, mark resolved, or reopen

**Admin (4 routes added to existing AdminShell):**
- `/admin/tickets` — queue with 4 stat tiles (open / in progress / waiting / urgent), filter by status, priority highlighting, urgent-open accent
- `/admin/tickets/[id]` — full thread (including internal notes flagged amber), reply form with internal toggle, inline status/priority/assignee controls
- `/admin/customers` — list with services, manager, active flag; add-customer form
- `/admin/customers/[id]` — profile editor + contacts section with add/disable/enable

**Shared infrastructure:**
- `lib/portal-api.ts` — typed customer-side client with auto-refresh on 401, `f2_portal_*` storage keys (isolated from staff session)
- `components/PortalShell.tsx` — sidebar with org name + auth gate
- AdminShell sidebar gained "Tickets" and "Customers" entries
- ConditionalChrome already excluded `/portal/*` from public Header/Footer

---

## Numbers

- **20 files** added / 4 modified
- **~2,300 LOC** (Go + TypeScript + SQL)
- **5 new tables** + **18 new endpoints** (7 portal + 11 admin)
- **6 new frontend routes**
- **1 new microservice** — `customer-api` on port 8006
- All 6 Go services and Next.js build clean

---

## Smoke matrix — 17/17 PASS

| # | Check | Result |
|---|---|---|
| 1 | SALA contact login → JWT | ✅ |
| 2 | Putahracsa contact login → JWT | ✅ |
| 3 | SALA `/portal/me` → "SALA Hospitality Group" | ✅ |
| 4 | Putahracsa `/portal/me` → "Putahracsa Hua Hin" | ✅ |
| 5 | SALA `POST /portal/tickets` → 201 | ✅ |
| 6 | SALA sees their own tickets | ✅ |
| 7 | **Putahracsa CANNOT see SALA tickets** | ✅ |
| 8 | **Cross-tenant `GET /portal/tickets/{id}` → 404** | ✅ |
| 9 | **Staff token on `/portal/me` → 403** (wrong audience) | ✅ |
| 10 | **Customer token on admin endpoint → 403** (wrong audience) | ✅ |
| 11 | Staff `/customer/admin/customers` lists all 3 | ✅ |
| 12 | Staff reply on ticket → 201 | ✅ |
| 13 | Staff internal note → 201 | ✅ |
| 14 | **Customer messages endpoint excludes internal note** | ✅ |
| 15 | Staff messages endpoint INCLUDES internal note | ✅ |
| 16 | Unauthenticated `/portal/me` → 401 | ✅ |
| 17 | `/portal/login` HTTP 200 | ✅ |

The bolded ones are the cross-tenant isolation tests — the highest-risk class for this phase. All passed cleanly.

---

## Security audit (delta)

| Severity | Class | Description | Resolution |
|---|---|---|---|
| **High → Verified** | A01 Access Control | Cross-tenant data leak. Every customer-side query filters by `customer_id` derived from JWT. Single-row reads use `WHERE id = $1 AND customer_id = $jwt_cid`. Tested: Putahracsa cannot read SALA tickets (test #7, #8). | ✅ |
| **High → Verified** | A01 Access Control | JWT audience separation. Staff JWT (`aud:staff`) rejected on portal routes (test #9). Customer JWT (`aud:customer`) rejected on admin routes (test #10). | ✅ |
| **High → Verified** | A04 Insecure Design | Internal notes leak. Public message endpoint enforces `internal=FALSE` in WHERE clause. Tested: customer sees public reply but not internal note (test #14, #15). | ✅ |
| **Medium → Verified** | A07 Auth Failures | Disabled customer or contact cannot log in (parallel logic to staff). Refresh tokens revoked on disable. | ✅ |
| **Medium → Verified** | A02 Cryptography | New contacts created with bcrypt(cost=12), password ≥12 chars enforced. Customer JWTs use the same HS256 signing key + 32-char min secret. | ✅ |
| **Info** | A04 Rate limiting | The customer login endpoint at `/api/auth/customer/login` is currently behind the `auth-ratelimit` middleware (10 req/min/IP) inherited from the parent `/api/auth` PathPrefix. Sufficient. | — |

**Sign-off:** `APPROVED`

---

## Risks & open items

- **R1** Three placeholder customer accounts share the same password (`Welcome2026!`). Acceptable for local testing. Before any real handover, F2 staff must use `/admin/customers/[id]` → "Add contact" with a unique strong password per customer (the seeded contacts can be disabled afterwards).
- **R2** No password reset flow for customers yet. If a customer forgets their password, F2 admin must add a new contact and disable the old one. Track for Phase 2C.
- **R3** Customer disable currently revokes refresh tokens but not in-flight access tokens (which are stateless JWTs valid for ~60 min). Acceptable trade-off; if we ever need immediate revocation, switch to opaque tokens or add a denylist.
- **R4** No email notifications on ticket events yet — customer doesn't know when F2 replies. Coming in Phase 2B.2.
- **R5** Tickets table doesn't track read/unread state per actor. The dashboard "recent activity" works as a proxy for now.

---

## Live access

| Audience | URL | Test credentials |
|---|---|---|
| Staff | http://localhost/admin | `admin@f2.co.th` / `F2@admin2026` |
| SALA contact | http://localhost/portal | `admin@salahospitality.com` / `Welcome2026!` |
| Putahracsa contact | http://localhost/portal | `gm@putahracsa.com` / `Welcome2026!` |
| Miskawaan contact | http://localhost/portal | `admin@miskawaanvillas.com` / `Welcome2026!` |

---

## What's next

Phase 2B.1 is feature-complete. Recommended pause to use the portal end-to-end before starting Phase 2B.2.

**Phase 2B.2 scope** (waiting on green light):
- Migration `010_customer_assets.sql` — `customer_domains`, `customer_sla_contracts`
- `/portal/domains` — only visible if `services_used` contains `domain-hosting` (SALA, Putahracsa)
- `/portal/sla` — only visible if `services_used` contains `it-support-msp` (Miskawaan)
- `/admin/customers/[id]/domains` and `/sla` — CRUD for F2 staff to populate the data
- Email notifications via `notification-api`: ticket-create → assignee/SALES_NOTIFY_TO; ticket-staff-reply → ticket opener
- Seed Miskawaan's M365 SLA contract (Mar 2026 – Mar 2027, 99.9%, status=active) so the page shows real data on day one
