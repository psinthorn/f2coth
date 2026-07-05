-- 038_projects_checklists.sql
-- Projects & Checklists — powers the checklist-api microservice used by
-- F2 staff to run client IT projects (first client: Miskawaan — IT audit
-- + weekly maintenance visits).
--
-- Tables
--   1. checklist_templates       — reusable module library (bilingual)
--   2. checklist_template_items  — items inside a template
--   3. projects                  — a client engagement
--   4. project_modules           — a template attached to a project (position = drag-drop order)
--   5. project_items             — snapshot copy of template items at attach time
--                                  so later template edits don't rewrite history
--   6. visit_logs                — free-form visit records (feeds weekly/monthly reports)
--
-- Seed data (12 modules, 78 items) lives in 039_checklist_seed.sql.
--
-- Module-toggle registry rows for the admin UI live in 039 too.
--
-- Next migration: 040_*.sql

-- ─────────────────────────────────────────────
-- 1. checklist_templates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_templates (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL UNIQUE,
    name_en     TEXT        NOT NULL,
    name_th     TEXT        NOT NULL,
    icon        TEXT,
    sort_order  INT         NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_active
    ON checklist_templates(is_active, sort_order);
CREATE TRIGGER trg_checklist_templates_updated_at
    BEFORE UPDATE ON checklist_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 2. checklist_template_items
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_template_items (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  UUID        NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
    text_en      TEXT        NOT NULL,
    text_th      TEXT        NOT NULL,
    sort_order   INT         NOT NULL DEFAULT 0,
    required     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template
    ON checklist_template_items(template_id, sort_order);

-- ─────────────────────────────────────────────
-- 3. projects
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_name       TEXT        NOT NULL,
    name              TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','paused','closed')),
    start_date        DATE,
    end_date          DATE,
    -- Nullable link to iACC (psinthorn/iacc-php-mvc). Populated later
    -- when we start pushing monthly invoices to iACC via its REST API.
    iacc_company_id   TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_name);
CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 4. project_modules — template attached to a project
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_modules (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id  UUID        NOT NULL REFERENCES checklist_templates(id) ON DELETE RESTRICT,
    position     INT         NOT NULL DEFAULT 0,
    added_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_project_modules_project
    ON project_modules(project_id, position);

-- ─────────────────────────────────────────────
-- 5. project_items — snapshot of template items at attach time
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_items (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_module_id  UUID        NOT NULL REFERENCES project_modules(id) ON DELETE CASCADE,
    text_en            TEXT        NOT NULL,
    text_th            TEXT        NOT NULL,
    sort_order         INT         NOT NULL DEFAULT 0,
    required           BOOLEAN     NOT NULL DEFAULT TRUE,
    status             TEXT        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','pass','fail','na')),
    note               TEXT,
    photo_url          TEXT,
    checked_by         UUID        REFERENCES users(id) ON DELETE SET NULL,
    checked_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_items_module
    ON project_items(project_module_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_items_status
    ON project_items(status);
CREATE INDEX IF NOT EXISTS idx_project_items_checked_at
    ON project_items(checked_at DESC) WHERE checked_at IS NOT NULL;
CREATE TRIGGER trg_project_items_updated_at
    BEFORE UPDATE ON project_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 6. visit_logs — weekly visit records
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_logs (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    visit_date   DATE        NOT NULL,
    summary      TEXT        NOT NULL DEFAULT '',
    -- Billable flag + amount so completed billable work can later be
    -- pushed to iACC invoice drafts via its REST API (planned; see
    -- services/checklist-api/README.md § iACC integration).
    billable     BOOLEAN     NOT NULL DEFAULT FALSE,
    amount       NUMERIC(12,2),
    created_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visit_logs_project_date
    ON visit_logs(project_id, visit_date DESC);
