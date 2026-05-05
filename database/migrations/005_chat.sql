-- =============================================================
-- 005_chat.sql
-- AI chatbot (Claude API). Anonymous visitors start a session,
-- exchange messages, and may convert into a lead.
-- =============================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_id      TEXT         NOT NULL,            -- cookie-bound opaque ID
    lead_id         UUID         REFERENCES leads(id) ON DELETE SET NULL,
    user_agent      TEXT,
    ip_address      INET,
    referrer        TEXT,
    landing_path    TEXT,
    locale          TEXT         NOT NULL DEFAULT 'en',
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor      ON chat_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_active  ON chat_sessions(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_lead         ON chat_sessions(lead_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID         NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            TEXT         NOT NULL CHECK (role IN ('user','assistant','system')),
    content         TEXT         NOT NULL,
    model           TEXT,                              -- e.g. claude-sonnet-4-6
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
