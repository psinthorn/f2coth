-- =============================================================
-- 049_marketing_category_and_services.sql
-- Extends the services catalogue in two ways:
--
--   1) Adds a fourth category, `marketing`, for content + growth
--      services that don't fit core/support/opportunistic:
--          SEO/AEO/GEO copywriting, social media, digital marketing.
--      Widens the services.category CHECK constraint to include it.
--
--   2) Seeds six new service modules F2 actually delivers but that
--      the catalogue did not surface:
--          - domain-registration       (core   sort 46)
--          - domain-renewal            (core   sort 47)
--          - webapp-development        (core   sort 36)
--          - seo-aeo-geo-copywriting   (marketing sort 10)
--          - social-media-management   (marketing sort 20)
--          - digital-marketing         (marketing sort 30)
--
-- All new services default to is_published=FALSE — same rationale as
-- 048: they exist as internal reference modules; SEO + Copywriter
-- agents review and admin publishes each one from /admin/services.
-- =============================================================

-- ---------- 1. Extend the category CHECK ----------
-- Drop-then-add (rather than USING) so this migration remains
-- idempotent on re-run: the DROP form silently no-ops if the
-- constraint was already replaced by a prior run.
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_category_check;
ALTER TABLE services
    ADD CONSTRAINT services_category_check
    CHECK (category IN ('core','support','opportunistic','marketing'));

-- ---------- 2. Seed the 6 new service modules ----------
INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order, is_published)
VALUES

('domain-registration',
 '{"en":"Domain Name Registration","th":"จดโดเมนเนม"}'::jsonb,
 '{"en":"F2 registers .com, .co.th, and country-specific domains on your behalf — priced in Thai Baht, invoiced monthly.","th":"F2 จดโดเมน .com, .co.th และโดเมนประจำประเทศให้คุณ — คิดราคาเป็นบาทและออกใบแจ้งหนี้รายเดือน"}'::jsonb,
 '{"en":"F2 handles first-time domain purchases through our ResellerClub and THNIC partnerships. Consolidated Thai Baht billing (no foreign-currency surcharges), Domain Privacy included by default, and the domain lives under your ownership from day one. Typical turnaround: same business day for gTLDs, one to two days for .co.th and other ccTLDs that require registrant paperwork.","th":"F2 จัดการการซื้อโดเมนครั้งแรกผ่านพาร์ทเนอร์ ResellerClub และ THNIC ของเรา ออกใบแจ้งหนี้เป็นเงินบาทแบบรวมยอด (ไม่บวก surcharge ค่าเงินต่างประเทศ) มี Domain Privacy ให้เป็นค่าเริ่มต้น และโดเมนอยู่ในกรรมสิทธิ์ของคุณตั้งแต่วันแรก ระยะเวลาทั่วไป: gTLD ภายในวันทำการเดียวกัน ส่วน .co.th และ ccTLD อื่นที่ต้องยื่นเอกสารผู้จดใช้เวลา 1 ถึง 2 วัน"}'::jsonb,
 'Globe', 'core', 46, FALSE),

('domain-renewal',
 '{"en":"Domain Name Renewal","th":"ต่ออายุโดเมนเนม"}'::jsonb,
 '{"en":"F2 tracks every renewal date across your portfolio and never lets a name lapse — expiry alerts, auto-renewal, and consolidated Thai Baht invoicing.","th":"F2 ติดตามวันหมดอายุของทุกโดเมนในพอร์ตของคุณ ไม่มีทางหลุด — แจ้งเตือนล่วงหน้า auto-renewal และออกใบแจ้งหนี้เป็นเงินบาทแบบรวมยอด"}'::jsonb,
 '{"en":"For portfolios with more than a handful of domains, missed renewals are a real risk — someone leaves, credit cards expire, and a brand name goes dark. F2 monitors expiry across every name we manage, sends 90/60/30-day alerts, auto-renews on our account with your approval, and delivers a single Thai Baht invoice. Ten-plus years, zero missed renewals across our hospitality clients.","th":"สำหรับพอร์ตที่มีโดเมนหลายชื่อ การพลาดต่ออายุคือความเสี่ยงจริง — พนักงานลาออก บัตรเครดิตหมดอายุ แล้วชื่อแบรนด์ก็ดับ F2 monitor วันหมดอายุของทุกโดเมนที่เราดูแล ส่งเตือนล่วงหน้า 90/60/30 วัน ต่ออายุอัตโนมัติผ่านบัญชีของเราโดยขออนุมัติจากคุณ และส่งใบแจ้งหนี้เป็นเงินบาทฉบับเดียว 10 ปีขึ้นไป ยังไม่เคยพลาดต่ออายุสำหรับลูกค้าโรงแรมของเรา"}'::jsonb,
 'GitBranch', 'core', 47, FALSE),

