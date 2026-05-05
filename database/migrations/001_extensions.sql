-- =============================================================
-- 001_extensions.sql
-- Postgres extensions used across the F2 corporate website.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";         -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS "pg_trgm";        -- fuzzy / GIN search

-- A small helper so triggers can keep updated_at in sync without per-table
-- duplication.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
