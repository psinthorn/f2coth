-- 030_disputes.sql
-- PayPal chargeback / dispute tracking. PayPal emits CUSTOMER.DISPUTE.*
-- events on its webhook stream; until now we logged the event row but
-- did nothing with the resource. This migration introduces a
-- first-class disputes table so the admin can see who's contesting
-- which payment, the dispute amount, the deadline, and the resolution.
--
-- payments.status grows a new state 'disputed' so the UI can flag an
-- otherwise-completed payment that's now under dispute. The transition
-- is reversible: when PayPal resolves the dispute in the merchant's
-- favour we flip back to 'completed'.
--
-- Next migration: 031_*.sql

BEGIN;

ALTER TABLE payments
    DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments
    ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'awaiting_verification', 'completed', 'failed', 'expired', 'refunded', 'disputed'));

CREATE TABLE IF NOT EXISTS payment_disputes (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          UUID         NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    invoice_id          UUID         NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    provider            TEXT         NOT NULL DEFAULT 'paypal' CHECK (provider IN ('paypal')),
    provider_dispute_id TEXT         NOT NULL,
    reason              TEXT,        -- buyer-supplied reason code (MERCHANDISE_OR_SERVICE_NOT_RECEIVED etc.)
    status              TEXT         NOT NULL DEFAULT 'open'
                                     CHECK (status IN ('open', 'waiting_buyer', 'waiting_seller', 'under_review', 'resolved', 'closed')),
    outcome             TEXT,        -- buyer_favored | seller_favored | partial_refund | etc.
    amount_cents        BIGINT       NOT NULL CHECK (amount_cents > 0),
    currency            TEXT         NOT NULL CHECK (currency IN ('THB', 'USD')),
    seller_response_due TIMESTAMPTZ,
    opened_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ,
    raw_event           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (provider, provider_dispute_id)
);

CREATE INDEX IF NOT EXISTS idx_disputes_payment ON payment_disputes (payment_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status  ON payment_disputes (status, opened_at DESC);

CREATE OR REPLACE TRIGGER set_payment_disputes_updated_at
    BEFORE UPDATE ON payment_disputes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Register admin module
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.disputes', 'admin', 'Disputes', 'การโต้แย้ง', 'PayPal chargebacks + disputes', true, false, 71)
ON CONFLICT (key) DO NOTHING;

COMMIT;
