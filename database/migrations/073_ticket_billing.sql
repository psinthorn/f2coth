-- 073_ticket_billing.sql
-- Ticket chargeability + attached priced line items (spec: docs/ticket-billing-plan.md).
--
-- Each ticket line is either COVERED (under an active SLA → ฿0) or BILLABLE
-- (charged at a rate). Lines come from a managed rate card or free-text.
-- A billable ticket generates a DRAFT invoice via payment-api by reusing
-- invoice_items with product_type='ticket'.
--
-- Money is BIGINT minor units (satang), matching the payments system (021).
-- Idempotent. Next migration: 074_*.sql

-- ─────────────────────────────────────────────
-- 1. Rate card — the price book (none existed before). Staff pick an item and
--    its rate snapshots onto a ticket line (still editable).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_card_items (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code                     TEXT        UNIQUE,
    name_en                  TEXT        NOT NULL,
    name_th                  TEXT,
    description_en           TEXT,
    description_th           TEXT,
    unit                     TEXT        NOT NULL DEFAULT 'item',
    default_unit_price_cents BIGINT      NOT NULL CHECK (default_unit_price_cents >= 0),
    currency                 TEXT        NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB','USD')),
    category                 TEXT,
    is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
    sort_order               INT         NOT NULL DEFAULT 0,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_rate_card_items_updated_at
    BEFORE UPDATE ON rate_card_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed a few starter items (prices in satang: ฿1,200 = 120000).
INSERT INTO rate_card_items (code, name_en, name_th, unit, default_unit_price_cents, category, sort_order) VALUES
    ('remote-support',  'Remote support',            'ซัพพอร์ตระยะไกล',          'hour',  120000, 'support', 10),
    ('onsite-callout',  'Onsite callout (Samui)',    'บริการนอกสถานที่ (สมุย)',  'visit', 250000, 'support', 20),
    ('afterhours',      'After-hours support',       'ซัพพอร์ตนอกเวลาทำการ',     'hour',  200000, 'support', 30),
    ('m365-seat',       'Microsoft 365 seat setup',  'ตั้งค่าบัญชี Microsoft 365','seat',   80000, 'licensing', 40)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- 2. Per-ticket line items. Mirrors invoice_items so a billable ticket maps 1:1
--    when generating an invoice. Covered lines keep their rate but contribute 0.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_line_items (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id         UUID        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    rate_card_item_id UUID        REFERENCES rate_card_items(id) ON DELETE SET NULL, -- NULL = free-text
    description_en    TEXT        NOT NULL,
    description_th    TEXT,
    unit              TEXT        NOT NULL DEFAULT 'item',
    quantity          INT         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents  BIGINT      NOT NULL CHECK (unit_price_cents >= 0),
    covered           BOOLEAN     NOT NULL DEFAULT FALSE,
    -- billable contribution: 0 when covered, else quantity*unit_price_cents
    amount_cents      BIGINT      NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    currency          TEXT        NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB','USD')),
    sort_order        INT         NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_line_items_ticket ON ticket_line_items(ticket_id);

-- ─────────────────────────────────────────────
-- 3. tickets: billing summary + link to the generated invoice.
--    billing_status kept in sync by the line-item handlers:
--    none = no lines · covered = ≥1 line all covered · billable = ≥1 billable line.
-- ─────────────────────────────────────────────
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'none'
        CHECK (billing_status IN ('none','covered','billable')),
    ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- 4. Let invoice line items represent a ticket charge.
-- ─────────────────────────────────────────────
ALTER TABLE invoice_items DROP CONSTRAINT IF EXISTS invoice_items_product_type_check;
ALTER TABLE invoice_items ADD  CONSTRAINT invoice_items_product_type_check
    CHECK (product_type IN ('domain','hosting','sla','msp','custom','ticket'));

-- ─────────────────────────────────────────────
-- 5. Module registry
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
    ('admin.rate_card',      'admin',  'Rate card',           'เรตการ์ด',
        'Price book of services/products with default rates', true, false, 150),
    ('admin.ticket_billing', 'admin',  'Ticket billing',      'การเรียกเก็บเงินตั๋ว',
        'Attach priced line items to tickets + generate invoices', true, false, 151),
    ('portal.ticket_billing','portal', 'Ticket charges',      'ค่าใช้จ่ายตั๋ว',
        'Customers see coverage + extra charges on their tickets', true, false, 152)
ON CONFLICT (key) DO NOTHING;
