-- =============================================================
-- 065_assethub.sql
-- F2 AssetHub — IT asset discovery & inventory module.
--
-- Multi-tenant device register for MSP hotel/SMB clients. Reuses the
-- existing `customers` row as the tenant/org root (AssetHub "org" = F2
-- customer) rather than introducing a parallel organizations table.
-- A customer may have several physical `assethub_sites` (villa/office
-- LANs). Collector scripts (agents/collect.*) and the network probe push
-- the f2.assethub.v1 schema to assethub-api over outbound HTTPS, authed
-- by per-customer/site enrollment tokens (peppered SHA-256, revocable).
--
-- Isolation is enforced the house way: every query filters on
-- customer_id from the JWT claim (staff routes) or the resolved token
-- (ingest). No Postgres RLS anywhere in this codebase.
--
-- Reuses: customers (tenant), users (staff FK), audit_log (migration
-- 019, generic writeAudit), set_updated_at() (migration 009).
--
-- Next migration: 066_*.sql
-- =============================================================

BEGIN;

-- ---------- Sites: physical LANs under a customer ----------
CREATE TABLE IF NOT EXISTS assethub_sites (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    cidrs        TEXT[]      NOT NULL DEFAULT '{}',   -- probe scan scope hint
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id, name)
);
CREATE INDEX IF NOT EXISTS idx_assethub_sites_customer ON assethub_sites(customer_id);

