-- 022_payment_settings.sql
-- Single-row settings table for the payment system. The `mode` column
-- (sandbox | production) replaces the PAYMENT_SANDBOX_MODE env flag as
-- the source of truth — admins can flip it from /admin/payment-methods
-- without restarting payment-api.
--
-- The CHECK (id = 1) makes the table strictly singleton: one row, ever.
-- INSERTs that try to add another row will fail; UPDATEs always hit
-- this row.
--
-- Mode changes are tracked in the generic audit_log (resource_type =
-- 'payment_settings') via writes from the application layer.
--
-- Next migration: 023_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS payment_settings (
    id          INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mode        TEXT        NOT NULL DEFAULT 'sandbox'
                            CHECK (mode IN ('sandbox', 'production')),
    updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER set_payment_settings_updated_at
    BEFORE UPDATE ON payment_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the singleton row. Sandbox by default — production must be a
-- deliberate, audited action.
INSERT INTO payment_settings (id, mode) VALUES (1, 'sandbox')
ON CONFLICT (id) DO NOTHING;

COMMIT;
