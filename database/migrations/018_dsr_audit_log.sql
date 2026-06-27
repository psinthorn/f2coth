-- 018_dsr_audit_log.sql
-- PDPA breach defence frequently requires F2 to demonstrate who handled a
-- Data Subject Request, when, and how. Migration 015 added the DSR table but
-- no audit trail — every PATCH silently overwrites the prior state with no
-- record of the actor or what changed.
--
-- This migration adds an append-only log keyed on dsr_id. The Go handlers
-- snapshot the actor (from JWT claims) and a JSON diff of changed fields on
-- every mutation, so we can reconstruct the full lifecycle of any request.
--
-- Next migration: 019_*.sql

CREATE TABLE IF NOT EXISTS dsr_audit_log (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    dsr_id      UUID        NOT NULL REFERENCES data_subject_requests(id) ON DELETE CASCADE,
    -- actor_id may be NULL for system-driven events (submit, requester-verify).
    -- actor_email is snapshotted at write time so the audit trail survives
    -- user deletion / email change.
    actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
    actor_email TEXT,
    action      TEXT        NOT NULL
                    CHECK (action IN (
                        'submit',          -- public DSR submission (unverified)
                        'verify',          -- requester clicked email confirmation
                        'update',          -- admin PATCH (fields diff in `changes`)
                        'note'             -- free-form internal annotation
                    )),
    -- {field: {from: <prev>, to: <new>}, ...}; empty {} for non-diff actions.
    changes     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsr_audit_dsr ON dsr_audit_log (dsr_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_dsr_audit_actor ON dsr_audit_log (actor_id, at DESC)
    WHERE actor_id IS NOT NULL;
