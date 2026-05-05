-- =============================================================
-- 014_orders.sql
-- Phase 4B — Reseller integration: domain order tracking + per-FQDN
-- availability cache so we don't burn registry quota re-checking the
-- same name. ResellerClub credentials live in .env (sandbox by default
-- against test.httpapi.com); THNIC stays manual via partner portal but
-- still gets a domain_orders row so admin has one queue to work.
-- =============================================================

-- ---------- domain_orders ----------
CREATE TABLE IF NOT EXISTS domain_orders (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    sld                      TEXT         NOT NULL,
    tld                      TEXT         NOT NULL,
    fqdn                     TEXT         GENERATED ALWAYS AS (sld || '.' || tld) STORED,
    registry                 TEXT         NOT NULL CHECK (registry IN ('thnic','resellerclub')),

    -- Optional links: an order can come from a logged-in customer, an
    -- anonymous lead, or be created manually by staff. All three nullable.
    customer_id              UUID         REFERENCES customers(id)             ON DELETE SET NULL,
    lead_id                  UUID         REFERENCES leads(id)                 ON DELETE SET NULL,
    requested_by_user_id     UUID         REFERENCES users(id)                 ON DELETE SET NULL,

    -- Snapshot of the registrant contact at order time. We keep this on the
    -- row even when there's a customer_id so we can re-issue/transfer later
    -- without joining the live customer record (which may have changed).
    contact_name             TEXT,
    contact_email            CITEXT,
    contact_phone            TEXT,
    contact_company          TEXT,

    years                    INTEGER      NOT NULL DEFAULT 1 CHECK (years >= 1 AND years <= 10),
    privacy_enabled          BOOLEAN      NOT NULL DEFAULT FALSE,

    status                   TEXT         NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','quoted','approved','registered','active','rejected','cancelled','failed')),

    -- Set by reseller-api after a successful registry call.
    registry_order_id        TEXT,
    registry_response        JSONB        NOT NULL DEFAULT '{}'::jsonb,

    notes                    TEXT,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_orders_status     ON domain_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_orders_customer   ON domain_orders(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_domain_orders_lead       ON domain_orders(lead_id)     WHERE lead_id     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_domain_orders_fqdn       ON domain_orders(fqdn);
CREATE INDEX IF NOT EXISTS idx_domain_orders_registry   ON domain_orders(registry, status);

CREATE TRIGGER trg_domain_orders_updated_at
BEFORE UPDATE ON domain_orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- domain_availability_cache ----------
-- 15 minute TTL: ResellerClub answers are recently-cached themselves and
-- registrants change rarely. Hot lookups are cheap.
CREATE TABLE IF NOT EXISTS domain_availability_cache (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    fqdn            TEXT         NOT NULL UNIQUE,
    available       BOOLEAN      NOT NULL,
    classification  TEXT         NOT NULL DEFAULT 'unknown'
        CHECK (classification IN ('available','registered','reserved','premium','manual','unknown')),
    raw_response    JSONB        NOT NULL DEFAULT '{}'::jsonb,
    source          TEXT         NOT NULL DEFAULT 'mock'
        CHECK (source IN ('resellerclub','thnic_stub','mock')),
    checked_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_avail_cache_expires ON domain_availability_cache(expires_at);

-- Janitor — drop expired rows. Cheap; called opportunistically by
-- reseller-api on each lookup. We could put this on pg_cron later.
CREATE OR REPLACE FUNCTION purge_expired_availability_cache() RETURNS void AS $$
    DELETE FROM domain_availability_cache WHERE expires_at < NOW();
$$ LANGUAGE SQL;