('webapp-development',
 '{"en":"Web Application Development","th":"พัฒนาเว็บแอปพลิเคชัน"}'::jsonb,
 '{"en":"Custom web applications — portals, dashboards, booking engines, internal tools — built for hospitality workflows.","th":"เว็บแอปพลิเคชันเฉพาะทาง — พอร์ทัล แดชบอร์ด ระบบจอง เครื่องมือภายในองค์กร — สร้างให้ตรงกับกระบวนการของโรงแรม"}'::jsonb,
 '{"en":"Beyond marketing websites: F2 builds actual web applications. Next.js + Go microservices for staff portals, guest-facing booking engines, revenue dashboards, PMS integrations, and internal tools that replace spreadsheets. Same stack we use to run f2.co.th and iACC. Typical engagement: 3 to 6 months for a v1, then a maintenance retainer.","th":"เกินกว่าเว็บ marketing: F2 สร้างเว็บแอปพลิเคชันจริง Next.js + Go microservices สำหรับพอร์ทัลพนักงาน ระบบจองสำหรับแขก แดชบอร์ด revenue การเชื่อมต่อ PMS และเครื่องมือภายในที่มาแทน spreadsheet ใช้ stack เดียวกับที่เราใช้รัน f2.co.th และ iACC ระยะเวลาโครงการทั่วไป: 3 ถึง 6 เดือนสำหรับ v1 แล้วต่อสัญญา maintenance"}'::jsonb,
 'LayoutDashboard', 'core', 36, FALSE),

('seo-aeo-geo-copywriting',
 '{"en":"SEO / AEO / GEO Copywriting","th":"เขียนคอนเทนต์ SEO / AEO / GEO"}'::jsonb,
 '{"en":"Copywriting engineered for search + AI answer engines — Google (SEO), ChatGPT/Perplexity (AEO), and generative results (GEO).","th":"งานเขียนคอนเทนต์ที่ออกแบบสำหรับ search engine และ AI answer engine — Google (SEO), ChatGPT/Perplexity (AEO) และผลลัพธ์แบบ generative (GEO)"}'::jsonb,
 '{"en":"Search has splintered: Google still matters, but so do the AI answer engines (ChatGPT, Perplexity, Claude) that quote sources, and the generative results Google itself now shows. F2 writes copy structured for all three: bilingual (EN + TH), schema-marked, quotable, and evidence-linked. Ideal for hotel landing pages, service pages, blog posts, and knowledge bases.","th":"การค้นหาแตกออกเป็นหลายทาง: Google ยังสำคัญ แต่ AI answer engine (ChatGPT, Perplexity, Claude) ที่อ้างอิงแหล่งที่มา และผลลัพธ์ generative ที่ Google เองแสดงในตอนนี้ ก็สำคัญไม่แพ้กัน F2 เขียนคอนเทนต์ที่มีโครงสร้างเหมาะสำหรับทั้งสาม: สองภาษา (EN + TH) มี schema markup มีข้อความที่ยกไปอ้างได้ และเชื่อมโยงหลักฐาน เหมาะสำหรับ landing page โรงแรม หน้า service บทความ blog และ knowledge base"}'::jsonb,
 'Sparkles', 'marketing', 10, FALSE),

('social-media-management',
 '{"en":"Social Media Content & Management","th":"บริหารคอนเทนต์โซเชียลมีเดีย"}'::jsonb,
 '{"en":"Instagram, TikTok, Facebook content built for hospitality — planning, shooting, posting, and community reply.","th":"คอนเทนต์ Instagram, TikTok, Facebook สำหรับธุรกิจโรงแรม — วางแผน ถ่าย โพสต์ และตอบคอมมูนิตี้"}'::jsonb,
 '{"en":"F2 runs Instagram / TikTok / Facebook end-to-end: monthly content calendar, on-property shoots on Samui and Bangkok, edit + caption in EN + TH, scheduled posting, and community-management coverage (DM / comment reply). Aligned to your PMS occupancy so promos land when rooms are available.","th":"F2 ดูแล Instagram / TikTok / Facebook แบบครบวงจร: content calendar รายเดือน ถ่ายทำที่ property บนเกาะสมุยและกรุงเทพฯ ตัดต่อและเขียน caption ทั้ง EN + TH โพสต์ตามเวลา และดูแล community management (ตอบ DM / คอมเมนต์) จัดตรงกับ occupancy ของ PMS เพื่อให้โปรโมชันตรงกับช่วงที่ห้องว่าง"}'::jsonb,
 'Sparkles', 'marketing', 20, FALSE),

('digital-marketing',
 '{"en":"Digital Marketing","th":"ดิจิทัลมาร์เก็ตติ้ง"}'::jsonb,
 '{"en":"Paid media, funnels, and analytics — Google Ads, Meta Ads, retargeting, and the pixels + reporting that hold it all together.","th":"สื่อโฆษณา funnel และ analytics — Google Ads, Meta Ads, retargeting และ pixel + รายงานที่เชื่อมทุกอย่างเข้าด้วยกัน"}'::jsonb,
 '{"en":"F2 plans and runs paid campaigns for hospitality clients: Google Search + Performance Max, Meta prospecting + retargeting, and the analytics stack (GA4, Meta Pixel, Google Tag Manager, server-side tagging) that makes attribution honest. Monthly reports tied to actual bookings, not vanity impressions.","th":"F2 วางแผนและรันแคมเปญโฆษณาให้ลูกค้าโรงแรม: Google Search + Performance Max, Meta prospecting + retargeting และ analytics stack (GA4, Meta Pixel, Google Tag Manager, server-side tagging) ที่ทำให้การ attribution ตรงไปตรงมา รายงานรายเดือนอ้างอิงยอดจองจริง ไม่ใช่ตัวเลข impression ที่ดูดี"}'::jsonb,
 'LayoutDashboard', 'marketing', 30, FALSE)

ON CONFLICT (slug) DO NOTHING;
