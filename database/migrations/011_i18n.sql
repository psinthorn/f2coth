-- =============================================================
-- 011_i18n.sql
-- Phase 3B — Convert translatable text fields on services / case_studies /
-- blog_posts / pages to JSONB, backfill `{en: <existing>}`, then add Thai.
-- See docs/MULTILINGUAL.md.
--
-- Pattern per column:
--   1. Add ${name}_i18n JSONB DEFAULT '{}'::jsonb
--   2. Backfill jsonb_build_object('en', old_text)
--   3. Set NOT NULL + CHECK (? 'en')
--   4. Drop old TEXT column
--   5. Rename ${name}_i18n -> ${name}
-- =============================================================

-- Drop search indexes that reference soon-to-be-replaced columns.
DROP INDEX IF EXISTS idx_case_studies_search;
DROP INDEX IF EXISTS idx_blog_posts_search;

-- ---------- services ----------
ALTER TABLE services ADD COLUMN IF NOT EXISTS title_i18n         JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS short_summary_i18n JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE services ADD COLUMN IF NOT EXISTS description_i18n   JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE services SET
    title_i18n         = jsonb_build_object('en', title),
    short_summary_i18n = jsonb_build_object('en', short_summary),
    description_i18n   = jsonb_build_object('en', description)
WHERE title_i18n = '{}'::jsonb;

ALTER TABLE services ADD CONSTRAINT services_title_has_en         CHECK (title_i18n ? 'en');
ALTER TABLE services ADD CONSTRAINT services_short_summary_has_en CHECK (short_summary_i18n ? 'en');
ALTER TABLE services ADD CONSTRAINT services_description_has_en   CHECK (description_i18n ? 'en');

ALTER TABLE services DROP COLUMN title;
ALTER TABLE services DROP COLUMN short_summary;
ALTER TABLE services DROP COLUMN description;
ALTER TABLE services RENAME COLUMN title_i18n         TO title;
ALTER TABLE services RENAME COLUMN short_summary_i18n TO short_summary;
ALTER TABLE services RENAME COLUMN description_i18n   TO description;

-- ---------- case_studies ----------
ALTER TABLE case_studies ADD COLUMN IF NOT EXISTS summary_i18n     JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE case_studies ADD COLUMN IF NOT EXISTS challenge_i18n   JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE case_studies ADD COLUMN IF NOT EXISTS solution_i18n    JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE case_studies ADD COLUMN IF NOT EXISTS results_i18n     JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE case_studies ADD COLUMN IF NOT EXISTS quote_text_i18n  JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE case_studies SET
    summary_i18n    = jsonb_build_object('en', summary),
    challenge_i18n  = jsonb_build_object('en', challenge),
    solution_i18n   = jsonb_build_object('en', solution),
    results_i18n    = jsonb_build_object('en', results),
    quote_text_i18n = CASE WHEN quote_text IS NULL THEN '{}'::jsonb
                            ELSE jsonb_build_object('en', quote_text) END
WHERE summary_i18n = '{}'::jsonb;

ALTER TABLE case_studies ADD CONSTRAINT case_studies_summary_has_en   CHECK (summary_i18n ? 'en');
ALTER TABLE case_studies ADD CONSTRAINT case_studies_challenge_has_en CHECK (challenge_i18n ? 'en');
ALTER TABLE case_studies ADD CONSTRAINT case_studies_solution_has_en  CHECK (solution_i18n ? 'en');
ALTER TABLE case_studies ADD CONSTRAINT case_studies_results_has_en   CHECK (results_i18n ? 'en');
-- quote_text is optional; either {} or has en.

ALTER TABLE case_studies DROP COLUMN summary;
ALTER TABLE case_studies DROP COLUMN challenge;
ALTER TABLE case_studies DROP COLUMN solution;
ALTER TABLE case_studies DROP COLUMN results;
ALTER TABLE case_studies DROP COLUMN quote_text;
ALTER TABLE case_studies RENAME COLUMN summary_i18n    TO summary;
ALTER TABLE case_studies RENAME COLUMN challenge_i18n  TO challenge;
ALTER TABLE case_studies RENAME COLUMN solution_i18n   TO solution;
ALTER TABLE case_studies RENAME COLUMN results_i18n    TO results;
ALTER TABLE case_studies RENAME COLUMN quote_text_i18n TO quote_text;

