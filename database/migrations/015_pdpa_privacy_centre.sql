-- 015_pdpa_privacy_centre.sql
-- PDPA Privacy Centre
-- Adds: cookie_consents, data_subject_requests, chat session retention TTL,
--       notification templates for DSR (Data Subject Request) emails.
-- Next migration: 016_*.sql

-- ─────────────────────────────────────────────
-- 1. Cookie consent log
--    Records the visitor's cookie consent choice (essential-only or full).
--    Indexed by visitor fingerprint for fast lookup on page load.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cookie_consents (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id    TEXT        NOT NULL,           -- client-generated UUID stored in localStorage
    locale        TEXT        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'th')),
    analytics     BOOLEAN     NOT NULL DEFAULT false,
    marketing     BOOLEAN     NOT NULL DEFAULT false,
    ip_address    INET,
    user_agent    TEXT,
    consented_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    withdrawn_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cookie_consents_visitor
    ON cookie_consents (visitor_id);
CREATE INDEX IF NOT EXISTS idx_cookie_consents_consented_at
    ON cookie_consents (consented_at);

CREATE OR REPLACE TRIGGER set_cookie_consents_updated_at
    BEFORE UPDATE ON cookie_consents
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 2. Data Subject Requests (DSR)
--    PDPA data subject rights: access, rectification, erasure, portability, objection.
--    Linked optionally to a customer_contact or a lead (anonymous visitors).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_subject_requests (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- requester identity (at least one must be set)
    requester_email     CITEXT      NOT NULL,
    requester_name      TEXT        NOT NULL,
    customer_contact_id UUID        REFERENCES customer_contacts(id) ON DELETE SET NULL,
    lead_id             UUID        REFERENCES leads(id) ON DELETE SET NULL,
    -- request details
    request_type        TEXT        NOT NULL
                            CHECK (request_type IN (
                                'access',         -- right to know what data we hold
                                'rectification',  -- right to correct inaccurate data
                                'erasure',        -- right to be forgotten
                                'portability',    -- right to receive data in machine-readable format
                                'objection',      -- right to object to processing
                                'restrict'        -- right to restrict processing
                            )),
    description         TEXT,                     -- optional detail from requester
    locale              TEXT        NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'th')),
    -- status lifecycle
    status              TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN (
                                'pending',        -- received, not yet assigned
                                'in_progress',    -- assigned to staff
                                'completed',      -- fulfilled within 30-day PDPA deadline
                                'rejected',       -- with documented reason
                                'withdrawn'       -- requester withdrew
                            )),
    assigned_to         UUID        REFERENCES users(id) ON DELETE SET NULL,
    -- PDPA s.30 sets a 30-day response deadline. Not a GENERATED column because
    -- (a) timestamptz + interval is not immutable (rejected by Postgres) and
    -- (b) staff must be able to extend the deadline by one further 30-day period
    -- when the request is complex (PDPA permits a single extension).
    due_date            TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    response_notes      TEXT,                     -- internal staff notes
    fulfilled_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_email   ON data_subject_requests (requester_email);
CREATE INDEX IF NOT EXISTS idx_dsr_status  ON data_subject_requests (status);
CREATE INDEX IF NOT EXISTS idx_dsr_due     ON data_subject_requests (due_date) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_dsr_due_all ON data_subject_requests (due_date, created_at);

CREATE OR REPLACE TRIGGER set_dsr_updated_at
    BEFORE UPDATE ON data_subject_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 3. Chat session retention: add expires_at
--    PDPA requires a defined retention period.
--    Policy: 90 days from last activity (last_activity_at), then anonymise.
--
--    Not a GENERATED column: timestamptz + interval is non-immutable so
--    Postgres rejects it. A BEFORE INSERT/UPDATE trigger rolls expires_at
--    forward whenever the session is touched, preserving the original intent.
-- ─────────────────────────────────────────────
ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ;

-- Backfill existing rows.
UPDATE chat_sessions
   SET expires_at = last_activity_at + INTERVAL '90 days'
 WHERE expires_at IS NULL;

CREATE OR REPLACE FUNCTION chat_sessions_set_expires_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.expires_at := COALESCE(NEW.last_activity_at, NOW()) + INTERVAL '90 days';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER set_chat_sessions_expires_at
    BEFORE INSERT OR UPDATE ON chat_sessions
    FOR EACH ROW EXECUTE FUNCTION chat_sessions_set_expires_at();

CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires
    ON chat_sessions (expires_at)
    WHERE anonymised_at IS NULL;

-- ─────────────────────────────────────────────
-- 4. Leads retention: add retention_expires_at
--    Leads (contact form submissions) contain PII — name, email, phone, message.
--    Policy: retain for 2 years (reasonable B2B sales cycle), then anonymise.
--
--    Not a GENERATED column: timestamptz + interval is non-immutable.
--    A simple DEFAULT is sufficient since leads.created_at is fixed at insert
--    and not expected to change after that.
-- ─────────────────────────────────────────────
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ
        DEFAULT (NOW() + INTERVAL '2 years');

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ;

-- Backfill existing rows.
UPDATE leads
   SET retention_expires_at = created_at + INTERVAL '2 years'
 WHERE retention_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leads_retention_expires
    ON leads (retention_expires_at)
    WHERE anonymised_at IS NULL;

-- ─────────────────────────────────────────────
-- 5. Notification templates — DSR acknowledgement + confirmation emails
--    Originally inserted here, but the INSERT referenced a column ('name')
--    that does not exist (the column is 'code'), and wrote plain-text JSON
--    into columns that became JSONB in migration 012. Both bugs made the
--    statement fail on a fresh `make migrate`.
--
--    The templates are now seeded by migration 016_dsr_notifications.sql,
--    which uses the correct schema and is idempotent via
--    ON CONFLICT (code) DO UPDATE. Do not re-add the INSERT here.
-- ─────────────────────────────────────────────
