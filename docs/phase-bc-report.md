# Phase B' + C Report — Customer self-serve domain ordering + admin "Place" registration

**Date:** 2026-05-05
**Status:** ✅ Shipped — customers can now request domains from `/portal/domains/new`; admin can click "Place registration" on `/admin/orders/domains/{id}` to call the registry. Mock mode works today; real ResellerClub takes a single env-var flip.

---

## Email summary (≤ 150 words)

Two pieces shipped together. **(B)** The portal got a "+ Request a domain"
flow at `/portal/domains/new` — logged-in customers run the same availability
search as the public `/domains` page, pick a TLD, fill in the registrant
contact, and submit. The order lands in `domain_orders` tagged with their
`customer_id`; F2 staff sees it in the existing admin queue. **(C)** Admin
order detail now has a green **Place registration** button. For ResellerClub
orders it calls the registry (mock-mode returns a synthetic `MOCK-…` ID;
real-mode hits `httpapi.com`); for THNIC orders it transitions status to
`approved` with a note that F2 must complete the placement via the THNIC
partner portal. Idempotent (double-click can't double-charge), with a
confirmation step before the actual call. Cross-tenant isolation verified —
one customer can't see another's orders.

---

## What shipped

### Phase C — Real registration wiring (admin)

#### Backend (reseller-api)

- **`Register` method on the `Registry` interface** — every adapter now
  declares both availability and placement. `PlaceRequest` carries SLD,
  TLD, years, privacy flag, and registrant contact.
- **`Mock.Register`** — returns a synthetic `MOCK-XXXXXXXX` (8 hex chars
  from `crypto/rand`), status → `registered`. End-to-end demo works today
  without any creds.
- **`THNICStub.Register`** — returns status `approved` (F2 has committed,
  but the actual placement happens via the THNIC partner portal). No fake
  `registry_order_id` is set; staff fills it in via the existing Update
  endpoint after they place the order externally.
- **`ResellerClub.Register`** — calls
  `POST /api/domains/register.json` against `RESELLERCLUB_BASE_URL` with:
  - the registrant contact (`reg/admin/tech/billing` all set to a single
    F2-managed contact-id by default; configurable via env)
  - default nameservers (`RESELLERCLUB_DEFAULT_NS1` / `_NS2`)
  - `invoice-option=NoInvoice` (bills against reseller balance)
  - `protect-privacy=true|false` from the order

  Validates that `RESELLERCLUB_DEFAULT_CUSTOMER_ID`,
  `RESELLERCLUB_DEFAULT_CONTACT_ID`, and both NS env vars are set;
  returns a clear "set ENV_VAR_X" error if any are missing.
- **`POST /api/reseller/orders/{id}/place`** handler:
  - **Idempotent** — if `registry_order_id` is already set, returns the
    existing order without calling the registry again. Double-click safe.
  - **State-machine guarded** — only `pending` and `approved` orders can
    be placed; everything else returns 409.
  - **Audit-complete** — both success and failure responses are persisted
    to `registry_response` (JSONB) so the operator can see the full
    registry payload after the fact.
  - **Surfaces registry errors** — failures return 502 with the registry
    error message and the updated order in the body, so the UI can show
    what went wrong without a re-fetch.
- **4 new env vars** in `.env.example`:
  `RESELLERCLUB_DEFAULT_CUSTOMER_ID`, `_DEFAULT_CONTACT_ID`,
  `_DEFAULT_NS1`, `_DEFAULT_NS2`. All blank by default — Mock mode is
  the dev experience.

#### Frontend (admin)

- **"Place registration" button** in
  `/[locale]/admin/orders/domains/[id]/page.tsx`:
  - Only renders when the order is in a placeable state
    (`pending` / `approved`) and has no `registry_order_id` yet.
  - Two-step UX: click → confirmation card with the FQDN + years +
    "this charges your reseller balance" warning → confirm.
  - Surfaces registry-error messages inline on failure; refreshes
    the order panel automatically on success.

### Phase B — Customer self-serve ordering (portal)

#### Backend (customer-api)

- **`POST /api/portal/domains/orders`** — customer-aud JWT only.
  Inserts into the shared `domain_orders` table with `customer_id` from
  the token. Validates `sld`, `tld`, `registry`, registrant contact name
  + email; clamps `years` to 1–10.
- **`GET /api/portal/domains/orders`** — returns the customer's recent
  orders (last 50, newest first). Strictly filtered by `customer_id`
  from the JWT — no cross-tenant leakage possible.
- **`models.DomainOrder`** type added (mirrors the reseller-api shape
  but only the fields portal users see — no contact PII or audit blobs).

#### Frontend (portal)

- **`/[locale]/portal/domains/new/page.tsx`** — 4-step wizard:
  1. **Search** — typed SLD, validates shape, calls
     `/api/reseller/availability` (public endpoint).
  2. **Results** — per-TLD ✓/✗/F2-will-check badges. THNIC TLDs are
     selectable and route to `registry: "thnic"`; gTLDs to
     `registry: "resellerclub"`. Registered TLDs are disabled.
  3. **Form** — registrant contact, years (1–10), WHOIS privacy
     toggle, optional notes. Pre-filled with sensible defaults.
  4. **Done** — confirmation card with links back to `/portal/domains`
     or to start another.
- **`/[locale]/portal/domains` extension** — pending orders surface
  above the existing-domains table as small cards with status pill
  (Pending / Quoted / Approved / Rejected / Failed). Filter:
  anything not yet `registered` / `active` / `cancelled` / `rejected`.
  "+ Request a domain" CTA in the page header always visible.
- **Type bundle** added to `portal-api.ts`:
  `PortalDomainOrder`, `NewPortalDomainOrder`, `AvailabilityResult`,
  `DomainOrderStatus`. New methods: `listDomainOrders`,
  `createDomainOrder`, `checkAvailability` (public, no auth).

### Messages

- `messages/en.json` and `messages/th.json` extended with parity:
  - `portal.domains.orders.{requestNew, pendingTitle, requestedOn,
    years, privacyOn, status.{8 statuses}}`
  - `portal.domainsNew.*` (~30 keys: hero, search, results, form,
    fields, done, errors)
  - `admin.orders.detail.{placeButton, placeConfirm, placeConfirmYes}`

---

## Smoke matrix — all pass

| # | Check | Result |
|---|---|---|
| 1 | `tsc --noEmit` clean across web-app | ✅ |
| 2 | `go build ./...` clean for reseller-api + customer-api | ✅ |
| 3 | Admin Place on ResellerClub mock-mode order | ✅ status:`registered`, id:`MOCK-…` |
| 4 | Admin Place idempotent (double-click) | ✅ same `MOCK-…` returned |
| 5 | Admin Place on THNIC order | ✅ status:`approved`, id:null |
| 6 | Customer login (portal) | ✅ |
| 7 | Customer creates portal-side order | ✅ status:`pending`, customer_id set |
| 8 | Customer lists their orders | ✅ count:1 |
| 9 | Cross-tenant isolation: another customer sees count:0 | ✅ |
| 10 | All routes 200: `/portal/domains/new`, `/admin/orders/domains/{id}` | ✅ |

---

## Live access

| URL | Notes |
|---|---|
| <http://localhost/portal/domains/new> | Customer-facing wizard (requires customer JWT) |
| <http://localhost/portal/domains> | Now shows pending orders section |
| <http://localhost/admin/orders/domains/{id}> | "Place registration" button |
| `POST /api/portal/domains/orders` | New customer endpoint |
| `POST /api/reseller/orders/{id}/place` | New admin endpoint |

---

## How to flip from mock → live ResellerClub registration

1. ResellerClub reseller console → get `auth-userid` + `api-key` and the
   numeric Customer ID for the F2 reseller account, plus a default
   Contact ID (one record reused for reg/admin/tech/billing).
2. Decide on default nameservers (e.g. `dns1.f2.co.th` + `dns2.f2.co.th`,
   or whatever F2's hosting NS pair is).
3. Add to `.env`:

   ```bash
   RESELLERCLUB_AUTH_USERID=12345
   RESELLERCLUB_API_KEY=your-key
   RESELLERCLUB_BASE_URL=https://test.httpapi.com   # or httpapi.com for prod
   RESELLERCLUB_DEFAULT_CUSTOMER_ID=67890
   RESELLERCLUB_DEFAULT_CONTACT_ID=11111
   RESELLERCLUB_DEFAULT_NS1=dns1.f2.co.th
   RESELLERCLUB_DEFAULT_NS2=dns2.f2.co.th
   ```

4. `docker compose up -d --force-recreate reseller-api`
5. Boot log will read `registry: resellerclub-live`. The "Place" button
   in admin will now incur real charges against the reseller balance —
   the confirmation copy already warns about this.

---

## Caveats and follow-ups

- **All registrations register under F2's reseller umbrella.** The end
  customer's name is captured in `domain_orders.contact_*` for our own
  records but the registry-side WHOIS shows F2 contacts (with optional
  Privacy Protect). This is the standard "agency reseller" model —
  switch to per-customer ResellerClub Customer records if you need
  customer-on-WHOIS down the line.
- **Customer-initiated portal orders bypass admin approval.** They land
  as `status='pending'` and admin reviews in the existing queue. If
  F2 wants a "decline" workflow, it's already there via the existing
  PATCH endpoint (`status='rejected'` with notes).
- **No staff notification on portal-created orders yet.** F2 currently
  sees them by checking the queue. A `notify.NotifyStaffOnNewDomainOrder`
  helper is the obvious next step (mirrors the existing ticket flow).
- **THNIC remains stub-only.** Real EPP integration is still ops-blocked
  (mTLS cert, IP allowlisting). Until then "Place" on a `.th` order just
  flips status to `approved` with a tracker note.
- **No customer-side cancel.** Customers can't withdraw their own
  orders today — they have to ticket F2 to cancel a pending order.

---

## Tracker — recommended follow-ups

| # | Item | Effort |
|---|---|---|
| 1 | THNIC EPP integration (real availability + register via mTLS) | L |
| 2 | Staff email notification on customer-created order | S |
| 3 | Customer-side "cancel pending order" button (calls existing PATCH) | S |
| 4 | Per-classification cache TTL (premium 5min, available 30min, registered 24h) | S |
| 5 | Webhook receiver for ResellerClub status updates (transfer-in, renewal failures) | M |
| 6 | Lead → order conversion in `/admin/leads/{id}` | S |
| 7 | Traefik rate-limit on `/api/reseller/availability` (10 req/min/IP) | S |
