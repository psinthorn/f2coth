-- 021_payments.sql
-- Comprehensive payment system: invoices, line items, payment attempts,
-- webhook idempotency, and method configuration covering Bank Transfer,
-- Thai QR, PromptPay, and PayPal.
--
-- Money is stored in MINOR units (satang for THB, cents for USD) as BIGINT
-- to avoid floating-point drift. The application layer formats for display.
--
-- Invoices are the single billable object — every domain order, hosting
-- plan signup, SLA renewal, and custom service produces ONE invoice row
-- with N invoice_items. Payments are attempts against an invoice; one
-- invoice can have multiple payment attempts (failed PayPal, then bank
-- transfer that succeeds). The invoice is `paid` only when at least one
-- payment row reaches status `completed` and amounts reconcile.
--
-- Next migration: 022_*.sql

BEGIN;

-- ─────────────────────────────────────────────
-- 1. invoices — billing header (one per order / billable event)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number    TEXT         NOT NULL UNIQUE,            -- e.g. INV-2026-000001
    customer_id       UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    contact_id        UUID         REFERENCES customer_contacts(id) ON DELETE SET NULL,
    status            TEXT         NOT NULL DEFAULT 'draft'
                                   CHECK (status IN ('draft', 'issued', 'partially_paid', 'paid', 'void', 'refunded', 'overdue')),
    currency          TEXT         NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB', 'USD')),
    subtotal_cents    BIGINT       NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
    vat_rate_bp       INT          NOT NULL DEFAULT 700 CHECK (vat_rate_bp >= 0),   -- basis points; 700 = 7.00%
    vat_cents         BIGINT       NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
    total_cents       BIGINT       NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    amount_paid_cents BIGINT       NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
    issue_date        DATE,
    due_date          DATE,
    paid_at           TIMESTAMPTZ,
    voided_at         TIMESTAMPTZ,
    void_reason       TEXT,
    notes             TEXT,
    metadata          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer  ON invoices (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status    ON invoices (status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_number    ON invoices (invoice_number);

CREATE OR REPLACE TRIGGER set_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 2. invoice_items — line items
-- ─────────────────────────────────────────────
--   product_type lets the UI render a back-link to the underlying resource
--   (domain order, hosting plan, SLA contract). product_ref is loosely
--   typed so we can attach UUIDs from heterogeneous tables.
CREATE TABLE IF NOT EXISTS invoice_items (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_type    TEXT        NOT NULL CHECK (product_type IN ('domain', 'hosting', 'sla', 'msp', 'custom')),
    product_ref     UUID,
    description_en  TEXT        NOT NULL,
    description_th  TEXT,
    quantity        INT         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents BIGINT     NOT NULL CHECK (unit_price_cents >= 0),
    total_cents     BIGINT      NOT NULL CHECK (total_cents >= 0),
    period_start    DATE,
    period_end      DATE,
    sort_order      INT         NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items (product_type, product_ref);

-- ─────────────────────────────────────────────
-- 3. payments — attempts against an invoice
-- ─────────────────────────────────────────────
--   One invoice → many payment rows. Bank transfer goes through
--   awaiting_verification → completed (staff verifies the slip).
--   PayPal goes through pending → completed via webhook capture.
CREATE TABLE IF NOT EXISTS payments (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number      TEXT         NOT NULL UNIQUE,            -- PAY-2026-000001
    invoice_id          UUID         NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id         UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    method              TEXT         NOT NULL CHECK (method IN ('bank_transfer', 'thai_qr', 'promptpay', 'paypal')),
    status              TEXT         NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'awaiting_verification', 'completed', 'failed', 'expired', 'refunded')),
    amount_cents        BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency            TEXT         NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB', 'USD')),
    -- Provider correlation (PayPal order/capture id, slip ref, etc.)
    provider            TEXT,
    provider_order_id   TEXT,
    provider_capture_id TEXT,
    -- Bank transfer specifics
    slip_url            TEXT,
    slip_uploaded_at    TIMESTAMPTZ,
    bank_ref            TEXT,
    transferred_at      TIMESTAMPTZ,
    -- Verification (staff workflow for bank_transfer / thai_qr / promptpay)
    verified_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
    verified_at         TIMESTAMPTZ,
    rejected_reason     TEXT,
    -- Lifecycle
    paid_at             TIMESTAMPTZ,
    expires_at          TIMESTAMPTZ,
    failure_reason      TEXT,
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice  ON payments (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_status   ON payments (status, method, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments (provider, provider_order_id)
    WHERE provider_order_id IS NOT NULL;

CREATE OR REPLACE TRIGGER set_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 4. payment_webhook_events — provider event idempotency log
-- ─────────────────────────────────────────────
--   PayPal sends the same event twice during retries. We dedupe on
--   (provider, event_id) and only process unseen rows.
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider     TEXT        NOT NULL CHECK (provider IN ('paypal')),
    event_id     TEXT        NOT NULL,
    event_type   TEXT        NOT NULL,
    resource_id  TEXT,
    payload      JSONB       NOT NULL,
    signature_ok BOOLEAN     NOT NULL DEFAULT false,
    processed_at TIMESTAMPTZ,
    payment_id   UUID        REFERENCES payments(id) ON DELETE SET NULL,
    error        TEXT,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_unprocessed
    ON payment_webhook_events (provider, received_at)
    WHERE processed_at IS NULL;

-- ─────────────────────────────────────────────
-- 5. payment_methods_config — admin-managed config per method
-- ─────────────────────────────────────────────
--   Holds the customer-facing display data (bank name, account number,
--   QR image, PromptPay ID, PayPal merchant email) plus an enabled flag
--   so admins can turn each method on/off independently of the modules
--   registry. The `config` JSONB is method-specific:
--
--   bank_transfer: { bank_name, account_name, account_number, branch, swift }
--   thai_qr:       { qr_image_url, merchant_name }
--   promptpay:     { promptpay_id, merchant_name, qr_image_url }
--   paypal:        { merchant_email, client_id_public, webhook_id }
CREATE TABLE IF NOT EXISTS payment_methods_config (
    method          TEXT        PRIMARY KEY CHECK (method IN ('bank_transfer', 'thai_qr', 'promptpay', 'paypal')),
    enabled         BOOLEAN     NOT NULL DEFAULT false,
    display_name_en TEXT        NOT NULL,
    display_name_th TEXT        NOT NULL,
    instructions_en TEXT,
    instructions_th TEXT,
    config          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sort_order      INT         NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE OR REPLACE TRIGGER set_payment_methods_config_updated_at
    BEFORE UPDATE ON payment_methods_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 6. Sequences for human-readable invoice & payment numbering
-- ─────────────────────────────────────────────
--   Application formats: INV-YYYY-{seq:06}, PAY-YYYY-{seq:06}
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS payment_number_seq START 1;

-- ─────────────────────────────────────────────
-- 7. Link existing domain_orders → invoices
-- ─────────────────────────────────────────────
--   domain_orders gains an invoice_id FK so the order queue can show
--   the billing status alongside registry status.
ALTER TABLE domain_orders
    ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_domain_orders_invoice ON domain_orders (invoice_id);

-- ─────────────────────────────────────────────
-- 8. Seed payment_methods_config rows (disabled by default)
-- ─────────────────────────────────────────────
INSERT INTO payment_methods_config (method, enabled, display_name_en, display_name_th, instructions_en, instructions_th, config, sort_order) VALUES
('bank_transfer', false, 'Bank Transfer', 'โอนเงินผ่านธนาคาร',
    'Transfer to our account below and upload your transfer slip. We will verify within 1 business day.',
    'โอนเงินไปยังบัญชีด้านล่างและอัปโหลดสลิป เราจะตรวจสอบภายใน 1 วันทำการ',
    jsonb_build_object(
        'bank_name', 'Kasikorn Bank',
        'account_name', 'F2 Co., Ltd.',
        'account_number', '000-0-00000-0',
        'branch', 'Koh Samui',
        'swift', 'KASITHBK'
    ), 10),
('thai_qr', false, 'Thai QR Code', 'พร้อมเพย์/QR สแกนจ่าย',
    'Scan the QR code with any Thai banking app to pay. Upload the confirmation screenshot.',
    'สแกน QR ด้วยแอปธนาคารใดก็ได้ในไทย แล้วอัปโหลดภาพยืนยันการชำระเงิน',
    jsonb_build_object('qr_image_url', '', 'merchant_name', 'F2 Co., Ltd.'), 20),
('promptpay', false, 'PromptPay', 'พร้อมเพย์',
    'Pay via PromptPay using our tax ID. Upload the confirmation screenshot.',
    'ชำระผ่านพร้อมเพย์ด้วยเลขประจำตัวผู้เสียภาษีของเรา แล้วอัปโหลดภาพยืนยัน',
    jsonb_build_object('promptpay_id', '', 'merchant_name', 'F2 Co., Ltd.', 'qr_image_url', ''), 30),
('paypal', false, 'PayPal', 'PayPal',
    'Pay online via PayPal — accepts credit/debit card and PayPal balance. Instant confirmation.',
    'ชำระออนไลน์ผ่าน PayPal — รับบัตรเครดิต/เดบิตและยอด PayPal ยืนยันทันที',
    jsonb_build_object('merchant_email', '', 'client_id_public', '', 'webhook_id', '', 'environment', 'sandbox'), 40)
ON CONFLICT (method) DO NOTHING;

-- ─────────────────────────────────────────────
-- 9. Register modules in the toggle registry
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
-- Portal billing
('portal.billing',           'portal', 'Billing & invoices',  'การเรียกเก็บเงินและใบแจ้งหนี้', 'Customer invoice list, detail, and pay flow', true, false, 60),
-- Admin payment management
('admin.invoices',           'admin',  'Invoices',            'ใบแจ้งหนี้',                   'Invoice list, create, edit, issue, void',     true, false, 65),
('admin.payments',           'admin',  'Payments',            'การชำระเงิน',                  'Payment list and bank-transfer verification queue', true, false, 66),
('admin.payment_methods',    'admin',  'Payment method config','ตั้งค่าวิธีการชำระเงิน',       'Configure bank/QR/PromptPay/PayPal',           true, false, 67),
-- API
('api.payment',              'api',    'Payment API',         'API การชำระเงิน',              'Invoice + payment endpoints, PayPal webhook', true, false, 100)
ON CONFLICT (key) DO NOTHING;

COMMIT;
