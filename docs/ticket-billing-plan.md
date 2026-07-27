# Ticket Billing — Spec & Plan

**Status:** Draft for build · **Owns:** ticket chargeability + attached priced line items → invoice
**Prior-art verdict:** REUSE money/VAT + invoice machinery; NEW ticket line-items + rate card.

---

## 1. Goal

A ticket / service request carries a **billing outcome per line of work**:

- **Covered** by an active contract/SLA → no charge (shown at ฿0), or
- **Billable** → an extra charge at a rate.

Staff **attach related services/products** to a ticket — either picked from a managed **rate card** or typed **free-text** — each with a quantity × rate. A billable ticket can **generate a draft invoice** through the existing payment-api. The customer **sees** coverage/charges on their portal ticket.

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Rate source | **Rate card + free-text** — pick a catalogue item (rate snapshots, editable) or type a custom line. |
| Coverage granularity | **Per-line** covered/billable; ticket extra charge = Σ billable lines. Auto-suggest *covered* when an active SLA matches the ticket's service. |
| Invoicing | **Generate a real DRAFT invoice** from billable lines via payment-api `AdminCreate` (VAT + tax-invoice flow reused). |
| Customer visibility | **Show on portal** — coverage note + itemized extra charge + invoice link. |

## 3. Reuse (canonical — do not rebuild)

| Need | Existing primitive | Verdict |
|---|---|---|
| Money / VAT / format | **BIGINT minor units** (satang), `currency` THB/USD, `vat_rate_bp` (700=7%), `formatMoney()` (`payment-types.ts`) | **REUSE** |
| Priced line items + invoice gen | `invoice_items` (qty × unit_price, bilingual, `product_ref`) + `InvoiceHandler.AdminCreate` (`payment-api/internal/handlers/invoices.go`) | **REUSE / EXTEND** |
| Coverage signal | `customer_sla_contracts` (service_slug + active date window) shares slug space with `tickets.related_service_slug` | **REUSE** (auto-suggest only) |
| Ticket write path | `admin.go` `CreateTicketForCustomer` / `UpdateTicket`; ticket detail admin page | **EXTEND** |
| "billable" precedent | `visit_logs.billable` | reference |

**NOT reusable:** `contract-api` is a PDF document generator (no covered-services/rates); it does not decide "no charge."

## 4. Data model — migration `073_ticket_billing.sql` (072 is head)

```sql
-- 4.1 Rate card (price book). No price book exists today; this is the catalogue.
CREATE TABLE rate_card_items (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                     TEXT UNIQUE,                  -- optional short code
    name_en TEXT NOT NULL, name_th TEXT,
    description_en TEXT, description_th TEXT,
    unit                     TEXT NOT NULL DEFAULT 'item', -- hour|visit|seat|item…
    default_unit_price_cents BIGINT NOT NULL CHECK (default_unit_price_cents >= 0),
    currency                 TEXT NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB','USD')),
    category                 TEXT,
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order               INT NOT NULL DEFAULT 0,
    created_at, updated_at   TIMESTAMPTZ …
);
-- seed a handful (remote support/hour, onsite callout/visit, M365 seat…).

-- 4.2 Per-ticket line items. Mirrors invoice_items so a billable ticket maps 1:1.
CREATE TABLE ticket_line_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id         UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    rate_card_item_id UUID REFERENCES rate_card_items(id) ON DELETE SET NULL, -- NULL = free-text
    description_en TEXT NOT NULL, description_th TEXT,
    unit              TEXT NOT NULL DEFAULT 'item',
    quantity          INT  NOT NULL DEFAULT 1 CHECK (quantity > 0),   -- INT to match invoice_items
    unit_price_cents  BIGINT NOT NULL CHECK (unit_price_cents >= 0),  -- the rate (kept even if covered)
    covered           BOOLEAN NOT NULL DEFAULT FALSE,                 -- true = under contract, ฿0
    -- billable contribution: 0 when covered, else quantity*unit_price_cents
    amount_cents      BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    currency          TEXT NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB','USD')),
    sort_order        INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON ticket_line_items(ticket_id);

-- 4.3 tickets: billing summary + invoice link
ALTER TABLE tickets
    ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'none'
        CHECK (billing_status IN ('none','covered','billable')),
    ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
-- billing_status kept in sync by the line-item handlers:
--   none = no lines · covered = ≥1 line, all covered · billable = ≥1 billable line.

-- 4.4 let invoice line items represent a ticket charge
ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_product_type_check;
ALTER TABLE invoice_items ADD  CONSTRAINT invoice_items_product_type_check
    CHECK (product_type IN ('domain','hosting','sla','msp','custom','ticket'));

-- 4.5 module toggles: admin.ticket_billing, portal.ticket_billing, admin.rate_card
```

