-- =============================================================
-- 033_home_page_content.sql
-- Make the landing page hero + static copy blocks editable from
-- /admin/home-content, and register admin CRUD toggles for the
-- existing services + case_studies tables which now get UI too.
-- =============================================================

-- ─────────────────────────────────────────────
-- 1. home_page_content — key/value store, one row per copy block
--    key mirrors the i18n key path (e.g. 'hero.headline').
--    value is a bilingual JSONB object: {"en": "...", "th": "..."}.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS home_page_content (
    key         TEXT        PRIMARY KEY,
    value       JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE OR REPLACE TRIGGER set_home_page_content_updated_at
    BEFORE UPDATE ON home_page_content
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed with the current EN + TH copy from messages/*.json so the site
-- renders identically before/after this migration.
INSERT INTO home_page_content (key, value) VALUES
('hero.badge',          '{"en":"10+ years · Luxury hospitality IT","th":"ประสบการณ์ 10+ ปี · ไอทีสำหรับโรงแรมหรู"}'::jsonb),
('hero.headline',       '{"en":"Thailand''s trusted IT partner for luxury hotels, villas, and resorts.","th":"พันธมิตรไอทีที่โรงแรม วิลล่า และรีสอร์ทหรูในไทยไว้วางใจ"}'::jsonb),
('hero.subhead',        '{"en":"From SALA Hospitality''s 8 properties to Miskawaan''s ultra-luxury villas and Putahracsa Hua Hin — F2 designs, deploys, and operates the technology that keeps award-winning properties running.","th":"จาก 8 อสังหาริมทรัพย์ของ SALA Hospitality สู่วิลล่าระดับอัลตราหรูของ Miskawaan และ Putahracsa Hua Hin — F2 ออกแบบ ติดตั้ง และดูแลเทคโนโลยีที่ทำให้โรงแรมระดับรางวัลดำเนินงานได้อย่างไร้รอยต่อ"}'::jsonb),
('hero.ctaPrimary',     '{"en":"Talk to F2","th":"ติดต่อ F2"}'::jsonb),
('hero.ctaSecondary',   '{"en":"See client results","th":"ดูผลงานลูกค้า"}'::jsonb),
('hero.trust.kohSamui', '{"en":"Koh Samui HQ · nationwide remote","th":"สำนักงานใหญ่เกาะสมุย · บริการระยะไกลทั่วประเทศ"}'::jsonb),
('hero.trust.sameDay',  '{"en":"Same-day Samui on-site","th":"บริการถึงพื้นที่สมุยภายในวันเดียว"}'::jsonb),
('hero.trust.partners', '{"en":"ResellerClub · SiS · Microsoft","th":"ResellerClub · SiS · Microsoft"}'::jsonb),
('services.kicker',     '{"en":"What we do","th":"เราทำอะไร"}'::jsonb),
('services.title',      '{"en":"Hospitality-grade IT, end to end","th":"ไอทีระดับโรงแรมหรู ครบจบในที่เดียว"}'::jsonb),
('services.all8',       '{"en":"All 8 services","th":"ดูบริการทั้ง 8"}'::jsonb),
('trustedBy.title',     '{"en":"Trusted by Thailand''s leading luxury hospitality groups","th":"เป็นที่ไว้วางใจของกลุ่มโรงแรมหรูชั้นนำในประเทศไทย"}'::jsonb),
('cta.title',           '{"en":"Bring F2 onto your property team.","th":"ให้ F2 เป็นทีมไอทีของโรงแรมคุณ"}'::jsonb),
('cta.subtitle',        '{"en":"Tell us about your property — we''ll come back with a tailored proposal within one business day.","th":"บอกเราเกี่ยวกับอสังหาริมทรัพย์ของคุณ — เราจะกลับมาพร้อมข้อเสนอเฉพาะตัวภายในหนึ่งวันทำการ"}'::jsonb),
('cta.button',          '{"en":"Start the conversation","th":"เริ่มพูดคุย"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 2. Register admin module toggles for the three new CRUD screens
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.home_content',  'admin', 'Home page editor',   'แก้ไขหน้าแรก',            'Landing page hero + copy editor',           true, false, 75),
('admin.services',      'admin', 'Services editor',    'แก้ไขบริการ',              'Service catalogue CRUD',                    true, false, 76),
('admin.case_studies',  'admin', 'Case studies editor','แก้ไขกรณีศึกษา',           'Case study CRUD',                           true, false, 77)
ON CONFLICT (key) DO NOTHING;
