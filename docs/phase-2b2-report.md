# Phase 2B.2 Report — Customer assets + ticket emails

**Date:** 2026-05-01
**Status:** ✅ Shipped, live at http://localhost/portal

---

## Email summary (≤ 150 words)

The portal is now genuinely useful to each F2 client, not just a helpdesk.
SALA sees their five-domain portfolio (registrar, expiry, privacy status,
auto-renew). Miskawaan sees a live SLA dashboard with a progress bar and
"days remaining" against their 99.9% target through March 2027. Putahracsa
sees both, when we add data. Ticket events now enqueue email notifications
(staff alert on new ticket and on customer replies; customer alert on staff
public replies; internal notes never leak via email). All entitlement
checks pass — Miskawaan can't see the Domains page (no `domain-hosting`
entitlement → 404); SALA can't see the SLA page (no contract → 404).
Smoke matrix: 10/10 passing.

---

## What shipped

### Database — `010_customer_assets.sql`

Two new tables and three new email templates.

- **`customer_domains`** — `(customer_id, domain UNIQUE)`, registrar, expires_at, privacy_enabled, auto_renew, last_dns_change_at, notes. Indexed on `(customer_id, domain)` and on `expires_at` (for upcoming-renewal queries).
- **`customer_sla_contracts`** — `(customer_id, service_slug, title, starts_on, ends_on, target_uptime_pct, status)`. CHECK on status enum + ends_on ≥ starts_on.
- **`notification_templates`** — added `ticket_received_staff`, `ticket_reply_customer`, `ticket_opened_on_behalf_customer`.
- **Seeded:** Miskawaan's M365 SLA contract (Mar 2026 → Mar 2027, 99.9%, status=active) and 5 placeholder SALA domains so the portal renders real-looking data on day one.

### Backend — `customer-api`

**Portal (entitlement-gated reads):**

| Method | Path | Gate | Behaviour |
|---|---|---|---|
| GET | `/portal/domains` | customer.services_used contains `domain-hosting` | 404 if not entitled |
| GET | `/portal/sla` | at least one row in `customer_sla_contracts` for this customer | 404 if no contracts |

**Admin (staff CRUD on customer assets):**

| Method | Path |
|---|---|
| GET / POST | `/customer/admin/customers/{id}/domains` |
| PATCH / DELETE | `/customer/admin/customers/{id}/domains/{domainId}` |
| GET / POST | `/customer/admin/customers/{id}/sla` |
| PATCH / DELETE | `/customer/admin/customers/{id}/sla/{slaId}` |

**Notifications (best-effort, async via goroutine):**