**Constraints/notes**
- **One currency per ticket** (invoice requires it) — enforced in the handler.
- `quantity` is INT for a clean `invoice_items` mapping. Fractional hours (1.5h) are handled via unit choice (per-30-min) in v1; NUMERIC quantity is a possible follow-up.
- Covered lines keep their `unit_price_cents` (so the portal can show "normally ฿2,500 — covered") but contribute `amount_cents = 0`.

## 5. Coverage auto-suggest

On ticket load / line add, look up an **active** SLA for the ticket's service:
```sql
SELECT title FROM customer_sla_contracts
 WHERE customer_id=$1 AND service_slug=$2 AND status='active'
   AND CURRENT_DATE BETWEEN starts_on AND ends_on LIMIT 1;
```
If found → new lines default `covered=true` and the UI shows "Covered by: {title}". Staff override per line. (Signal only — never blocks.)

## 6. Backend (customer-api — tickets live here)

**Rate card admin** (`rate_card.go`, staff `admin`/`editor`):
- `GET/POST /customer/admin/rate-card`, `PATCH /customer/admin/rate-card/{id}` (soft-delete via `is_active`).

**Ticket line items** (`ticket_billing.go`, staff):
- `GET /customer/admin/tickets/{id}/billing` → lines + summary (billable subtotal, VAT preview, coverage hint, invoice link).
- `POST /customer/admin/tickets/{id}/line-items` `{rate_card_item_id? | description_*, unit, quantity, unit_price_cents, covered}` — snapshots rate-card fields when an item id is given; recomputes `amount_cents` + `tickets.billing_status`.
- `PATCH/DELETE …/line-items/{lineId}` — recompute on every change.
- `POST /customer/admin/tickets/{id}/generate-invoice` → builds items from **billable** lines (`product_type='ticket'`, `product_ref=ticket.id`), **forwards the caller's staff Bearer token** to payment-api `POST /api/payment/admin/invoices` (`AdminCreate` — so audit + VAT are native), stores `tickets.invoice_id`, returns `{invoice_id, invoice_number}`. Guard: billable + not already invoiced.

**Portal** (customer): extend `GetTicket` (or `GET /portal/tickets/{id}/billing`) to return coverage note + billable lines + total + invoice link. Read-only.

**Config:** add `PAYMENT_API_URL` to customer-api.

## 7. Frontend

**Admin**
- **Rate card page** (`/admin/rate-card`, gated `admin.rate_card`): CRUD table (name EN/TH, unit, default rate, active).
- **Ticket detail billing panel** (`/admin/tickets/[id]`): coverage-hint banner; line list with per-line **covered** toggle; **Add line** = rate-card picker *or* free-text (rate auto-fills, editable); running **billable subtotal + VAT + total** (`formatMoney`); **Generate invoice** button → links to the created draft invoice.

**Portal**
- **Ticket billing section** (`/portal/tickets/[id]`, gated `portal.ticket_billing`): "Covered by your {SLA} — no charge" and/or itemized "Additional work: ฿X + VAT" with a **View invoice** link once issued.

## 8. Cross-cutting

- Money in minor units; VAT via invoice default `vat_rate_bp=700`; display via `formatMoney()`.
- Bilingual EN+TH in the same change (`make i18n-check`); module gating on all new routes; audit via existing `audit_log` where staff mutate.
- Idempotent migration; new module keys seeded EN+TH and surfaced on `/admin/features`.

## 9. Reuse ledger

| Area | REUSE | EXTEND | NEW |
|---|---|---|---|
| Money/VAT | minor-units, `vat_rate_bp`, `formatMoney` | — | — |
| Invoicing | `invoices`+`invoice_items`+`AdminCreate` | `product_type += 'ticket'` | ticket→invoice bridge (token-forward) |
| Coverage | `customer_sla_contracts` match | — | per-line `covered` + auto-suggest |
| Tickets | admin/portal handlers + pages | `billing_status`,`invoice_id`,billing panel | `ticket_line_items`, `rate_card_items` |

## 10. Rollout phases

1. **DB** — migration 073 (rate card + seed, ticket_line_items, tickets cols, invoice_items CHECK, module keys).
2. **Backend** — rate card CRUD, ticket line-item CRUD + recompute, coverage auto-suggest, generate-invoice bridge, portal read; `PAYMENT_API_URL`.
3. **Admin UI** — rate card page + ticket billing panel.
4. **Portal UI** — ticket billing section.
5. **i18n + module toggle + audit + QA + memory write-back.**

## 11. Open follow-ups / risks

- **Fractional quantities** (1.5 h) — INT for v1; NUMERIC quantity is a follow-up (also needs invoice mapping).
- **Cross-service token forward** — customer-api forwards the staff Bearer to payment-api; if payment-api is down, generate-invoice returns a clear error and leaves the ticket un-invoiced (retryable).
- **Rate-card currency vs ticket currency** — enforce a single currency per ticket; mixing THB/USD lines is rejected.
- **Regenerate/void** — if an invoice is voided, clearing `tickets.invoice_id` to allow re-generation is a follow-up.
