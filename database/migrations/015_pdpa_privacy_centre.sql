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

CREATE TRIGGER set_cookie_consents_updated_at
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
    due_date            TIMESTAMPTZ NOT NULL
                            GENERATED ALWAYS AS (created_at + INTERVAL '30 days') STORED,
    response_notes      TEXT,                     -- internal staff notes
    fulfilled_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_email   ON data_subject_requests (requester_email);
CREATE INDEX IF NOT EXISTS idx_dsr_status  ON data_subject_requests (status);
CREATE INDEX IF NOT EXISTS idx_dsr_due     ON data_subject_requests (due_date) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_dsr_due_all ON data_subject_requests (due_date, created_at);

CREATE TRIGGER set_dsr_updated_at
    BEFORE UPDATE ON data_subject_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 3. Chat session retention: add expires_at
--    PDPA requires a defined retention period.
--    Recommend: 90 days from last activity, then anonymise.
-- ─────────────────────────────────────────────
ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
        GENERATED ALWAYS AS (updated_at + INTERVAL '90 days') STORED;

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires
    ON chat_sessions (expires_at)
    WHERE anonymised_at IS NULL;

-- ─────────────────────────────────────────────
-- 4. Leads retention: add retention_expires_at
--    Leads (contact form submissions) contain PII — name, email, phone, message.
--    Recommend: retain for 2 years (reasonable B2B sales cycle), then anonymise.
-- ─────────────────────────────────────────────
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS retention_expires_at TIMESTAMPTZ
        GENERATED ALWAYS AS (created_at + INTERVAL '2 years') STORED;

ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS anonymised_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_retention_expires
    ON leads (retention_expires_at)
    WHERE anonymised_at IS NULL;

-- ─────────────────────────────────────────────
-- 5. Notification templates — DSR acknowledgement + confirmation emails
-- ─────────────────────────────────────────────
INSERT INTO notification_templates (id, name, subject_tmpl, body_tmpl)
VALUES
(
    gen_random_uuid(),
    'dsr_received_requester',
    '{"en": "Your data request has been received — F2 Co., Ltd.", "th": "เราได้รับคำขอข้อมูลของท่านแล้ว — บริษัท เอฟทู จำกัด"}',
    '{"en": "Dear {{.Name}},\n\nWe have received your {{.RequestType}} request (Ref: {{.ID}}).\n\nUnder Thailand''s Personal Data Protection Act (PDPA), we will respond within 30 days (by {{.DueDate}}).\n\nIf you have questions, contact us at privacy@f2.co.th.\n\nF2 Co., Ltd.", "th": "เรียน คุณ{{.Name}}\n\nเราได้รับคำขอ{{.RequestTypeTH}}ของท่านแล้ว (อ้างอิง: {{.ID}})\n\nภายใต้พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA) เราจะตอบสนองภายใน 30 วัน (ภายในวันที่ {{.DueDate}})\n\nหากมีคำถาม ติดต่อเราได้ที่ privacy@f2.co.th\n\nบริษัท เอฟทู จำกัด"}'
),
(
    gen_random_uuid(),
    'dsr_fulfilled_requester',
    '{"en": "Your data request is complete — F2 Co., Ltd.", "th": "คำขอข้อมูลของท่านเสร็จสมบูรณ์แล้ว — บริษัท เอฟทู จำกัด"}',
    '{"en": "Dear {{.Name}},\n\nYour {{.RequestType}} request (Ref: {{.ID}}) has been completed.\n\n{{.ResponseNotes}}\n\nF2 Co., Ltd.", "th": "เรียน คุณ{{.Name}}\n\nคำขอ{{.RequestTypeTH}}ของท่าน (อ้างอิง: {{.ID}}) เสร็จสมบูรณ์แล้ว\n\n{{.ResponseNotes}}\n\nบริษัท เอฟทู จำกัด"}'
),
(
    gen_random_uuid(),
    'dsr_received_staff',
    '{"en": "New DSR received: {{.RequestType}} from {{.Email}}", "th": "ได้รับ DSR ใหม่: {{.RequestType}} จาก {{.Email}}"}',
    '{"en": "A new Data Subject Request has been submitted.\n\nRef: {{.ID}}\nType: {{.RequestType}}\nFrom: {{.Name}} <{{.Email}}>\nDue: {{.DueDate}}\n\nReview at: {{.AdminURL}}", "th": "มีคำขอสิทธิ์ข้อมูลส่วนบุคคลใหม่\n\nอ้างอิง: {{.ID}}\nประเภท: {{.RequestTypeTH}}\nจาก: {{.Name}} <{{.Email}}>\nกำหนด: {{.DueDate}}\n\nดูได้ที่: {{.AdminURL}}"}'
)
ON CONFLICT DO NOTHING;