-- ---------- blog_posts ----------
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS title_i18n   JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS excerpt_i18n JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS body_md_i18n JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE blog_posts SET
    title_i18n   = jsonb_build_object('en', title),
    excerpt_i18n = jsonb_build_object('en', excerpt),
    body_md_i18n = jsonb_build_object('en', body_md)
WHERE title_i18n = '{}'::jsonb;

ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_title_has_en   CHECK (title_i18n ? 'en');
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_excerpt_has_en CHECK (excerpt_i18n ? 'en');
ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_body_md_has_en CHECK (body_md_i18n ? 'en');

ALTER TABLE blog_posts DROP COLUMN title;
ALTER TABLE blog_posts DROP COLUMN excerpt;
ALTER TABLE blog_posts DROP COLUMN body_md;
ALTER TABLE blog_posts RENAME COLUMN title_i18n   TO title;
ALTER TABLE blog_posts RENAME COLUMN excerpt_i18n TO excerpt;
ALTER TABLE blog_posts RENAME COLUMN body_md_i18n TO body_md;

-- ---------- pages ----------
ALTER TABLE pages ADD COLUMN IF NOT EXISTS title_i18n           JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS body_md_i18n         JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS seo_title_i18n       JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS seo_description_i18n JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE pages SET
    title_i18n           = jsonb_build_object('en', title),
    body_md_i18n         = jsonb_build_object('en', body_md),
    seo_title_i18n       = CASE WHEN seo_title       IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('en', seo_title)       END,
    seo_description_i18n = CASE WHEN seo_description IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('en', seo_description) END
WHERE title_i18n = '{}'::jsonb;

ALTER TABLE pages ADD CONSTRAINT pages_title_has_en   CHECK (title_i18n ? 'en');
ALTER TABLE pages ADD CONSTRAINT pages_body_md_has_en CHECK (body_md_i18n ? 'en');

ALTER TABLE pages DROP COLUMN title;
ALTER TABLE pages DROP COLUMN body_md;
ALTER TABLE pages DROP COLUMN seo_title;
ALTER TABLE pages DROP COLUMN seo_description;
ALTER TABLE pages RENAME COLUMN title_i18n           TO title;
ALTER TABLE pages RENAME COLUMN body_md_i18n         TO body_md;
ALTER TABLE pages RENAME COLUMN seo_title_i18n       TO seo_title;
ALTER TABLE pages RENAME COLUMN seo_description_i18n TO seo_description;

-- ---------- Rebuild search indexes covering both locales ----------
CREATE INDEX IF NOT EXISTS idx_case_studies_search ON case_studies
    USING GIN (to_tsvector('simple',
        coalesce(client_name, '')                          || ' ' ||
        coalesce(summary    ->> 'en', '')   || ' ' ||
        coalesce(summary    ->> 'th', '')   || ' ' ||
        coalesce(challenge  ->> 'en', '')   || ' ' ||
        coalesce(challenge  ->> 'th', '')   || ' ' ||
        coalesce(solution   ->> 'en', '')   || ' ' ||
        coalesce(solution   ->> 'th', '')   || ' ' ||
        coalesce(results    ->> 'en', '')   || ' ' ||
        coalesce(results    ->> 'th', '')));

CREATE INDEX IF NOT EXISTS idx_blog_posts_search ON blog_posts
    USING GIN (to_tsvector('simple',
        coalesce(title   ->> 'en', '') || ' ' ||
        coalesce(title   ->> 'th', '') || ' ' ||
        coalesce(excerpt ->> 'en', '') || ' ' ||
        coalesce(excerpt ->> 'th', '') || ' ' ||
        coalesce(body_md ->> 'en', '') || ' ' ||
        coalesce(body_md ->> 'th', '')));

-- ---------- Thai translations ----------
-- These are Claude drafts; F2 should review and refine.

