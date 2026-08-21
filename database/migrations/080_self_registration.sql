-- 080_self_registration.sql
-- ─────────────────────────────────────────────
-- Public self-registration: a company can sign itself up (org + owner) and
-- becomes usable only after the owner verifies their email (verify-to-activate).
--
-- customers.status drives the lifecycle. Existing customers default to 'active'
-- so nothing changes for them; a self-registered org starts 'pending' and flips
-- to 'active' when the owner clicks the verification link. Login is gated to
-- non-pending orgs (see customer_auth.loadMemberships).
--
-- Next migration: 081_*.sql
-- ─────────────────────────────────────────────

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending','active','suspended','closed')),
    ADD COLUMN IF NOT EXISTS self_registered BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
