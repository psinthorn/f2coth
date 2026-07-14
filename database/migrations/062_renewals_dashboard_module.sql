-- 062_renewals_dashboard_module.sql
-- Registers the admin renewals dashboard (/admin/renewals) as a toggleable
-- module so it appears in /admin/features and the admin nav gate. The page
-- is read-only over the renewal engine (upcoming subscription + domain
-- renewals, reminder/notice log) served by payment-api GET /admin/renewals.
--
-- Next migration: 063_*.sql

BEGIN;

INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.renewals', 'admin', 'Renewals', 'การต่ออายุ',
 'Dashboard of upcoming subscription + domain renewals and the reminder log', true, false, 71)
ON CONFLICT (key) DO NOTHING;

COMMIT;
