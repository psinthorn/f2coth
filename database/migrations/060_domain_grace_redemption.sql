-- 060_domain_grace_redemption.sql
-- Grace / redemption-period fees for lapsed domains (WHMCS "Domain Expiry
-- Automation" parity). After a domain's expiry, registries allow recovery
-- during a grace period (usually free / small fee) and then a redemption
-- period (expensive). Fees are COMPOUNDED: total = renewal + grace fee +
-- redemption fee, depending on how long after expiry the customer pays.
--
-- Per-TLD because every registry sets its own windows and recovery costs.
-- All amounts are whole THB (INTEGER), matching the existing *_price_thb
-- columns; the renewal engine multiplies by 100 → satang for invoices.
--
-- Defaults are conservative (no fee, standard windows) so existing TLD
-- rows keep billing exactly as before until staff set real values in the
-- admin pricing screen.
--
-- Consumed by services/payment-api/internal/handlers/domain_renewals.go
-- (issueDomainRenewalInvoice adds compounded fee line items).
--
-- Next migration: 061_*.sql

BEGIN;

ALTER TABLE domain_pricing
    ADD COLUMN IF NOT EXISTS grace_period_days      INTEGER NOT NULL DEFAULT 0
        CHECK (grace_period_days >= 0),
    ADD COLUMN IF NOT EXISTS redemption_period_days INTEGER NOT NULL DEFAULT 30
        CHECK (redemption_period_days >= 0),
    ADD COLUMN IF NOT EXISTS grace_fee_thb          INTEGER NOT NULL DEFAULT 0
        CHECK (grace_fee_thb >= 0),
    ADD COLUMN IF NOT EXISTS redemption_fee_thb     INTEGER NOT NULL DEFAULT 0
        CHECK (redemption_fee_thb >= 0);

-- Seed sensible starting values for ResellerClub gTLDs: ~30-day auto-renew
-- grace (no fee), then a ~30-day redemption window at a recovery premium.
-- Staff refine per-TLD via a later migration (pricing is edit-via-migration
-- by design). Only touches rows still on the defaults so re-running is safe.
UPDATE domain_pricing
   SET grace_period_days      = 30,
       redemption_period_days = 30,
       grace_fee_thb          = 0,
       redemption_fee_thb     = 3000
 WHERE registry = 'resellerclub'
   AND grace_period_days = 0
   AND redemption_fee_thb = 0;

COMMIT;
