-- =============================================================
-- 009_customers.sql
-- Phase 2B.1 — Customer portal: customers, contacts, tickets.
-- =============================================================

-- ---------- Customer organisations ----------
CREATE TABLE IF NOT EXISTS customers (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                  TEXT         NOT NULL UNIQUE,
    name                  TEXT         NOT NULL,
    industry              TEXT,
    primary_contact_name  TEXT,
    primary_contact_email CITEXT,
    primary_contact_phone TEXT,
    account_manager_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    services_used         TEXT[]       NOT NULL DEFAULT '{}',
    notes                 TEXT,
    is_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_active           ON customers(is_active);
CREATE INDEX IF NOT EXISTS idx_customers_account_manager  ON customers(account_manager_id);
CREATE INDEX IF NOT EXISTS idx_customers_services_used    ON customers USING GIN (services_used);

CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Customer contacts (login records) ----------
CREATE TABLE IF NOT EXISTS customer_contacts (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id     UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    email           CITEXT       NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    full_name       TEXT         NOT NULL,
    role            TEXT         NOT NULL DEFAULT 'member'
                                 CHECK (role IN ('owner','member')),
    last_login_at   TIMESTAMPTZ,
    disabled_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer ON customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_active   ON customer_contacts(customer_id)
    WHERE disabled_at IS NULL;

CREATE TRIGGER trg_customer_contacts_updated_at
BEFORE UPDATE ON customer_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Customer-side refresh tokens, separate from staff refresh_tokens.
CREATE TABLE IF NOT EXISTS customer_refresh_tokens (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id   UUID         NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
    token_hash   TEXT         NOT NULL UNIQUE,
    user_agent   TEXT,
    ip_address   INET,
    expires_at   TIMESTAMPTZ  NOT NULL,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cust_refresh_contact ON customer_refresh_tokens(contact_id);
CREATE INDEX IF NOT EXISTS idx_cust_refresh_expires ON customer_refresh_tokens(expires_at);

-- ---------- Tickets ----------
CREATE TABLE IF NOT EXISTS tickets (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id           UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    opened_by_contact_id  UUID         REFERENCES customer_contacts(id) ON DELETE SET NULL,
    subject               TEXT         NOT NULL,
    status                TEXT         NOT NULL DEFAULT 'open'
                                       CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
    priority              TEXT         NOT NULL DEFAULT 'normal'
                                       CHECK (priority IN ('low','normal','high','urgent')),
    assigned_to_user_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
    related_service_slug  TEXT,
    last_activity_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer        ON tickets(customer_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status          ON tickets(status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned        ON tickets(assigned_to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority_status ON tickets(priority, status);

CREATE TRIGGER trg_tickets_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Ticket messages ----------
CREATE TABLE IF NOT EXISTS ticket_messages (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id           UUID         NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
    author_contact_id   UUID         REFERENCES customer_contacts(id) ON DELETE SET NULL,
    body                TEXT         NOT NULL,
    internal            BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Exactly one author kind per message.
    CHECK ((author_user_id IS NOT NULL) <> (author_contact_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id, created_at);

-- ---------- Seed: case-study clients as customers ----------
-- bcrypt(cost=12, "Welcome2026!") hash, identical for all 3 placeholder accounts.
-- F2 admin should rotate these on hand-off.
DO $$
DECLARE
    bcrypt_welcome2026 TEXT := '$2a$12$nnVC8FOd6I//1DulTeiczOebD5NjR6Qy15lZQYCdmFKf5PlYEbH8C';
    sala_id UUID;
    putahracsa_id UUID;
    miskawaan_id UUID;
BEGIN
    INSERT INTO customers (slug, name, industry, primary_contact_email, services_used, notes, is_active)
    VALUES ('sala-hospitality', 'SALA Hospitality Group', 'Luxury Hotels & Resorts',
            'admin@salahospitality.com', ARRAY['domain-hosting'],
            'Domain & Privacy management — 10+ year client. ResellerClub portfolio.', TRUE)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO sala_id;

    INSERT INTO customers (slug, name, industry, primary_contact_email, services_used, notes, is_active)
    VALUES ('putahracsa-hua-hin', 'Putahracsa Hua Hin', 'Boutique Luxury Resort',
            'gm@putahracsa.com',
            ARRAY['it-management','domain-hosting','cybersecurity','hardware-solar'],
            'Full IT operations, remote-managed from Bangkok/Samui. 10+ year client.', TRUE)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO putahracsa_id;

    INSERT INTO customers (slug, name, industry, primary_contact_email, services_used, notes, is_active)
    VALUES ('miskawaan-villas', 'Miskawaan Beachfront Villas', 'Ultra-Luxury Private Villas',
            'admin@miskawaanvillas.com',
            ARRAY['it-support-msp','it-management'],
            'Microsoft 365 administration under one-year SLA, Mar 2026 – Mar 2027.', TRUE)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO miskawaan_id;

    -- One placeholder contact per customer. Password: Welcome2026!
    -- (Bcrypt hash above — F2 admin to rotate on real handover.)
    INSERT INTO customer_contacts (customer_id, email, password_hash, full_name, role)
    VALUES
        (sala_id,        'admin@salahospitality.com',  bcrypt_welcome2026, 'SALA Admin',        'owner'),
        (putahracsa_id,  'gm@putahracsa.com',          bcrypt_welcome2026, 'Putahracsa GM',     'owner'),
        (miskawaan_id,   'admin@miskawaanvillas.com',  bcrypt_welcome2026, 'Miskawaan Admin',   'owner')
    ON CONFLICT (email) DO NOTHING;
END $$;
