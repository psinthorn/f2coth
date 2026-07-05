-- 028_subscriptions_and_refunds.sql
-- Two operational features bundled because they share the scheduler
-- goroutine added in this change:
--
--   1. subscriptions — recurring billing for hosting plans and SLA
--      contracts. Existing one-shot invoices stay as-is; subscriptions
--      automate the renewal cadence so admins don't manually issue an
--      invoice every month/year for the same product.
--
--   2. refunds — payments.status already supports 'refunded' but no
--      record of WHO refunded WHAT and HOW MUCH. This adds a refunds
--      audit table so PayPal API refunds and manual bank refunds share
--      one shape.
--
-- A goroutine in payment-api runs every 5 minutes and:
--   • marks invoices overdue when due_date < CURRENT_DATE
--   • generates invoices for subscriptions whose next_billing_at is
--     within the lead window (7 days by default)
--   • sends reminder emails (using templates seeded by migration 025)
--
-- Next migration: 029_*.sql

BEGIN;

-- ---------- subscriptions ----------
CREATE TABLE IF NOT EXISTS subscriptions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    title           TEXT         NOT NULL,
    product_type    TEXT         NOT NULL CHECK (product_type IN ('hosting', 'sla', 'msp', 'custom')),
    product_ref     UUID,                                  -- hosting_plans.id, customer_sla_contracts.id, etc.
    billing_cycle   TEXT         NOT NULL CHECK (billing_cycle IN ('monthly', 'quarterly', 'annually')),
    amount_cents    BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency        TEXT         NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB', 'USD')),
    -- Lifecycle
    status          TEXT         NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active', 'paused', 'cancelled')),
    starts_on       DATE         NOT NULL,
    ends_on         DATE,                                  -- nullable = ongoing
    last_billed_on  DATE,
    next_billing_at DATE         NOT NULL,                 -- scheduler picks rows where next_billing_at <= today + 7
    -- Audit
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_due
    ON subscriptions (next_billing_at)
    WHERE status = 'active';

CREATE OR REPLACE TRIGGER set_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Link the generated invoices back to the subscription that produced
-- them so admins can audit "what created this invoice?".
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices (subscription_id);

-- ---------- refunds ----------
CREATE TABLE IF NOT EXISTS refunds (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    refund_number   TEXT         NOT NULL UNIQUE,           -- e.g. REF-2026-000001
    payment_id      UUID         NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    invoice_id      UUID         NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    method          TEXT         NOT NULL,                  -- mirrors the original payment.method
    amount_cents    BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency        TEXT         NOT NULL CHECK (currency IN ('THB', 'USD')),
    reason          TEXT         NOT NULL,
    -- Provider correlation when refund went through PayPal Refunds API
    provider_refund_id TEXT,
    -- Manual refunds (bank, QR, PromptPay) — staff records the proof here
    bank_ref        TEXT,
    proof_url       TEXT,
    status          TEXT         NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'completed', 'failed')),
    issued_by_user_id UUID       REFERENCES users(id) ON DELETE SET NULL,
    completed_at    TIMESTAMPTZ,
    failure_reason  TEXT,
    metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_payment  ON refunds (payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_invoice  ON refunds (invoice_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status   ON refunds (status, created_at);

CREATE OR REPLACE TRIGGER set_refunds_updated_at
    BEFORE UPDATE ON refunds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sequence for human-readable refund numbering.
CREATE SEQUENCE IF NOT EXISTS refund_number_seq START 1;

-- ---------- Register modules ----------
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.subscriptions',  'admin',  'Subscriptions', 'การสมัครรับบริการ', 'Recurring billing (hosting, SLA, MSP)', true,  false, 68),
('admin.refunds',        'admin',  'Refunds',       'การคืนเงิน',         'Refund queue + history',               true,  false, 69),
('api.payment_scheduler','api',    'Payment scheduler', 'ตัวจัดตารางการชำระ', 'Background goroutine: overdue + subscription billing + reminders', true, false, 110)
ON CONFLICT (key) DO NOTHING;

COMMIT;
