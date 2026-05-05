-- =============================================================
-- 002_auth.sql
-- Admin / staff authentication. Public site is anonymous; this
-- table powers the /admin section and back-office tooling.
-- =============================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email           CITEXT       NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    full_name       TEXT         NOT NULL,
    role            TEXT         NOT NULL DEFAULT 'editor'
                                 CHECK (role IN ('admin','editor','viewer')),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active   ON users(is_active) WHERE is_active = TRUE;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokens — one row per active session, rotated on use.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT         NOT NULL UNIQUE,
    user_agent      TEXT,
    ip_address      INET,
    expires_at      TIMESTAMPTZ  NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user      ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires   ON refresh_tokens(expires_at);

-- Login audit log
CREATE TABLE IF NOT EXISTS login_events (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         REFERENCES users(id) ON DELETE SET NULL,
    email_attempt   CITEXT       NOT NULL,
    success         BOOLEAN      NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user        ON login_events(user_id);
CREATE INDEX IF NOT EXISTS idx_login_events_created_at  ON login_events(created_at DESC);
