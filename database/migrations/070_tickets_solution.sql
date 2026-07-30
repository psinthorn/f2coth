-- 070_tickets_solution.sql
-- Support tickets gain a dedicated "solution" field alongside the existing
-- subject/issue. The issue lives in the initial ticket_messages body; the
-- solution is the resolution write-up, normally filled in as the ticket is
-- worked and shown on the ticket detail. Both are authored as minimal
-- markdown by F2 staff. Timestamped notes reuse ticket_messages (internal=true).

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS solution TEXT NOT NULL DEFAULT '';
