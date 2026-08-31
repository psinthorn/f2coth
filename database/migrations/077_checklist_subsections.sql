-- 077_checklist_subsections.sql
-- ─────────────────────────────────────────────
-- Adds a third level to the audit checklist hierarchy:
--
--     Section (project_modules)
--       └─ Sub-section (project_subsections)   ← NEW
--            └─ Item (project_items)
--
-- Sub-sections are optional: an item with subsection_id = NULL renders
-- directly under its section, so every existing 78-item audit keeps working
-- untouched. Deleting a sub-section sets its items' subsection_id back to
-- NULL (items move up to the section — never destroyed).
--
-- Sections previously had to come from the drag-drop template library
-- (template_id NOT NULL, name JOINed from checklist_templates). To allow
-- custom one-off sections and per-project renames without mutating the
-- shared template, template_id becomes nullable and the display fields
-- (code/name/icon) now live on the section row itself. Existing rows are
-- backfilled from their template.
--
-- Next migration: 078_*.sql
-- ─────────────────────────────────────────────

-- ── 1. Sections own their display fields; template link becomes optional ──
ALTER TABLE project_modules
    ADD COLUMN IF NOT EXISTS name_en   TEXT,
    ADD COLUMN IF NOT EXISTS name_th   TEXT,
    ADD COLUMN IF NOT EXISTS code      TEXT,
    ADD COLUMN IF NOT EXISTS icon      TEXT,
    ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill display fields from the linked template for all existing sections.
UPDATE project_modules pm
   SET name_en = COALESCE(pm.name_en, t.name_en),
       name_th = COALESCE(pm.name_th, t.name_th),
       code    = COALESCE(pm.code, t.code),
       icon    = COALESCE(pm.icon, t.icon)
  FROM checklist_templates t
 WHERE t.id = pm.template_id;

-- Now that names live on the row, the template link is optional (custom
-- sections have none). Postgres treats NULLs as distinct, so the existing
-- UNIQUE(project_id, template_id) still permits many custom sections.
ALTER TABLE project_modules ALTER COLUMN template_id DROP NOT NULL;

-- ── 2. Sub-sections ──
CREATE TABLE IF NOT EXISTS project_subsections (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_module_id  UUID        NOT NULL REFERENCES project_modules(id) ON DELETE CASCADE,
    name_en            TEXT        NOT NULL,
    name_th            TEXT        NOT NULL,
    sort_order         INT         NOT NULL DEFAULT 0,
    is_custom          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_subsections_module
    ON project_subsections(project_module_id, sort_order);
CREATE TRIGGER trg_project_subsections_updated_at
    BEFORE UPDATE ON project_subsections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 3. Items may belong to a sub-section (else they sit under the section) ──
-- ON DELETE SET NULL: dropping a sub-section moves its items up, not away.
ALTER TABLE project_items
    ADD COLUMN IF NOT EXISTS subsection_id UUID
        REFERENCES project_subsections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_items_subsection
    ON project_items(subsection_id) WHERE subsection_id IS NOT NULL;