-- ----- services -----
UPDATE services SET
    title         = title         || jsonb_build_object('th', 'พันธมิตรด้านการจัดการระบบไอที'),
    short_summary = short_summary || jsonb_build_object('th', 'บริหารจัดการระบบไอทีแบบครบวงจรสำหรับโรงแรม วิลล่า และรีสอร์ท — จุดติดต่อเดียว มาตรฐาน SLA ระดับโรงแรมหรู'),
    description   = description   || jsonb_build_object('th', 'F2 ทำหน้าที่เป็นแผนกไอทีในองค์กรของคุณ เราออกแบบ ติดตั้ง ตรวจสอบ และดูแลทุกชั้นของเทคโนโลยีในอสังหาริมทรัพย์ของคุณ — ตั้งแต่สายเคเบิลในผนังจนถึงแอปบนมือถือของแขก ให้บริการถึงพื้นที่ภายในวันเดียวบนเกาะสมุย และดูแลแบบรีโมตเป็นหลักทั่วประเทศไทย')
WHERE slug = 'it-management';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'ทรานส์ฟอร์เมชันดิจิทัล'),
    short_summary = short_summary || jsonb_build_object('th', 'แผนงานและการดำเนินการเพื่อยกระดับการปฏิบัติงานในโรงแรม ประสบการณ์แขก และระบบหลังบ้าน'),
    description   = description   || jsonb_build_object('th', 'เราประเมินระบบที่คุณมี ระบุการเปลี่ยนแปลงที่ให้ผลตอบแทนสูงสุด แล้วลงมือสร้างจริง โครงการทั่วไป: ปรับ PMS เช็คอินไร้สัมผัส ลด F&B ไร้กระดาษ การสำรองห้องพักด้วย AI')
WHERE slug = 'digital-transformation';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'โซลูชันที่ขับเคลื่อนด้วย AI'),
    short_summary = short_summary || jsonb_build_object('th', 'AI ที่ใช้งานได้จริงสำหรับโรงแรม — แชทคอนเซียร์จ จัดการข้อความสอบถาม โคไพล็อตการปฏิบัติงาน'),
    description   = description   || jsonb_build_object('th', 'F2 สร้างและดูแล workflow ของ AI ที่เข้ากับน้ำเสียงแบรนด์ของคุณ ขับเคลื่อนด้วย Anthropic Claude และ OpenAI เชื่อมต่อกับ PMS เครื่องมือจอง และ CRM ของคุณ เน้นผลลัพธ์ ไม่เน้นกระแส')
WHERE slug = 'ai-driven-solutions';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'โดเมนและโฮสติ้ง'),
    short_summary = short_summary || jsonb_build_object('th', 'จดทะเบียนโดเมนและโฮสติ้งที่เชื่อถือได้ผ่านพาร์ทเนอร์ ResellerClub'),
    description   = description   || jsonb_build_object('th', 'บริหารโดเมน .com, .co.th และโดเมนเฉพาะประเทศแบบครบวงจร พร้อมโฮสติ้งที่ปรับมาเพื่อเว็บไซต์โรงแรมและระบบจองห้องพัก ดูแล DNS, SSL และอีเมลให้คุณ')
WHERE slug = 'domain-hosting';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'iACC — SaaS สำหรับผู้ประกอบการทัวร์'),
    short_summary = short_summary || jsonb_build_object('th', 'แพลตฟอร์มบัญชีและบริหารงานหลายผู้ใช้สำหรับผู้ประกอบการทัวร์และตัวแทนท่องเที่ยว'),
    description   = description   || jsonb_build_object('th', 'iACC เป็นผลิตภัณฑ์ SaaS ของ F2 เอง: การจอง ชำระเงิน ตัวแทน อัลโลตเมนต์ รถ — ทุกอย่างในที่เดียว ใช้งานบนมือถือได้ พร้อมรองรับโฮสติ้ง cPanel เยี่ยมชม iacc.f2.co.th')
WHERE slug = 'iacc-saas';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'บริการ MSP และดูแลระบบไอที'),
    short_summary = short_summary || jsonb_build_object('th', 'ตรวจสอบ 24/7, helpdesk และบริการจัดการระบบสำหรับโรงแรมหลายสาขา'),
    description   = description   || jsonb_build_object('th', 'เราดูแลระบบของคุณให้ทำงานต่อเนื่อง helpdesk การตรวจสอบ การ patch สำรองข้อมูล จัดการเวนเดอร์ มีระดับ SLA ตั้งแต่เวลาทำการจนถึงบริการระดับ premium 24/7')
