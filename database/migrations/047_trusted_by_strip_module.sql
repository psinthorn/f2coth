-- =============================================================
-- 047_trusted_by_strip_module.sql
-- Registers `public.trusted_by_strip` — the horizontal "trusted by"
-- band displayed on the home and about pages. Reuses the consented
-- client rows already governed by `public.clients` (migration 046),
-- so no schema changes are needed; only the toggle is new.
--
-- Default OFF: F2 admin flips it on from /admin/features once at
-- least a handful of clients have signed the Basic consent letter
-- (docs/consent/basic-consent-*.md).
-- =============================================================

INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order)
VALUES (
    'public.trusted_by_strip',
    'public',
    'Trusted-by strip (home + about)',
    'แถบ "ลูกค้าที่ไว้วางใจ" (หน้าแรก + เกี่ยวกับเรา)',
    'Horizontal band of consented client names on the home and about pages. Sources the same rows as /clients (module public.clients). Turn on only after Basic consent letters are on file.',
    FALSE,
    FALSE,
    46  -- sits directly after public.clients (45)
)
ON CONFLICT (key) DO NOTHING;
