-- 066_assethub_scan_control.sql
-- Poll-based "Scan now" + scheduling for AssetHub agents.
--
-- The agents are outbound-only (they push to the server; the server can never
-- reach into a client network). So a "Scan now" button can't push a command —
-- instead the agent runs as a daemon that polls GET /api/assethub/agent/poll,
-- and the server answers run=true when either (a) an operator pressed Scan now
-- (scan_requested_at is newer than the last run) or (b) the rescan interval has
-- elapsed. State is scoped to the enrollment token = one always-on agent
-- (the probe box, or one-token-per-machine collectors).

ALTER TABLE assethub_enrollment_tokens
    ADD COLUMN IF NOT EXISTS scan_requested_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_scan_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rescan_interval_min INTEGER NOT NULL DEFAULT 360,
    ADD COLUMN IF NOT EXISTS poll_interval_min   INTEGER NOT NULL DEFAULT 5;
