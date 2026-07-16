-- 063_auto_charge.sql
-- Optional card-on-file / auto-charge for subscriptions. This COEXISTS with
-- the default notify+invoice model — a subscription only auto-charges when
-- auto_charge=true AND it has a linked, active vaulted payment method.
-- Everything else keeps generating an invoice for the customer to pay.
--
-- payment_methods_vault stores a provider-side agreement id (e.g. a PayPal
-- Billing Agreement / subscription id) — never raw card data. Capturing an
-- actual charge requires the provider's recurring-payment API + live
-- credentials; see services/payment-api/internal/handlers/auto_charge.go
-- for the wired boundary (it degrades to notify+invoice until configured).
--
-- Next migration: 064_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS payment_methods_vault (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    provider     TEXT        NOT NULL CHECK (provider IN ('paypal')),
    agreement_id TEXT        NOT NULL,          -- provider billing-agreement / subscription id
    brand        TEXT,                          -- display only, e.g. "PayPal", "Visa"
    last4        TEXT,                          -- display only
    status       TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'revoked', 'failed')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, agreement_id)
);
CREATE INDEX IF NOT EXISTS idx_vault_customer ON payment_methods_vault (customer_id, status);

CREATE OR REPLACE TRIGGER trg_vault_updated_at
    BEFORE UPDATE ON payment_methods_vault FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS auto_charge       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES payment_methods_vault(id) ON DELETE SET NULL;

INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('api.auto_charge', 'api', 'Subscription auto-charge', 'ตัดชำระอัตโนมัติ',
 'Optional card-on-file recurring charging (PayPal billing agreements); off by default', false, false, 113)
ON CONFLICT (key) DO NOTHING;

COMMIT;
