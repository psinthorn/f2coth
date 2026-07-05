-- 023_per_method_mode.sql
-- Per-method sandbox/production toggle. Each payment_methods_config row
-- now carries its own `mode` column so admins can run, e.g., PayPal in
-- sandbox while bank_transfer is in production.
--
-- Migration steps:
--   1. Add `mode` column (default 'sandbox' — safer fallback).
--   2. Backfill from the soon-to-be-dropped global payment_settings row
--      so existing deployments keep their current effective state.
--   3. Drop the global payment_settings table — no longer truth source.
--
-- Sandbox helpers in payment-api now read mode from each payment's
-- method row instead of the global setting.
--
-- Next migration: 024_*.sql

BEGIN;

-- 1. Per-method mode
ALTER TABLE payment_methods_config
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'sandbox'
        CHECK (mode IN ('sandbox', 'production'));

-- 2. Inherit the previous global mode for every method (idempotent —
--    re-running picks up the same value).
UPDATE payment_methods_config
   SET mode = COALESCE(
       (SELECT mode FROM payment_settings WHERE id = 1),
       'sandbox'
   )
 WHERE mode = 'sandbox';  -- only touch defaults; preserve manual edits

-- 3. Drop the global singleton. audit_log rows referencing
--    resource_type='payment_settings' are left intact for history.
DROP TABLE IF EXISTS payment_settings;

COMMIT;
