-- 078_org_roles.sql
-- ─────────────────────────────────────────────
-- Multi-tenant Phase 1 — Organization RBAC.
--
-- Widens the per-org role from a 2-value label (owner/member) into a real
-- 5-level model that the portal now enforces:
--
--     owner   — full control incl. billing, members (incl. owners), close org
--     admin   — runs the org day-to-day; members (≤ admin), tickets, sections
--     billing — invoices / subscriptions / payments
--     member  — creates & manages own tickets; updates editable item status
--     viewer  — read-only
--
-- The authoritative role lives on contact_org_memberships (a person may be
-- owner of one org and viewer of another). customer_contacts.role is legacy /
-- denormalised and not consulted for authz, but its CHECK is widened too so
-- inserts with the new values don't fail.
--
-- Additive, idempotent — existing owner/member rows stay valid, no backfill.
--
-- Next migration: 079_*.sql
-- ─────────────────────────────────────────────

ALTER TABLE contact_org_memberships DROP CONSTRAINT IF EXISTS contact_org_memberships_role_check;
ALTER TABLE contact_org_memberships
    ADD CONSTRAINT contact_org_memberships_role_check
    CHECK (role IN ('owner','admin','billing','member','viewer'));

ALTER TABLE customer_contacts DROP CONSTRAINT IF EXISTS customer_contacts_role_check;
ALTER TABLE customer_contacts
    ADD CONSTRAINT customer_contacts_role_check
    CHECK (role IN ('owner','admin','billing','member','viewer'));

-- Portal self-administration ("Team") — admin on/off toggle like every module.
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order)
VALUES ('portal.team', 'portal', 'Team & Roles',
        'ทีมและสิทธิ์',
        'Org owners/admins manage their own members and roles in the portal.',
        TRUE, FALSE, 55)
ON CONFLICT (key) DO NOTHING;
