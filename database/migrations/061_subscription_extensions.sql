-- 061_subscription_extensions.sql
-- Recurring-billing flexibility: extra billing cycles, free trials, and
-- coupon discounts (WHMCS-style promotions).
--
--  1. billing_cycle gains weekly / semiannually / biennially / triennially
--     alongside the original monthly / quarterly / annually.
--  2. subscriptions.trial_end_on — when set, the first invoice is deferred
--     to that date (the scheduler already bills off next_billing_at, so a
--     trial is just next_billing_at = trial_end_on at creation).
--  3. subscriptions.coupon_code — an optional promo applied to every
--     generated invoice for that subscription.
--  4. coupons + coupon_redemptions — percent or fixed discounts, scoped to
--     all / subscription / domain, with validity window and redemption cap.
--
-- Discounts reduce the invoice subtotal (invoice_items forbids negative
-- lines) and are recorded in coupon_redemptions + the invoice notes for a
-- full audit trail.
--
-- Next migration: 062_*.sql

BEGIN;

-- 1. Extended billing cycles.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_billing_cycle_check
    CHECK (billing_cycle IN (
        'weekly', 'monthly', 'quarterly', 'semiannually',
        'annually', 'biennially', 'triennially'
    ));

-- 2 + 3. Trials and coupon linkage.
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS trial_end_on DATE,
    ADD COLUMN IF NOT EXISTS coupon_code  TEXT;

-- 4. Coupons.
CREATE TABLE IF NOT EXISTS coupons (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code             TEXT        NOT NULL UNIQUE,
    description      TEXT,
    discount_type    TEXT        NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
    discount_value   INTEGER     NOT NULL CHECK (discount_value > 0), -- percent: 1-100; fixed: whole THB
    currency         TEXT        NOT NULL DEFAULT 'THB' CHECK (currency IN ('THB', 'USD')),
    applies_to       TEXT        NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'subscription', 'domain')),
    max_redemptions  INTEGER,                       -- NULL = unlimited
    redemption_count INTEGER     NOT NULL DEFAULT 0,
    valid_from       DATE,
    valid_until      DATE,
    is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_coupons_updated_at
    BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id      UUID        NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    invoice_id     UUID        REFERENCES invoices(id) ON DELETE SET NULL,
    customer_id    UUID        REFERENCES customers(id) ON DELETE SET NULL,
    discount_cents BIGINT      NOT NULL CHECK (discount_cents >= 0),
    redeemed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id);

-- Register modules for /admin/features.
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.coupons', 'admin', 'Coupons', 'คูปองส่วนลด',
 'Promo codes (percent / fixed) applied to recurring invoices', true, false, 70)
ON CONFLICT (key) DO NOTHING;

COMMIT;
