-- =============================================================
-- 036_admin_editable_page_heroes.sql
-- Extend home_page_content so admins can edit the hero copy on
-- /services and /case-studies (previously locked in messages/*.json).
-- Seed with the current i18n JSON values so the site renders
-- identically before/after this migration. The frontend falls back
-- to i18n JSON if a key is missing.
-- =============================================================

INSERT INTO home_page_content (key, value) VALUES
('services_page.kicker',       '{"en":"Services","th":"บริการ"}'::jsonb),
('services_page.title',        '{"en":"What F2 does for luxury hospitality.","th":"F2 ทำอะไรให้กับโรงแรมหรู"}'::jsonb),
('services_page.subtitle',     '{"en":"Eight tightly-scoped service lines, each shaped by 10+ years of running IT for the most demanding properties in Thailand.","th":"บริการ 8 สายงานที่ออกแบบอย่างเฉพาะเจาะจง สั่งสมจากประสบการณ์ดูแลไอทีให้กับอสังหาริมทรัพย์ที่เรียกร้องมาตรฐานสูงสุดในประเทศไทยมากว่า 10 ปี"}'::jsonb),

('case_studies_page.kicker',   '{"en":"Case studies","th":"กรณีศึกษา"}'::jsonb),
('case_studies_page.title',    '{"en":"Decade-long partnerships with luxury hospitality.","th":"ความร่วมมือยาวนานกว่าทศวรรษกับโรงแรมหรู"}'::jsonb),
('case_studies_page.subtitle', '{"en":"Our clients don''t change IT vendors because we don''t fail them. Each of these properties has trusted F2 for 10+ years.","th":"ลูกค้าของเราไม่เปลี่ยนผู้ให้บริการไอที เพราะเราไม่เคยทำให้ผิดหวัง อสังหาริมทรัพย์เหล่านี้ไว้ใจ F2 มากว่า 10 ปี"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