| Trigger | Template | Recipient |
|---|---|---|
| Customer creates ticket via portal | `ticket_received_staff` | assignee email or `SALES_NOTIFY_TO` |
| Staff opens ticket on behalf | `ticket_received_staff` (always) + `ticket_opened_on_behalf_customer` (if `opened_by_contact_id` set) | staff queue + the named contact |
| Staff posts non-internal reply | `ticket_reply_customer` | ticket opener (or customer's primary contact email as fallback) |
| Customer replies on a ticket | `ticket_received_staff` (re-uses template) | assignee or sales fallback |
| Staff posts INTERNAL note | (none) | — |

`customer-api` POSTs jobs to `notification-api`'s queue endpoint; failures log but never block the user-facing response.

### Frontend — Next.js

**Portal:**
- `/portal/domains` — read-only table with expiry countdown highlighting (`<60 days` flips red), privacy/auto-renew badges, last-DNS-change column. Friendly empty state for entitled-but-empty.
- `/portal/sla` — card grid per contract with title, period, target %, progress bar (accent-purple, flips red when overdue), notes. Friendly empty state.
- `PortalShell` — sidebar **conditionally** shows "Domains" only when `services_used` contains `domain-hosting`, and "SLA" only when the SLA endpoint returns data on probe. No menu items leak when there's nothing to see.

**Admin (inline panels on `/admin/customers/[id]`):**
- **Domain portfolio** panel — only renders when the customer has `domain-hosting`. Add domain (with date picker + privacy/auto-renew toggles), inline privacy toggle, remove with confirm.
- **SLA contracts** panel — always renders. Add SLA with service dropdown (auto-populated from customer's `services_used`), inline status dropdown per row, remove with confirm.

### Frontend client typing

`portal-api.ts` and `admin-api.ts` got new typed methods + interfaces (`PortalDomain`, `PortalSLA`, `AdminDomain`, `AdminSLA`).

---

## Numbers

- 8 files added / 5 modified
- ~1,400 LOC across Go + TypeScript + SQL
- 8 new endpoints (2 portal-facing, 6 staff-admin-facing)
- 2 new portal pages, 2 new inline admin panels
- 3 new email templates seeded

---

## Smoke matrix — 10/10 PASS

| # | Check | Result |
|---|---|---|
| 1 | SALA `/portal/domains` → 200 | ✅ |
| 2 | SALA sees 5 seeded domains | ✅ |
| 3 | Putahracsa entitled but empty → 200 | ✅ |
| 4 | **Miskawaan NOT entitled → 404** | ✅ |
| 5 | Miskawaan `/portal/sla` → 200 | ✅ |
| 6 | Miskawaan sees 1 SLA | ✅ |
| 7 | **SALA `/portal/sla` (no contract) → 404** | ✅ |
| 8 | Customer ticket create → `ticket_received_staff` queued | ✅ |
| 9 | Staff public reply → `ticket_reply_customer` queued | ✅ |
| 10 | **Internal note → does NOT enqueue customer email** | ✅ |

The bolded ones are the new isolation checks for this phase. All clean.

---

## Security audit (delta)

| Severity | Class | Finding | Resolution |
|---|---|---|---|
| **High → Verified** | A01 Access Control | Entitlement gating: `/portal/domains` checks `'domain-hosting' = ANY(services_used)` before reading; `/portal/sla` returns 404 if no rows exist for the customer. Tested: Miskawaan→404 on domains, SALA→404 on SLA. | ✅ |
| **High → Verified** | A01 Access Control | Cross-tenant: every admin asset query parameterises both `id` and `customer_id` so a stale path can't read another tenant's row. New tables inherit the existing pattern. | ✅ |
| **Medium → Verified** | A04 Insecure Design | Internal notes never trigger customer-facing notification. Admin `AddMessage` only fires `NotifyCustomerOnStaffReply` when `req.Internal == false`. Tested. | ✅ |
| **Medium → Verified** | A03 Injection | All inserts/updates use pgx parameterised arguments. Date fields go through `NULLIF($,'')::date`/`::timestamptz` casts so empty strings become NULL safely. | ✅ |
| **Info** | A09 Logging | `notify.Client.Send` runs in a goroutine and only logs `(template, status_code)` on failure — no email body in logs. | ✅ |

**Sign-off:** `APPROVED`

---

## Live test

| Audience | URL | What to look at |
|---|---|---|
| **SALA** (has domains) | http://localhost/portal | Sidebar shows **Domains** + Account + Tickets. SLA hidden. |
| **Miskawaan** (has SLA) | http://localhost/portal | Sidebar shows **SLA** + Account + Tickets. Domains hidden. |
| **Putahracsa** (has both contracts but no data) | http://localhost/portal | Domains visible (empty state). SLA hidden until F2 adds a contract. |
| **F2 staff** | http://localhost/admin/customers/[id] | Add/remove domains, add SLA contracts, switch SLA status. |

Login emails / passwords from Phase 2B.1: `admin@salahospitality.com`, `gm@putahracsa.com`, `admin@miskawaanvillas.com` (all `Welcome2026!`); staff `admin@f2.co.th` / `F2@admin2026`.

---

## Risks & open items

- **R1** SMTP credentials are still placeholders (`app-password-here`). Notifications enqueue and the worker tries to drain — it'll fail SMTP auth and mark them `failed`. **No production user gets an email yet.** Production cutover (Lane B) is the unblock.
- **R2** Anthropic balance = $0, so the chatbot still 502s. Same Lane B item.
- **R3** Domain portfolio is admin-entered, not synced from ResellerClub. ResellerClub API integration is a future Phase 2D item — for now, F2 staff types in domains.
- **R4** SLA status is admin-set; we don't yet compute uptime % from real ticket / incident data. The page shows the *target*, not actual.
- **R5** Notification body content is plain-text; HTML / branded email template is a future polish item.

---

## What's next

Phase 2B.2 closes the **portal arc**. The natural next step is **Lane B — production cutover** (HTTPS, real SMTP, real Anthropic credit, DNS to f2.co.th, basic CI). The portal does its job locally; now it needs to do its job on the public internet.

Reply **"go B"** when ready to ship.
