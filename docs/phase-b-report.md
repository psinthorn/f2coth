# Phase B Report — Reseller API integration (live domain availability + order tracking)

**Date:** 2026-05-01
**Status:** ✅ Shipped — `reseller-api` (service #7) live on `:8007`, public availability API powering `/domains`, admin order queue at `/admin/orders/domains`. Sandbox-by-default with mock fallback when creds are absent.

---

## Email summary (≤ 150 words)

F2 now has its own `reseller-api` microservice abstracting the two domain
registries we resell through. The public `/domains` page no longer just
captures intent — it does a real availability check on five TLDs in parallel
and shows ✓ / ✗ / "F2 will check" badges next to each. ResellerClub goes
through their sandbox API by default; if creds aren't set the service falls
back to a deterministic mock so the UI demos cleanly. Thai ccTLDs (.co.th /
.or.th / .in.th) are explicitly stubbed — F2 still places those manually
through the THNIC partner portal — but they appear in the same flow with a
clear "manual" label. Staff get a queue at `/admin/orders/domains` with
filter, create, status transitions, and registry-order-id tracking. All
copy in EN + TH. To go production: drop real ResellerClub credentials into
`.env` and flip `RESELLERCLUB_BASE_URL` to `https://httpapi.com`.

---

## What shipped

### DBA — `014_orders.sql`

- `domain_orders` table — registration / transfer / renewal queue. Links
  optionally to `customers`, `leads`, or `users` (requested_by). Status
  enum has 8 states (`pending` … `failed`). `fqdn` is a generated column
  so admin can search by full name without re-concatenating.
- `domain_availability_cache` — TTL-keyed cache (default 15 min) of
  registry lookups so we don't burn ResellerClub quota. Source enum
  distinguishes `resellerclub` / `thnic_stub` / `mock` so admins can
  tell where each cached answer came from.
- `purge_expired_availability_cache()` SQL function for opportunistic
  janitoring (called fire-and-forget on each lookup batch).
- 5 indexes on `domain_orders` for the queue UI's filter axes.

### Backend — new `reseller-api` service (port 8007)

- Standard Go skeleton mirroring cms-api / customer-api: chi router,
  pgx pool, request-ID + recoverer middleware, distroless runtime.
- **Registry abstraction** (`internal/registry/`):
  - `Registry` interface (Name, Owns, CheckAvailability).
  - `Router` fans out by TLD ownership.
  - `ResellerClub` — wraps `GET /api/domains/available.json` against
    `RESELLERCLUB_BASE_URL` (defaults to `test.httpapi.com`).
  - `THNICStub` — owns `.co.th` / `.or.th` / `.in.th` / `.ac.th` / `.go.th`,
    always returns `classification = manual` (no false claims about a
    name we can't actually verify yet).
  - `Mock` — fallback when `RESELLERCLUB_AUTH_USERID` or `RESELLERCLUB_API_KEY`
    is empty. Deterministic per-FQDN via FNV-1a so re-checks during a demo
    don't flip-flop. SLDs ≤ 3 chars classify as "premium".
- **Cache store** (`internal/store/cache.go`) — read-through with
  `ON CONFLICT DO UPDATE` for the write-back, expired rows ignored.
- **Handlers**:
  - `POST /api/reseller/availability` — public. Validates SLD shape,
    rejects > 10 TLDs, splits cache hits from misses, fetches misses
    in parallel via the router, returns results in the requested order.
  - `GET /api/reseller/orders` — admin (staff JWT). Optional
    `?status=` and `?registry=` filters.
  - `GET /api/reseller/orders/{id}` — admin.
  - `POST /api/reseller/orders` — admin. Stamps
    `requested_by_user_id` from the JWT `sub` claim.
  - `PATCH /api/reseller/orders/{id}` — admin. Updates status / registry
    order id / notes; status transitions validated against the enum.
- **Auth middleware** (`internal/middleware/jwt.go`) — `RequireStaffJWT`
  validates HS256 with the shared `JWT_SECRET`, gates by `aud=staff`.
- **Config** flag `RCConfigured()` controls whether the live ResellerClub
  adapter is registered. Boot log advertises mode (`registry: mock` or
  `registry: resellerclub-live`) so it's obvious which mode the
  container is running in.
- Compose entry + Traefik route `PathPrefix(/api/reseller)` → port 8007.
- `.env` + `.env.example` extended with 4 new keys
  (`RESELLERCLUB_BASE_URL`, `RESELLERCLUB_AUTH_USERID`, `RESELLERCLUB_API_KEY`,
  `RESELLER_OUTBOUND_TIMEOUT`, `RESELLER_CACHE_TTL`).

### Frontend — public `/domains`

- `DomainsClient.tsx` rewritten as a 2-step flow:
  1. **Search** — single text field, sanitises to a valid SLD, sends
     `POST /api/reseller/availability` with 5 default TLDs (.com /
     .net / .co.th / .or.th / .in.th).
  2. **Results** — list of FQDNs with classification badges
     (Available / Registered / Premium / F2 will check), pre-checks
     all available rows, registered rows are checkbox-disabled.
     Manual rows show the THNIC info hint inline.
- Lead form persists below the results card and submits with the
  selected FQDNs in the message body, source `domain_search`.
- `/th/domains` — Thai labels for all badges, hint, and CTAs.

### Frontend — admin

- `/[locale]/admin/orders/domains/page.tsx` — list view with
  status pill filter, per-row links, "New order" modal that calls
  `POST /api/reseller/orders`.
- `/[locale]/admin/orders/domains/[id]/page.tsx` — detail page with
  registrant info + status / registry-order-id / notes editor, mode
  notice when running in mock.
- `AdminShell.tsx` nav extended with "Domain Orders" item (Globe icon).
- `lib/admin-api.ts` got `listDomainOrders`, `getDomainOrder`,
  `createDomainOrder`, `updateDomainOrder` plus `AdminDomainOrder`,
  `DomainOrderStatus`, and `NewDomainOrder` types.

### Messages

- `messages/en.json` and `messages/th.json` extended with parity:
  - `domains.search.checkingLive` / `resultsTitle` / `checkAgain` /
    `selectedHint` / `requestSelected`
  - `domains.status.{available,registered,premium,manual,unknown,manualHint}`
  - `admin.shell.nav.orders`
  - `admin.orders.{title, subtitle, empty, filterAll, newOrder, headers, statuses, detail, create}` (~30 keys total)

---

## Smoke matrix — all pass

| # | Check | Result |
|---|---|---|
| 1 | `reseller-api` boots, advertises `registry: mock, base=https://test.httpapi.com` | ✅ |
| 2 | `POST /api/reseller/availability` returns mixed-source results in mock mode | ✅ 4 TLDs, `mock` + `thnic_stub` |
| 3 | Second identical lookup returns `cached:true` | ✅ |
| 4 | THNIC TLDs classify as `manual`, never as `available` | ✅ verified for `.co.th` |
| 5 | `/domains` shows live results card after search (EN) | ✅ |
| 6 | `/th/domains` shows Thai badges and "F2 จะตรวจให้" hint | ✅ |
| 7 | `GET /api/reseller/orders` without token → 401 | ✅ |
| 8 | Login as admin, `POST /api/reseller/orders` → 201 with `requested_by_user_id` set | ✅ |
| 9 | `GET /api/reseller/orders` with token returns the new order | ✅ orders: 1 |
| 10 | `/admin/orders/domains` returns 200 | ✅ |
| 11 | `tsc --noEmit` clean across web-app | ✅ |
| 12 | `go build ./...` clean for `reseller-api` | ✅ |
| 13 | `domain_availability_cache` rows persisted, source column populated | ✅ |

---

## Live access

| URL | Notes |
|---|---|
| <http://localhost/domains> | EN — live search + lead capture |
| <http://localhost/th/domains> | TH — same flow, Thai labels |
| <http://localhost/admin/orders/domains> | Admin queue (requires staff JWT) |
| `POST http://localhost/api/reseller/availability` | Public, JSON: `{sld, tlds[]}` |
| `* http://localhost/api/reseller/orders[/{id}]` | Admin-only, staff JWT |

---

## How to flip from mock → live ResellerClub

1. Get `auth-userid` + `api-key` from your ResellerClub reseller console.
2. Add to `.env`:

   ```bash
   RESELLERCLUB_AUTH_USERID=12345
   RESELLERCLUB_API_KEY=your-key-here
   ```

3. (Optional) for production rather than sandbox, also set:

   ```bash
   RESELLERCLUB_BASE_URL=https://httpapi.com
   ```

4. `docker compose up -d --force-recreate reseller-api`. The boot log
   will now read `registry: resellerclub-live`.

When credentials are missing, the service still serves the API — it just
routes gTLDs through the deterministic mock. THNIC TLDs always go through
the manual stub regardless of mode (no auto-place yet).

---

## Caveats and follow-ups

- **THNIC is still manual.** Real EPP-with-mTLS against THNIC needs an
  ops conversation (cert provisioning, IP allowlisting). Until then,
  every `.th` order is dropped in the queue with "manual" status and F2
  staff places it via the THNIC partner portal. Phase 4D candidate.
- **No actual order placement to ResellerClub yet.** `domain_orders`
  is a tracking layer; the "Approve & register" button isn't wired to
  the registry register endpoint. Status changes in admin are
  bookkeeping only — the admin detail page shows a banner when in mock.
  Phase 4C will wire `POST /api/domains/register`.
- **Cache TTL is global, not per-TLD.** ResellerClub recommends
  re-checking premium domains more often than commodity ones. We can
  shorten TTL to 5 min for `premium`-classified rows in a follow-up.
- **No registry availability for `.org` / `.io` / `.app` etc.** They're
  in the ResellerClub adapter's owned-TLD set but `/domains` only
  surfaces 5 TLDs in the default search. We can let the user pass a
  custom TLD list (e.g. via a "more options" toggle).
- **No rate-limit on the availability endpoint.** A bot could probe
  thousands of names. Acceptable while we have the cache + a sane
  outbound timeout, but Traefik rate-limit middleware should be added
  before going public.

---

## Tracker — recommended follow-ups

| # | Item | Effort |
|---|---|---|
| 1 | Wire ResellerClub `register` endpoint to admin "Approve" action; persist `registry_order_id` from the response | M |
| 2 | THNIC EPP integration (cert provisioning, real availability + register) | L |
| 3 | Per-classification cache TTL (premium = 5 min, available = 30 min, registered = 24 h) | S |
| 4 | Customer-facing portal flow: logged-in customer → `/portal/domains/new` → creates a `domain_orders` row tied to their `customer_id` | M |
| 5 | Traefik `ratelimit` middleware on `/api/reseller/availability` (10 req/min/IP) | S |
| 6 | Lead → order conversion in admin (one-click "Convert this domain_search lead to an order") | S |
| 7 | Webhook receiver for ResellerClub status updates (transfer-in completed, renewal failed, etc.) | M |
