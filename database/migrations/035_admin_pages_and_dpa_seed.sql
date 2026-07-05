-- =============================================================
-- 035_admin_pages_and_dpa_seed.sql
-- Register admin.pages module toggle and ensure a DPA row exists so
-- the new /admin/pages editor can manage About / Privacy / Terms / DPA
-- consistently. Content is a placeholder — editors will refine via the UI.
-- =============================================================

INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.pages',  'admin', 'Pages editor', 'แก้ไขหน้าสถิต', 'Static page CRUD (About / Privacy / Terms / DPA / custom)', true, false, 78)
ON CONFLICT (key) DO NOTHING;

INSERT INTO pages (slug, title, body_md, seo_title, seo_description, is_published) VALUES
('dpa',
 '{"en":"Data Processing Agreement","th":"ข้อตกลงการประมวลผลข้อมูล"}'::jsonb,
 '{"en":"","th":""}'::jsonb,
 '{"en":"Data Processing Agreement — F2 Co., Ltd.","th":"ข้อตกลงการประมวลผลข้อมูล — F2 Co., Ltd."}'::jsonb,
 '{"en":"F2 Co., Ltd. Data Processing Agreement template for customers who need PDPA / GDPR compliant terms.","th":"เอกสารข้อตกลงการประมวลผลข้อมูลของ F2 Co., Ltd. สำหรับลูกค้าที่ต้องการเงื่อนไขตามมาตรฐาน PDPA / GDPR"}'::jsonb,
 TRUE)
ON CONFLICT (slug) DO NOTHING;