WHERE slug = 'it-support-msp';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'ความปลอดภัยไซเบอร์'),
    short_summary = short_summary || jsonb_build_object('th', 'ไฟร์วอลล์ ตรวจจับการบุกรุก แยกเครือข่ายสำหรับแขก CCTV และเสริมความแข็งแกร่ง POS ตามมาตรฐาน PCI'),
    description   = description   || jsonb_build_object('th', 'อุตสาหกรรมโรงแรมเป็นเป้าหมายมูลค่าสูง เราติดตั้งและดูแลมาตรการรักษาความปลอดภัยที่บริษัทประกันและมาตรฐานแบรนด์ของคุณคาดหวัง — โดยไม่ทำให้ WiFi ของแขกรู้สึกเหมือน VPN ระดับองค์กร')
WHERE slug = 'cybersecurity';

UPDATE services SET
    title         = title         || jsonb_build_object('th', 'ฮาร์ดแวร์และโซลาร์ (สมุย)'),
    short_summary = short_summary || jsonb_build_object('th', 'ฮาร์ดแวร์ไอทีผ่าน SiS Distribution พร้อมติดตั้งโซลาร์เซลล์สำหรับลูกค้าบนเกาะสมุย'),
    description   = description   || jsonb_build_object('th', 'ผ่านพาร์ทเนอร์ SiS Distribution เราจัดหาอุปกรณ์ network ระดับองค์กร เซิร์ฟเวอร์ และ POS ในราคาผู้กระจายสินค้า บนเกาะสมุยเรายังให้บริการติดตั้งโซลาร์แบบครบวงจรสำหรับรีสอร์ทที่ต้องการลดค่าไฟฟ้า')
WHERE slug = 'hardware-solar';

-- ----- case_studies -----
UPDATE case_studies SET
    summary   = summary   || jsonb_build_object('th', 'หนึ่งทศวรรษของการดูแลโดเมนและความเป็นส่วนตัวของโดเมนสำหรับ 8 อสังหาริมทรัพย์หรูของ SALA งานเล็ก ๆ น้อย ๆ ที่ต้องไว้วางใจสูง ไม่เคยพลาด'),
    challenge = challenge || jsonb_build_object('th', '8 อสังหาริมทรัพย์หรูของ SALA — สมุย ภูเก็ต กรุงเทพ อยุธยา เขาใหญ่ — ดำเนินงานในฐานะแบรนด์ระดับโลกที่ได้รับการยอมรับ (Condé Nast, DestinAsian) แปดอสังหาริมทรัพย์หมายถึงโดเมนจำนวนมาก: เว็บไซต์แบรนด์หลัก แบรนด์ย่อย TLD เฉพาะประเทศ และชื่อโดเมนเชิงป้องกัน แบรนด์ระดับรางวัลต้องการความถูกต้องของโดเมนที่ไร้ที่ติ: ไม่มีการจดทะเบียนหมดอายุ ไม่มี DNS ที่ผิดพลาด ไม่มีข้อมูลผู้จดทะเบียนที่เปิดเผยและเชิญชวนสแปม'),
    solution  = solution  || jsonb_build_object('th', 'F2 ดูแลพอร์ตโฟลิโอโดเมนทั้งหมดของ SALA ผ่านพาร์ทเนอร์ ResellerClub: การจดทะเบียนและต่ออายุ การโฮสต์และตั้งค่า DNS และ Domain Privacy / WhoisGuard บนทุกชื่อโดเมนเพื่อปกปิดข้อมูลผู้จดทะเบียน ออกใบแจ้งหนี้รวมเป็นเงินบาทไทย จุดติดต่อเดียวสำหรับทุกการดำเนินการเกี่ยวกับโดเมน'),
    results   = results   || jsonb_build_object('th', 'ปัญหาที่เกี่ยวกับโดเมนเป็นศูนย์ในระยะเวลาความสัมพันธ์ 10+ ปี ทุกโดเมนของ SALA ได้รับการปกป้องด้วย Domain Privacy ไม่เคยพลาดการต่ออายุ การออกใบแจ้งหนี้รวมทำให้การจัดการเวนเดอร์ของ SALA ง่ายขึ้น — PO เดียวครอบคลุมการดำเนินการโดเมนทั้งหมด')
