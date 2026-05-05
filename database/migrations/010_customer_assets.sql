-- =============================================================
-- 010_customer_assets.sql
-- Phase 2B.2 — Customer-visible assets (domains, SLA contracts)
-- and ticket-event notification templates.
-- =============================================================

-- ---------- Customer domains ----------
-- Visible on /portal/domains for customers whose services_used
-- contains 'domain-hosting'. Authoritative entries are written by F2 staff.
CREATE TABLE IF NOT EXISTS customer_domains (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id        UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    domain             TEXT         NOT NULL,
    registrar          TEXT         NOT NULL DEFAULT 'ResellerClub',
    expires_at         TIMESTAMPTZ,
    privacy_enabled    BOOLEAN      NOT NULL DEFAULT FALSE,
    auto_renew         BOOLEAN      NOT NULL DEFAULT TRUE,
    notes              TEXT,
    last_dns_change_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_customer_domains_customer ON customer_domains(customer_id, domain);
CREATE INDEX IF NOT EXISTS idx_customer_domains_expiring ON customer_domains(expires_at)
    WHERE expires_at IS NOT NULL;

CREATE TRIGGER trg_customer_domains_updated_at
BEFORE UPDATE ON customer_domains
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Customer SLA contracts ----------
-- Visible on /portal/sla. Each row is one engagement (e.g. Miskawaan's
-- M365 admin SLA Mar 2026 – Mar 2027). A customer may have several.
CREATE TABLE IF NOT EXISTS customer_sla_contracts (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id        UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    service_slug       TEXT         NOT NULL,
    title              TEXT         NOT NULL,
    starts_on          DATE         NOT NULL,
    ends_on            DATE         NOT NULL,
    target_uptime_pct  NUMERIC(5,2) NOT NULL DEFAULT 99.90,
    status             TEXT         NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('draft','active','renewing','expired')),
    notes              TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_customer_sla_customer ON customer_sla_contracts(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_customer_sla_active   ON customer_sla_contracts(ends_on)
    WHERE status = 'active';

CREATE TRIGGER trg_customer_sla_updated_at
BEFORE UPDATE ON customer_sla_contracts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Notification templates for ticket events ----------
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description)
VALUES
('ticket_received_staff',
 '[F2 Tickets] {{priority}} · {{customer_name}}: {{subject}}',
 E'A new support ticket has been raised.\n\nCustomer: {{customer_name}}\nOpened by: {{opened_by}}\nPriority: {{priority}}\nRelated service: {{service}}\n\nSubject:\n{{subject}}\n\nMessage:\n{{body}}\n\nView in admin: {{ticket_url}}\n\n— f2.co.th',
 'Internal alert to F2 staff when a new ticket is opened.'),

('ticket_reply_customer',
 'F2 replied to your ticket: {{subject}}',
 E'Hi {{contact_name}},\n\nWe''ve replied to your support ticket "{{subject}}" on the F2 client portal.\n\n{{author_name}} wrote:\n\n{{body}}\n\nView the full thread: {{ticket_url}}\n\nIf this resolves the issue you can mark the ticket as resolved from the portal.\n\n— The F2 Team',
 'Sent to the customer contact when F2 staff replies on a ticket.'),

('ticket_opened_on_behalf_customer',
 'F2 has opened a ticket on your behalf: {{subject}}',
 E'Hi {{contact_name}},\n\n{{author_name}} at F2 has opened a support ticket on your account: "{{subject}}"\n\nDetails:\n{{body}}\n\nView and reply: {{ticket_url}}\n\n— The F2 Team',
 'Sent when staff opens a ticket on behalf of a specific customer contact.')
ON CONFLICT (code) DO NOTHING;

-- ---------- Seed: Miskawaan SLA contract ----------
INSERT INTO customer_sla_contracts
    (customer_id, service_slug, title, starts_on, ends_on, target_uptime_pct, status, notes)
SELECT id, 'it-support-msp', 'Microsoft 365 Administration SLA',
       DATE '2026-03-01', DATE '2027-03-01', 99.90, 'active',
       'Tenant administration, user lifecycle, MFA enforcement, licence optimisation, helpdesk, quarterly compliance reviews. Renewal review: January 2027.'
FROM customers
WHERE slug = 'miskawaan-villas'
  AND NOT EXISTS (
    SELECT 1 FROM customer_sla_contracts s
    WHERE s.customer_id = customers.id AND s.service_slug = 'it-support-msp'
  );

-- ---------- Seed: a few placeholder SALA domains so the portal renders content ----------
-- F2 staff can edit/replace these via /admin/customers/[id].
INSERT INTO customer_domains
    (customer_id, domain, registrar, expires_at, privacy_enabled, auto_renew, notes)
SELECT c.id, d.domain, 'ResellerClub', d.expires_at, TRUE, TRUE, d.notes
FROM customers c
CROSS JOIN (VALUES
    ('salahospitality.com',     TIMESTAMPTZ '2026-09-15 00:00:00+07', 'Primary brand site'),
    ('salasamui.com',           TIMESTAMPTZ '2026-08-01 00:00:00+07', 'Choengmon resort site'),
    ('salaresorts.com',         TIMESTAMPTZ '2027-01-30 00:00:00+07', 'Defensive registration'),
    ('salalanna.com',           TIMESTAMPTZ '2026-11-12 00:00:00+07', 'Chiang Mai property'),
    ('salaayutthaya.com',       TIMESTAMPTZ '2026-10-05 00:00:00+07', 'Ayutthaya property')
) AS d(domain, expires_at, notes)
WHERE c.slug = 'sala-hospitality'
  AND NOT EXISTS (
    SELECT 1 FROM customer_domains cd
    WHERE cd.customer_id = c.id AND cd.domain = d.domain
  );
