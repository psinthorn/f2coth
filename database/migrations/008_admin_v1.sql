-- =============================================================
-- 008_admin_v1.sql
-- Phase 2A — Admin MVP. Soft-disable for users + index support.
-- =============================================================

-- Soft-disable instead of hard delete. NULL = active.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

-- Active-users filter is the common case.
CREATE INDEX IF NOT EXISTS idx_users_active_role
    ON users(role) WHERE disabled_at IS NULL AND is_active = TRUE;

-- The activity timeline is read by lead-api detail endpoint;
-- we already have idx_lead_activities_lead but this one helps the
-- "recent activity across all leads" dashboard query.
CREATE INDEX IF NOT EXISTS idx_lead_activities_recent
    ON lead_activities(created_at DESC);
