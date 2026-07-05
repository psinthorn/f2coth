-- =============================================================
-- 037_app_mode.sql
-- Global site-wide mode indicator so admins can flip the whole
-- platform between production, trial-run, and maintenance without
-- a deploy. Single-row table (enforced by the id=1 CHECK).
-- =============================================================

CREATE TABLE IF NOT EXISTS app_config (
    id           INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    mode         TEXT        NOT NULL DEFAULT 'production'
                             CHECK (mode IN ('production', 'trial', 'maintenance')),
    message_en   TEXT        NOT NULL DEFAULT '',
    message_th   TEXT        NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE OR REPLACE TRIGGER set_app_config_updated_at
    BEFORE UPDATE ON app_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO app_config (id, mode) VALUES (1, 'production')
ON CONFLICT (id) DO NOTHING;

-- Register admin-only editor toggle.
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.app_mode', 'admin', 'App mode', 'โหมดเว็บแอป', 'Toggle production / trial / maintenance state', true, true, 5)
ON CONFLICT (key) DO NOTHING;
