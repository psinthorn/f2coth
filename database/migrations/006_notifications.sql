-- =============================================================
-- 006_notifications.sql
-- Outbound email notifications (sales alerts, lead handoff,
-- marketing transactional). The notification-api drains the
-- queue and updates status.
-- =============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel         TEXT         NOT NULL DEFAULT 'email'
                                 CHECK (channel IN ('email','sms','webhook')),
    template        TEXT         NOT NULL,
    to_address      TEXT         NOT NULL,
    cc_address      TEXT,
    bcc_address     TEXT,
    subject         TEXT,
    payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    status          TEXT         NOT NULL DEFAULT 'queued'
                                 CHECK (status IN
                                    ('queued','sending','sent','failed','dead')),
    attempts        INTEGER      NOT NULL DEFAULT 0,
    last_error      TEXT,
    related_lead_id UUID         REFERENCES leads(id) ON DELETE SET NULL,
    scheduled_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_status_sched
    ON notifications(status, scheduled_at) WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS idx_notifications_lead     ON notifications(related_lead_id);
CREATE INDEX IF NOT EXISTS idx_notifications_template ON notifications(template);
CREATE INDEX IF NOT EXISTS idx_notifications_created  ON notifications(created_at DESC);

CREATE TRIGGER trg_notifications_updated_at
BEFORE UPDATE ON notifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Optional: store rendered email templates server-side so the marketing
-- team can edit them without a redeploy.
CREATE TABLE IF NOT EXISTS notification_templates (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT         NOT NULL UNIQUE,        -- e.g. "lead_received"
    subject_tmpl    TEXT         NOT NULL,
    body_tmpl       TEXT         NOT NULL,
    description     TEXT,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_notification_templates_updated_at
BEFORE UPDATE ON notification_templates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
