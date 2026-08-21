-- 079_mfa.sql
-- ─────────────────────────────────────────────
-- Multi-factor authentication (TOTP, RFC 6238) for staff and portal users.
--
-- Each account may enrol an authenticator app: a base32 seed is generated,
-- stored AES-256-GCM-encrypted (never plaintext), and confirmed with a live
-- code before mfa_enabled flips true. One-time recovery codes (hashed) cover a
-- lost device. Login gains a second step: password OK → short-lived mfa_pending
-- token → TOTP/recovery code → full session.
--
-- Enforcement is a policy: optional by default, but MFA can be REQUIRED for
-- named customer roles and/or all staff. Also seeds staff email verification
-- groundwork (users had no verified column).
--
-- Next migration: 080_*.sql
-- ─────────────────────────────────────────────

-- ── Staff (users) ──
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS mfa_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mfa_secret      TEXT,          -- AES-GCM(base32 seed), base64
    ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ; -- Pillar 2 groundwork

-- ── Portal users (customer_contacts) ──
ALTER TABLE customer_contacts
    ADD COLUMN IF NOT EXISTS mfa_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS mfa_secret      TEXT,
    ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

-- ── One-time recovery codes (hashed) ──
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        REFERENCES users(id)             ON DELETE CASCADE,
    contact_id UUID        REFERENCES customer_contacts(id) ON DELETE CASCADE,
    code_hash  TEXT        NOT NULL,           -- sha256 hex of the raw code
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Exactly one owner (staff XOR customer).
    CONSTRAINT mfa_recovery_owner_chk CHECK ((user_id IS NOT NULL) <> (contact_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_user    ON mfa_recovery_codes(user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mfa_recovery_contact ON mfa_recovery_codes(contact_id) WHERE contact_id IS NOT NULL;

-- ── Enforcement policy (singleton portal_settings row from migration 071) ──
ALTER TABLE portal_settings
    ADD COLUMN IF NOT EXISTS require_mfa_customer_roles TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS require_mfa_staff          BOOLEAN NOT NULL DEFAULT FALSE;