CREATE TRIGGER trg_assethub_sites_updated_at
BEFORE UPDATE ON assethub_sites
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Enrollment tokens: machine credential for ingest ----------
-- token_hash = encode(sha256(TOKEN_PEPPER || plaintext), 'hex'). The
-- plaintext secret is shown once at creation and never stored. A token
-- maps a pushing client to exactly one customer (and optionally one site);
-- clients never choose their own tenant. Revocable + rotatable.
CREATE TABLE IF NOT EXISTS assethub_enrollment_tokens (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id      UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    label        TEXT        NOT NULL,
    token_hash   TEXT        NOT NULL UNIQUE,
    token_prefix TEXT        NOT NULL DEFAULT '',     -- first 8 chars, shown in UI for identification
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assethub_tokens_customer ON assethub_enrollment_tokens(customer_id);
CREATE INDEX IF NOT EXISTS idx_assethub_tokens_active   ON assethub_enrollment_tokens(token_hash)
    WHERE revoked_at IS NULL;

-- ---------- Devices: the unified asset ----------
CREATE TABLE IF NOT EXISTS assethub_devices (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id              UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id                  UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    device_type              TEXT        NOT NULL DEFAULT 'unknown'
                                         CHECK (device_type IN ('computer','server','nas','router','switch','ap','printer','camera','phone','tablet','iot','unknown')),
    hostname                 TEXT,
    brand                    TEXT,
    model                    TEXT,
    serial_number            TEXT,
    asset_tag                TEXT,
    os_name                  TEXT,
    os_version              TEXT,
    cpu                      TEXT,
    ram_mb                   INTEGER,
    storage_summary          TEXT,
    network_role             TEXT        NOT NULL DEFAULT 'n/a'
                                         CHECK (network_role IN ('domain','workgroup','standalone','n/a')),
    domain_or_workgroup_name TEXT,
    primary_mac              TEXT,
    primary_ip               TEXT,
    assigned_user            TEXT,
    status                   TEXT        NOT NULL DEFAULT 'active'
                                         CHECK (status IN ('active','retired','missing')),
    source                   TEXT        NOT NULL DEFAULT 'manual'
                                         CHECK (source IN ('agent','probe','manual')),
    first_seen               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes                    TEXT,
    raw                      JSONB       NOT NULL DEFAULT '{}',   -- full last payload; schema-flexible for enterprise growth
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assethub_devices_customer  ON assethub_devices(customer_id, device_type);
CREATE INDEX IF NOT EXISTS idx_assethub_devices_site      ON assethub_devices(site_id);
CREATE INDEX IF NOT EXISTS idx_assethub_devices_lastseen  ON assethub_devices(customer_id, last_seen DESC);
-- Dedup identity precedence (serial → MAC → hostname+org) is enforced in the
-- ingest handler; these partial-unique indexes guard the two strong keys.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assethub_devices_serial ON assethub_devices(customer_id, serial_number)
    WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assethub_devices_mac ON assethub_devices(customer_id, primary_mac)
    WHERE primary_mac IS NOT NULL AND primary_mac <> '';

CREATE TRIGGER trg_assethub_devices_updated_at
BEFORE UPDATE ON assethub_devices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Per-device child tables (fully replaced on each merge) ----------
CREATE TABLE IF NOT EXISTS assethub_device_interfaces (
    id         UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id  UUID   NOT NULL REFERENCES assethub_devices(id) ON DELETE CASCADE,
    name       TEXT,
    mac        TEXT,
    ipv4       TEXT[] NOT NULL DEFAULT '{}',
    ipv6       TEXT[] NOT NULL DEFAULT '{}',
    type       TEXT,                              -- ethernet | wifi
    ssid       TEXT
);
CREATE INDEX IF NOT EXISTS idx_assethub_ifaces_device ON assethub_device_interfaces(device_id);
CREATE INDEX IF NOT EXISTS idx_assethub_ifaces_mac    ON assethub_device_interfaces(mac) WHERE mac IS NOT NULL;

CREATE TABLE IF NOT EXISTS assethub_device_disks (
    id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id    UUID    NOT NULL REFERENCES assethub_devices(id) ON DELETE CASCADE,
    model        TEXT,
    size_gb      NUMERIC(12,2),
    free_gb      NUMERIC(12,2),
    type         TEXT,                            -- SSD | HDD
    smart_status TEXT
);
CREATE INDEX IF NOT EXISTS idx_assethub_disks_device ON assethub_device_disks(device_id);

CREATE TABLE IF NOT EXISTS assethub_device_software (
    id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id    UUID  NOT NULL REFERENCES assethub_devices(id) ON DELETE CASCADE,
    name         TEXT  NOT NULL,
    version      TEXT,
    vendor       TEXT,
    install_date DATE
);
CREATE INDEX IF NOT EXISTS idx_assethub_software_device ON assethub_device_software(device_id);

-- ---------- Submissions: every inbound payload (audit trail) ----------
CREATE TABLE IF NOT EXISTS assethub_submissions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id      UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    device_id    UUID        REFERENCES assethub_devices(id) ON DELETE SET NULL,
    token_id     UUID        REFERENCES assethub_enrollment_tokens(id) ON DELETE SET NULL,
    source       TEXT        NOT NULL DEFAULT 'agent',
    collected_at TIMESTAMPTZ,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload      JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_assethub_submissions_device ON assethub_submissions(device_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_assethub_submissions_cust   ON assethub_submissions(customer_id, received_at DESC);

-- ---------- Discovery: probe scans before merge (triage queue) ----------
CREATE TABLE IF NOT EXISTS assethub_discovery_runs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id       UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    token_id      UUID        REFERENCES assethub_enrollment_tokens(id) ON DELETE SET NULL,
    started_at    TIMESTAMPTZ,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finding_count INTEGER     NOT NULL DEFAULT 0,
    raw           JSONB       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_assethub_disco_runs_cust ON assethub_discovery_runs(customer_id, received_at DESC);

CREATE TABLE IF NOT EXISTS assethub_discovery_findings (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id         UUID        NOT NULL REFERENCES assethub_discovery_runs(id) ON DELETE CASCADE,
    customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id        UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    ip             TEXT,
    mac            TEXT,
    vendor         TEXT,
    hostname       TEXT,
    open_ports     TEXT,
    snmp_sysdescr  TEXT,
    suggested_type TEXT        NOT NULL DEFAULT 'unknown',
    status         TEXT        NOT NULL DEFAULT 'untriaged'
                               CHECK (status IN ('untriaged','promoted','ignored')),
    device_id      UUID        REFERENCES assethub_devices(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assethub_findings_run  ON assethub_discovery_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_assethub_findings_cust ON assethub_discovery_findings(customer_id, status);

-- ---------- Report jobs: async handover-doc generation (worker queue) ----------
-- Mirrors the notifications-table worker pattern (migration 006): the
-- assethub worker polls status='queued', renders xlsx (excelize) or
-- docx/pdf (docgen), writes to the reports volume, and flips to 'done'.
CREATE TABLE IF NOT EXISTS assethub_report_jobs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    site_id       UUID        REFERENCES assethub_sites(id) ON DELETE SET NULL,
    project_id    UUID,                            -- optional tie-in to an audit/project (soft ref)
    kind          TEXT        NOT NULL DEFAULT 'handover'
                              CHECK (kind IN ('handover')),
    format        TEXT        NOT NULL DEFAULT 'xlsx'
                              CHECK (format IN ('xlsx','pdf','docx')),
    status        TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','processing','done','failed','dead')),
    attempts      INTEGER     NOT NULL DEFAULT 0,
    requested_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    params        JSONB       NOT NULL DEFAULT '{}',
    file_path     TEXT,
    error         TEXT,
    scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assethub_reports_queue ON assethub_report_jobs(status, scheduled_at)
    WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_assethub_reports_cust  ON assethub_report_jobs(customer_id, created_at DESC);

CREATE TRIGGER trg_assethub_reports_updated_at
BEFORE UPDATE ON assethub_report_jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Module registration (toggleable in /admin/features) ----------
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('api.assethub',    'api',    'AssetHub API',      'AssetHub API',
 'Ingest, discovery and asset-register endpoints for the AssetHub module', true, false, 80),
('admin.assethub',  'admin',  'Asset Register',    'ทะเบียนสินทรัพย์',
 'IT asset discovery & inventory: device register, discovery triage, sites & enrollment tokens, handover reports', true, false, 80),
('portal.assethub', 'portal', 'Asset Register',    'ทะเบียนสินทรัพย์',
 'Read-only IT asset register for the customer portal', true, false, 80)
ON CONFLICT (key) DO NOTHING;

-- ---------- Entitlement: make Miskawaan an AssetHub customer for demo/dev ----------
-- The portal register is 404-invisible unless services_used contains
-- 'asset-management' (mirrors the domain-hosting entitlement pattern).
UPDATE customers
SET services_used = array_append(services_used, 'asset-management')
WHERE slug = 'miskawaan-villas'
  AND NOT ('asset-management' = ANY(services_used));

-- ---------- Seed: a default site for Miskawaan so ingest has a target ----------
INSERT INTO assethub_sites (customer_id, name, cidrs, notes)
SELECT id, 'Main Villa Network', ARRAY['192.168.1.0/24'], 'Default site created by migration 065 for AssetHub onboarding.'
FROM customers
WHERE slug = 'miskawaan-villas'
  AND NOT EXISTS (
    SELECT 1 FROM assethub_sites s WHERE s.customer_id = customers.id AND s.name = 'Main Villa Network'
  );

COMMIT;
