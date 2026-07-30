-- 074_tickets_solution_shared.sql
-- Per-ticket toggle controlling whether the resolution write-up (tickets.solution,
-- migration 070) is exposed to the customer in their portal. Even when true, the
-- portal only reveals the solution once the ticket is resolved/closed — enforced
-- server-side in PortalHandler.GetTicket, not in the client. Defaults to FALSE so
-- existing solutions stay internal until a staff member opts in.

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS solution_shared BOOLEAN NOT NULL DEFAULT FALSE;
