-- =============================================================
-- 050_ai_orchestrator.sql
-- Foundation for the AI orchestrator microservice — a provider-agnostic
-- adapter that routes each AI task (orchestrator, content_writer,
-- ticket_triage, docs_organizer, embeddings, ...) to whichever backend
-- currently serves it best (cloud Anthropic / local Ollama / etc).
--
-- Two tables:
--
--   ai_routing    — data-driven routing table. Admin flips provider or
--                   model from /admin/ai/routing without a redeploy.
--                   The service polls this every ~30s.
--
--   ai_usage_log  — every generate/embed call gets one row: tokens in,
--                   tokens out, cache hits, cost, latency, error.
--                   Powers the /admin/ai/usage dashboard + budget alerts.
--
-- Plus two module toggles:
--   admin.ai              → shows the AI section in the admin console
--   api.ai_orchestrator   → allows the orchestrator API to serve requests
-- Both default OFF so the pilot only turns on when the operator flips them.
--
-- See docs/ai-cloud-vs-local.md for full architecture rationale.
-- =============================================================

-- ---------- 1. Routing table ----------
CREATE TABLE IF NOT EXISTS ai_routing (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type      TEXT         NOT NULL,
    tier           TEXT         NOT NULL
                                CHECK (tier IN ('primary','fallback','batch')),
    provider       TEXT         NOT NULL
                                CHECK (provider IN ('anthropic','ollama','openai','voyage')),
    model          TEXT         NOT NULL,
    max_tokens_in  INT,
    max_tokens_out INT,
    enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
    notes          TEXT,
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (task_type, tier)
);
CREATE INDEX IF NOT EXISTS idx_ai_routing_task ON ai_routing (task_type, tier);
CREATE INDEX IF NOT EXISTS idx_ai_routing_enabled ON ai_routing (enabled, task_type);

