-- 054_contract_management.sql
-- Contract Management — powers the contract-api microservice. F2's master
-- service agreement acts as a reusable skeleton: staff enter a customer's
-- details, generate a print-ready PDF (via the internal docgen service),
-- and upload the signed scan back onto the contract record.
--
-- Design notes
--   * Multi-contract AND multi-template. `contract_templates.code` maps 1:1
--     to a builder registered in the docgen service (code-defined layouts).
--     The wizard/API/DB are template-agnostic; only the rendered layout is
--     code-bound. contract-api validates a template's code against docgen's
--     GET /templates on write.
--   * Parties live in their own table (contract_parties) rather than
--     extending the thin `customers` table (009), with an OPTIONAL FK back
--     to customers so a party can link to a portal account without needing
--     one. One customer concept, not duplicated — reused by FK.
--   * project_id is a nullable FK to projects (038) so a contract can be
--     tied to a checklist/audit engagement (first client: Miskawaan).
--   * Generated docx/pdf and signed scans are stored on a Docker volume by
--     contract-api (contract-uploads), NEVER as bytes in Postgres. This
--     table only holds metadata + the relative storage_path. Mirrors the
--     checklist-api uploads.go mechanism (volume + UUID filenames).
--   * Doc numbers (F2-AGR-<year>-<seq>) are allocated concurrency-safely
--     via contract_doc_seq using INSERT ... ON CONFLICT DO UPDATE RETURNING
--     inside the create transaction (row lock serialises concurrent inserts).
--   * iacc_outbox queues invoice-draft payloads on status -> active for the
--     future iACC (psinthorn/iacc-php-mvc) integration; drained later.
--
-- Seed data (two templates: service-agreement + mutual-nda) lives in
-- 055_seed_contract_templates.sql.
--
-- Next migration: 056_*.sql

BEGIN;

-- ─────────────────────────────────────────────
-- 1. contract_parties — the customer/legal entity on a contract
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_parties (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Optional link to an existing portal customer (009). SET NULL keeps the
    -- party (and its contracts) intact if the customer record is removed.
    customer_id    UUID        REFERENCES customers(id) ON DELETE SET NULL,
    legal_name_en  TEXT        NOT NULL,
    legal_name_th  TEXT        NOT NULL,
    brand_name     TEXT,
    tax_id         TEXT,
    address        TEXT,
    notice_email   CITEXT,
    contact_person TEXT,
    phone          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_parties_customer ON contract_parties(customer_id);
CREATE INDEX IF NOT EXISTS idx_contract_parties_name     ON contract_parties(legal_name_en);
CREATE TRIGGER trg_contract_parties_updated_at
    BEFORE UPDATE ON contract_parties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 2. contract_templates — one row per document type
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_templates (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- code == docgen builder key. Also drives the doc-no prefix (see the
    -- doc_prefix column below). Unique so it can be referenced by code.
    code         TEXT        NOT NULL UNIQUE,
    name         TEXT        NOT NULL,
    version      TEXT        NOT NULL DEFAULT '1.0',
    -- Prefix for auto doc numbers, e.g. 'F2-AGR' -> F2-AGR-2026-001.
    doc_prefix   TEXT        NOT NULL DEFAULT 'F2-DOC',
    -- Field definitions that drive the wizard form + supply docgen defaults.
    -- Shape: { "fields": [ {key,type,label_en,label_th,required,default,group}, ... ] }
    merge_schema JSONB       NOT NULL DEFAULT '{"fields":[]}'::jsonb,
    is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_templates_active ON contract_templates(is_active);
CREATE TRIGGER trg_contract_templates_updated_at
    BEFORE UPDATE ON contract_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 3. contract_doc_seq — per-year counter for safe doc-no allocation
-- ─────────────────────────────────────────────
-- One row per calendar year. Allocation:
--   INSERT INTO contract_doc_seq(year, last_seq) VALUES ($yr, 1)
--   ON CONFLICT (year) DO UPDATE SET last_seq = contract_doc_seq.last_seq + 1
--   RETURNING last_seq;
-- The ON CONFLICT UPDATE takes a row lock, so concurrent contract inserts
-- serialise and every doc-no is unique + gap-free within a year.
CREATE TABLE IF NOT EXISTS contract_doc_seq (
    year     INT PRIMARY KEY,
    last_seq INT NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- 4. contracts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_no         TEXT        NOT NULL UNIQUE,      -- F2-AGR-2026-001
    template_id    UUID        NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
    party_id       UUID        NOT NULL REFERENCES contract_parties(id)   ON DELETE RESTRICT,
    -- Optional link to a checklist/audit project (038).
    project_id     UUID        REFERENCES projects(id) ON DELETE SET NULL,
    -- Snapshot of the filled merge fields at create/generate time.
    merge_data     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status         TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft','sent','signed','active','expired','terminated')),
    effective_date DATE,
    end_date       DATE,
    fee_total      NUMERIC(12,2),
    created_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contracts_status   ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_party    ON contracts(party_id);
CREATE INDEX IF NOT EXISTS idx_contracts_template ON contracts(template_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project  ON contracts(project_id);
-- Drives the "expiring within 30 days" dashboard/list query.
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date)
    WHERE status = 'active';
CREATE TRIGGER trg_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 5. contract_files — metadata for artifacts on the volume
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_files (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id  UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    kind         TEXT        NOT NULL
                             CHECK (kind IN ('generated_docx','generated_pdf','signed_scan')),
    filename     TEXT        NOT NULL,               -- human-facing download name
    storage_path TEXT        NOT NULL,               -- relative path inside the volume
    mime_type    TEXT        NOT NULL,
    size_bytes   INT         NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520), -- 20 MB
    sha256       TEXT,
    uploaded_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_files_contract
    ON contract_files(contract_id, created_at DESC);

-- ─────────────────────────────────────────────
-- 6. contract_status_events — timeline / audit of transitions
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract_status_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT        NOT NULL,
    note        TEXT,
    changed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_status_events_contract
    ON contract_status_events(contract_id, created_at);

-- ─────────────────────────────────────────────
-- 7. iacc_outbox — queued invoice-draft payloads (wired later)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iacc_outbox (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    payload     JSONB       NOT NULL,   -- {company_id, doc_no, fee_total, currency, ...}
    status      TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','sent','failed')),
    attempts    INT         NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_iacc_outbox_pending
    ON iacc_outbox(status, created_at) WHERE status = 'pending';

-- ─────────────────────────────────────────────
-- 8. Module-toggle registry rows (surface in /admin/features)
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
    ('admin.contracts', 'admin', 'Contracts', 'สัญญา',
     'Admin contracts console (list, wizard, detail, templates)',
     true, false, 90),
    ('api.contracts', 'api', 'Contracts', 'สัญญา',
     'Contract management: templates, parties, PDF generation and signed-scan upload',
     true, false, 91),
    ('service.docgen', 'api', 'Document Generation', 'การสร้างเอกสาร',
     'Internal docx/PDF generator for contracts (bilingual, branded, watermarked drafts)',
     true, false, 92)
ON CONFLICT (key) DO NOTHING;

COMMIT;
