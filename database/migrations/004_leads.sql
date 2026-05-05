-- =============================================================
-- 004_leads.sql
-- Inbound lead capture from contact forms, services pages, and
-- the chatbot hand-off.
-- =============================================================

CREATE TABLE IF NOT EXISTS leads (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       TEXT         NOT NULL,
    email           CITEXT       NOT NULL,
    phone           TEXT,
    company         TEXT,
    property_name   TEXT,                       -- e.g., "SALA Phuket"
    property_type   TEXT         CHECK (property_type IN
                        ('hotel','resort','villa','restaurant','other') OR property_type IS NULL),
    interest        TEXT[]       NOT NULL DEFAULT '{}',  -- service slugs the lead is interested in
    message         TEXT         NOT NULL,
    source          TEXT         NOT NULL DEFAULT 'contact_form'
                                 CHECK (source IN
                                    ('contact_form','services_page','case_study',
                                     'iacc_demo','chatbot','referral','other')),
    status          TEXT         NOT NULL DEFAULT 'new'
                                 CHECK (status IN
                                    ('new','contacted','qualified','won','lost','spam')),
    assigned_to     UUID         REFERENCES users(id) ON DELETE SET NULL,
    ip_address      INET,
    user_agent      TEXT,
    utm_source      TEXT,
    utm_medium      TEXT,
    utm_campaign    TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_source        ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_email         ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_assigned      ON leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_at    ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_interest      ON leads USING GIN (interest);

CREATE TRIGGER trg_leads_updated_at
BEFORE UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-lead activity timeline (sales-team comments, status flips, emails sent).
CREATE TABLE IF NOT EXISTS lead_activities (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         UUID         NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    actor_id        UUID         REFERENCES users(id) ON DELETE SET NULL,
    activity_type   TEXT         NOT NULL
                                 CHECK (activity_type IN
                                    ('note','status_change','email_sent','call','meeting')),
    payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead   ON lead_activities(lead_id, created_at DESC);