CREATE OR REPLACE TRIGGER set_ai_routing_updated_at
    BEFORE UPDATE ON ai_routing
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 2. Usage log ----------
CREATE TABLE IF NOT EXISTS ai_usage_log (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    task_type          TEXT         NOT NULL,
    provider           TEXT         NOT NULL,
    model              TEXT         NOT NULL,
    tokens_in          INT          NOT NULL DEFAULT 0,
    tokens_out         INT          NOT NULL DEFAULT 0,
    cache_read_tokens  INT          NOT NULL DEFAULT 0,
    cache_write_tokens INT          NOT NULL DEFAULT 0,
    cost_usd           NUMERIC(12,6) NOT NULL DEFAULT 0,
    latency_ms         INT          NOT NULL DEFAULT 0,
    session_id         UUID,
    actor_id           UUID         REFERENCES users(id) ON DELETE SET NULL,
    error              TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_at        ON ai_usage_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_task_at   ON ai_usage_log (task_type, at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider  ON ai_usage_log (provider, at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_actor     ON ai_usage_log (actor_id, at DESC)
    WHERE actor_id IS NOT NULL;
-- Note: a partial index on date_trunc('month', at) would speed up the
-- MTD-spend dashboard query but date_trunc is not IMMUTABLE, so Postgres
-- refuses to build a functional index on it. The plain idx_ai_usage_at
-- above covers the same query pattern well enough for pilot volume.


-- ---------- 3. Seed the initial routing per approved decisions ----------
-- Decisions (docs/ai-cloud-vs-local.md § 8):
--   • Start on the existing Mac (ollama on host, host.docker.internal)
--   • triage + docs_organizer default to local (ollama) from day one
--   • Ollama runtime
--   • BGE-m3 local embeddings (was Voyage in the doc — approved to switch)
--   • Budget alert at $150/mo
INSERT INTO ai_routing (task_type, tier, provider, model, max_tokens_in, max_tokens_out, notes) VALUES
    -- Orchestrator — top-of-stack reasoning, cloud only
    ('orchestrator',      'primary',  'anthropic', 'claude-opus-4-7',     100000, 4096,
     'PM/Consult layer. Only cloud has a peer for Opus reasoning quality.'),
    ('orchestrator',      'fallback', 'anthropic', 'claude-sonnet-4-6',   100000, 4096,
     'Fallback when Opus is unavailable.'),

    -- Content writer — cloud primary for EN/TH native quality; local fallback
    ('content_writer',    'primary',  'anthropic', 'claude-sonnet-4-6',   50000, 4096,
     'Marketing / blog / SEO copy. Sonnet is sweet spot for bilingual creative.'),
    ('content_writer',    'fallback', 'ollama',    'qwen2.5:32b',         32000, 4096,
     'Local fallback. Acceptable quality for internal drafts.'),

    -- Consultant — Opus, no local peer
    ('consultant',        'primary',  'anthropic', 'claude-opus-4-7',     100000, 4096,
     'Strategy / RFP responses.'),

    -- Support assistant — routine chat, local is fine
    ('support_assistant', 'primary',  'ollama',    'mistral-small3:24b',  16000, 2048,
     'Customer portal chat. Local by default per pilot decision.'),
    ('support_assistant', 'fallback', 'anthropic', 'claude-haiku-4-5',    50000, 2048,
     'Cloud fallback if Ollama is offline.'),

    -- Ticket triage — LOCAL from day one (approved)
    ('ticket_triage',     'primary',  'ollama',    'phi4:14b',            8000, 512,
     'Classify + label incoming tickets. Local per pilot decision.'),
    ('ticket_triage',     'fallback', 'anthropic', 'claude-haiku-4-5',    8000, 512,
     'Cloud fallback if Ollama is offline.'),

    -- Docs organizer — LOCAL from day one (approved)
    ('docs_organizer',    'primary',  'ollama',    'phi4:14b',            16000, 2048,
     'Dedup, tag, consolidate notes. Local per pilot decision.'),
    ('docs_organizer',    'fallback', 'anthropic', 'claude-haiku-4-5',    16000, 2048,
     'Cloud fallback if Ollama is offline.'),

    -- Data analyst — local capable
    ('data_analyst',      'primary',  'ollama',    'qwen2.5:32b',         32000, 4096,
     'SQL summarization + JSON output. Qwen 2.5 handles this well locally.'),
    ('data_analyst',      'fallback', 'anthropic', 'claude-sonnet-4-6',   32000, 4096,
     'Cloud fallback.'),

    -- RAG helpers — local
    ('rag_chunker',       'primary',  'ollama',    'phi4:14b',            8000, 512, NULL),
    ('rag_reranker',      'primary',  'ollama',    'phi4:14b',            8000, 512, NULL),

    -- Embeddings — LOCAL BGE-m3 per approved decision (was cloud Voyage in doc)
    ('embeddings',        'primary',  'ollama',    'bge-m3',              8000, NULL,
     'Multilingual embeddings. Local BGE-m3 chosen for pilot cost.'),
    ('embeddings',        'fallback', 'voyage',    'voyage-3',            8000, NULL,
     'Cloud fallback. Marginally better recall but paid.')
ON CONFLICT (task_type, tier) DO NOTHING;


-- ---------- 4. Register the two module toggles (default OFF) ----------
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order)
VALUES
    ('admin.ai',
     'admin',
     'AI orchestrator',
     'AI orchestrator',
     'Admin console for the AI orchestrator: routing table, usage/cost dashboard, and (later phases) content studio + agent config.',
     FALSE, FALSE, 115),
    ('api.ai_orchestrator',
     'api',
     'AI orchestrator API',
     'API AI orchestrator',
     'Provider-agnostic AI routing service (ai-orchestrator-api). Flip on once Ollama is installed and Anthropic key is configured.',
     FALSE, FALSE, 100)
ON CONFLICT (key) DO NOTHING;