WHERE slug = 'sala-hospitality';

UPDATE case_studies SET
    summary   = summary   || jsonb_build_object('th', 'รีสอร์ทบูทีคในเครือ Five Star Alliance 67 ห้อง ร้านอาหารหลายร้าน ดูแลแบบรีโมตจากกรุงเทพและสมุย'),
    challenge = challenge || jsonb_build_object('th', 'โรงแรมบูทีคที่เน้นการออกแบบ ที่เทคโนโลยีต้องไม่ปรากฏให้แขกเห็นแต่ต้องเชื่อถือได้สำหรับการปฏิบัติงาน ร้าน F&B หลายร้านต้องการระบบ POS ที่เชื่อมต่อกัน ตั้งอยู่ห่างจากกรุงเทพ 200 กม. ที่ความเชี่ยวชาญด้านไอทีในท้องถิ่นมีจำกัด'),
    solution  = solution  || jsonb_build_object('th', 'การปฏิบัติงานไอทีทั้งหมดดูแลแบบรีโมตจากกรุงเทพ/สมุย: ระบบ POS เชื่อมต่อกับ 3 ร้าน F&B และสปา WiFi ครอบคลุมทั้งโรงแรม Microsoft 365 โดเมนและโฮสติ้ง พร้อมการเข้าพื้นที่เมื่อจำเป็น ฮาร์ดแวร์จัดหาผ่าน SiS'),
    results   = results   || jsonb_build_object('th', 'การปฏิบัติงานราบรื่นทั่วทุกร้าน 10+ ปี ไม่เปลี่ยนเวนเดอร์ มาตรฐาน Five Star Alliance ดำรงไว้ พิสูจน์ว่าโมเดลการบริหารแบบรีโมตของ F2 ทำงานได้นอกพื้นที่เกาะสมุย — เปิดทางสู่หัวหิน ปราณบุรี และเส้นทางอ่าวไทย')
WHERE slug = 'putahracsa-hua-hin';

UPDATE case_studies SET
    summary   = summary   || jsonb_build_object('th', 'ลูกค้ารายใหม่สุดของ F2 บริการ Microsoft 365 administration ภายใต้ SLA หนึ่งปี — มีนาคม 2026 ถึง มีนาคม 2027 — สำหรับทีมงานเบื้องหลังที่พักประเภท specialty อันดับ 1 ของเกาะสมุยใน TripAdvisor'),
    challenge = challenge || jsonb_build_object('th', 'ทีมที่กำลังเติบโตของ Miskawaan ต้องการการดูแล Microsoft 365 อย่างเหมาะสม — การสร้างผู้ใช้ กล่องจดหมาย นโยบายความปลอดภัย และการจัดการ license — ให้พาร์ทเนอร์ที่มีประสบการณ์ดูแล แทนที่จะเป็นงานพ่วงของพนักงานในองค์กรที่งานล้น ในฐานะที่พัก specialty อันดับ 1 บนเกาะสมุยใน TripAdvisor แบรนด์รับไม่ได้กับผลกระทบจากอีเมลล่ม บัญชีผู้บริหารถูกแฮ็ก หรือปัญหา license ที่ขัดจังหวะการให้บริการแขกในช่วงเวลาสำคัญ'),
    solution  = solution  || jsonb_build_object('th', 'F2 รับช่วงดูแล Microsoft 365 administration ภายใต้ SLA หนึ่งปี ดำเนินงาน มีนาคม 2026 – มีนาคม 2027 ขอบเขต: ดูแล tenant วงจรชีวิตผู้ใช้ทั้งหมด (เข้า/ย้าย/ออก) ตั้งค่ากล่องจดหมายและทรัพยากรร่วม Conditional Access และบังคับใช้ MFA เพิ่มประสิทธิภาพ license ในแผน M365 ต่าง ๆ helpdesk สำหรับคำถาม M365 ของพนักงาน และการตรวจสอบ compliance รายไตรมาส ตอบสนองตามเวลา SLA'),
    results   = results   || jsonb_build_object('th', 'SLA ดำเนินอยู่ตั้งแต่ มีนาคม 2026 ถึง มีนาคม 2027 รายงานผลการดำเนินงานต่อ SLA รายไตรมาส กำหนดทบทวนต่ออายุในเดือนมกราคม 2027')
WHERE slug = 'miskawaan-villas';

-- ----- pages -----
UPDATE pages SET
    title    = title || jsonb_build_object('th', 'เกี่ยวกับ F2 Co., Ltd.'),
    body_md  = body_md || jsonb_build_object('th',
        E'## พันธมิตรไอทีที่โรงแรมหรูในไทยไว้วางใจ\n\nF2 Co., Ltd. (เดิมชื่อ Nextgentechs Service & Support Co., Ltd.) เป็นบริษัทบริการไอทีของไทย มีสำนักงานใหญ่ในกรุงเทพและสาขาที่เกาะสมุย กว่าทศวรรษที่ผ่านมา เราดูแลโรงแรม วิลล่า และรีสอร์ทหรูทั่วประเทศไทย — รวมถึง SALA Hospitality, Miskawaan Beach Villas และ Putahracsa Hua Hin\n\nเราเป็นผู้ให้บริการไอทีที่จดทะเบียนและได้รับความไว้วางใจในวงการโรงแรมไทย พร้อมพาร์ทเนอร์ที่แน่นแฟ้นกับ ResellerClub (โดเมนและโฮสติ้ง), SiS Distribution (ฮาร์ดแวร์) และ Microsoft'),
    seo_title       = seo_title       || jsonb_build_object('th', 'เกี่ยวกับ F2 Co., Ltd. — ไอทีสำหรับโรงแรมในไทย'),
    seo_description = seo_description || jsonb_build_object('th', 'F2 Co., Ltd. คือพันธมิตรไอทีที่โรงแรมหรูในประเทศไทยไว้วางใจ มีสำนักงานในกรุงเทพและเกาะสมุย พร้อมความสัมพันธ์ลูกค้ากว่า 10 ปี')
WHERE slug = 'about';

UPDATE pages SET
    title   = title   || jsonb_build_object('th', 'นโยบายความเป็นส่วนตัว'),
    body_md = body_md || jsonb_build_object('th',
        E'F2 Co., Ltd. ให้ความสำคัญกับความเป็นส่วนตัวของคุณ หน้านี้อธิบายข้อมูลที่เราเก็บจากผู้เข้าชม f2.co.th และวิธีที่เราใช้ข้อมูลเหล่านั้น\n\nเราเก็บข้อความที่ส่งผ่านแบบฟอร์มติดต่อ ข้อมูลวิเคราะห์แบบไม่ระบุตัวตน และบันทึกการสนทนากับแชทบอท เฉพาะเพื่อตอบกลับข้อความและปรับปรุงบริการของเรา'),
    seo_title       = seo_title       || jsonb_build_object('th', 'นโยบายความเป็นส่วนตัว — F2 Co., Ltd.'),
    seo_description = seo_description || jsonb_build_object('th', 'F2 Co., Ltd. เก็บ ใช้ และปกป้องข้อมูลของผู้เข้าชม f2.co.th อย่างไร')
WHERE slug = 'privacy';

UPDATE pages SET
    title   = title   || jsonb_build_object('th', 'ข้อกำหนดการใช้งาน'),
    body_md = body_md || jsonb_build_object('th',
        E'ข้อกำหนดเหล่านี้ใช้บังคับกับการใช้งาน f2.co.th เมื่อใช้งานเว็บไซต์นี้ คุณตกลงที่จะใช้งานอย่างถูกกฎหมาย ไม่พยายามรบกวน reverse engineer หรือบุกรุกระบบ'),
    seo_title       = seo_title       || jsonb_build_object('th', 'ข้อกำหนดการใช้งาน — F2 Co., Ltd.'),
    seo_description = seo_description || jsonb_build_object('th', 'ข้อกำหนดการใช้งานสำหรับ f2.co.th')
WHERE slug = 'terms';
