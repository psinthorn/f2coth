-- =============================================================
-- 048_service_module_library.sql
-- Expands the services catalogue into a proper module library so
-- customers.services_used can point at the specific thing F2 delivers
-- (DNS, web hosting, business email, Google Workspace, Microsoft 365,
-- website development) instead of the single "domain-hosting" umbrella.
--
-- Category + sort_order layout after this migration:
--   core          10  it-management
--                 20  digital-transformation
--                 30  ai-driven-solutions
--                 35  website-development         (new)
--                 40  domain-hosting              (kept as umbrella)
--                 41  dns-management              (new)
--                 42  web-hosting                 (new)
--                 43  business-email              (new)
--                 44  google-workspace            (new)
--                 45  microsoft-365               (new)
--                 50  iacc-saas
--   support       60  it-support-msp
--                 70  cybersecurity
--   opportunistic 80  hardware-solar
--
-- New services default to is_published=FALSE — they exist in the DB
-- so admin + customer records can reference them, but stay off the
-- public /services page until SEO + Copywriter finalise the marketing
-- copy (per CLAUDE.md convention). Admin publishes each one from
-- /admin/services once the content is signed off.
--
-- Also re-tags the 6 managed clients from migration 045 (+ SALA) with
-- the more precise slugs so /admin/customers, /clients showcase, and
-- the trusted-by strip surface the true service mix.
-- =============================================================

-- ---------- 1. Seed the new service modules ----------
INSERT INTO services (slug, title, short_summary, description, icon, category, sort_order, is_published)
VALUES

('website-development',
 '{"en":"Website Design & Development","th":"ออกแบบและพัฒนาเว็บไซต์"}'::jsonb,
 '{"en":"Custom hospitality websites — pool villas, tour operators, restaurants — with the booking flows and languages your guests expect.","th":"เว็บไซต์เฉพาะทางสำหรับธุรกิจโรงแรม — พูลวิลล่า ทัวร์โอเปอเรเตอร์ ร้านอาหาร — พร้อมระบบจองและภาษาที่แขกต้องการ"}'::jsonb,
 '{"en":"F2 designs and builds websites that convert lookers into guests. Multilingual by default (EN + TH minimum), integrated with your PMS or booking engine, hosted on cPanel-ready infrastructure with SSL and daily backups. Typical delivery six to ten weeks depending on scope.","th":"F2 ออกแบบและสร้างเว็บไซต์ที่เปลี่ยนผู้ชมให้กลายเป็นแขก รองรับหลายภาษาตั้งแต่วันแรก (EN + TH เป็นอย่างน้อย) เชื่อมต่อกับ PMS หรือ booking engine ของคุณ โฮสต์บนโครงสร้าง cPanel พร้อม SSL และ backup รายวัน ระยะเวลาส่งมอบทั่วไป 6 ถึง 10 สัปดาห์"}'::jsonb,
 'Palette', 'core', 35, FALSE),

('dns-management',
 '{"en":"DNS Management","th":"บริหารจัดการ DNS"}'::jsonb,
 '{"en":"Managed authoritative DNS — record changes handled by F2, no delays, no locked-out portals.","th":"บริการ DNS แบบ managed — F2 ดูแลการแก้ไข record ให้ ไม่ต้องรอ ไม่ต้องล็อกอินพอร์ทัลเอง"}'::jsonb,
 '{"en":"F2 hosts and manages your zone files. Add an A record, swap a mail exchanger, prove a domain to Google Workspace — email us and it is live within one business hour on Samui, same business day nationwide. Backed by ResellerClub and Cloudflare anycast networks so global lookups stay fast.","th":"F2 โฮสต์และบริหารจัดการ zone file ของคุณ เพิ่ม A record เปลี่ยน mail exchanger ยืนยันโดเมนกับ Google Workspace — อีเมลมาหาเรา ทำงานเสร็จภายใน 1 ชั่วโมงทำการที่เกาะสมุย ภายในวันเดียวทั่วประเทศ ใช้เครือข่าย anycast ของ ResellerClub และ Cloudflare เพื่อให้การ lookup ทั่วโลกยังเร็ว"}'::jsonb,
 'Network', 'core', 41, FALSE),

('web-hosting',
 '{"en":"Web Hosting","th":"เว็บโฮสติ้ง"}'::jsonb,
 '{"en":"Managed cPanel hosting tuned for hospitality websites — SSL, daily backups, and one contact for every issue.","th":"บริการ cPanel hosting แบบ managed สำหรับเว็บไซต์โรงแรม — SSL, backup รายวัน, ติดต่อผู้ดูแลได้ที่จุดเดียว"}'::jsonb,
 '{"en":"Reliable hosting for WordPress, static sites, and PHP applications. High-uptime infrastructure in Singapore (low latency to Thailand), daily backups with 14-day retention, Let''s Encrypt SSL included, and F2 handles software upgrades plus security patching so you never see a downtime notification.","th":"บริการโฮสติ้งสำหรับ WordPress, static site และแอปพลิเคชัน PHP โครงสร้างพื้นฐาน uptime สูงในสิงคโปร์ (ใกล้ประเทศไทย) backup รายวันเก็บ 14 วัน มี Let''s Encrypt SSL ให้ และ F2 ดูแล upgrade ซอฟต์แวร์และ security patch ให้ คุณจะไม่ต้องเห็นการแจ้ง downtime"}'::jsonb,
 'Server', 'core', 42, FALSE),

('business-email',
 '{"en":"Business Email","th":"อีเมลธุรกิจ"}'::jsonb,
 '{"en":"Professional email on your own domain — with the anti-spam and mobile setup already handled.","th":"อีเมลมืออาชีพบนโดเมนของคุณเอง — พร้อมระบบกรองสแปมและตั้งค่ามือถือให้เรียบร้อย"}'::jsonb,
 '{"en":"Email hosting for teams that need reliable @yourbrand.com addresses without moving to Google or Microsoft. SPF, DKIM, and DMARC records configured for deliverability, Roundcube webmail, IMAP/SMTP on all desktop and mobile clients, and F2 configures each new device you bring on.","th":"บริการโฮสต์อีเมลสำหรับทีมที่ต้องการอีเมล @yourbrand.com ที่เชื่อถือได้ โดยไม่ต้องย้ายไปใช้ Google หรือ Microsoft ตั้งค่า SPF, DKIM และ DMARC เพื่อการส่งอีเมลถึงปลายทางแน่นอน ใช้ Roundcube webmail และ IMAP/SMTP ได้บนทุก client ทั้งเดสก์ท็อปและมือถือ และ F2 จะช่วยตั้งค่าอุปกรณ์ใหม่ทุกเครื่องที่คุณเพิ่ม"}'::jsonb,
 'Mail', 'core', 43, FALSE),

('google-workspace',
 '{"en":"Google Workspace","th":"Google Workspace"}'::jsonb,
 '{"en":"Google Workspace administration by F2 — licences, MDM, and offboarding without the console overwhelm.","th":"บริหาร Google Workspace โดย F2 — จัดการ license, MDM และ offboarding โดยไม่ต้องปวดหัวกับ console"}'::jsonb,
 '{"en":"F2 sets up Google Workspace for your property, migrates existing email if you have any, configures MX, SPF, DKIM, and DMARC, sets shared drives and calendar policies, and manages licences as you hire and offboard. On tap for any how-do-I question your GM has.","th":"F2 ตั้งค่า Google Workspace ให้กิจการของคุณ ย้ายอีเมลเดิมถ้ามี ตั้งค่า MX, SPF, DKIM และ DMARC สร้าง shared drive และ calendar policy พร้อมบริหาร license เมื่อคุณจ้างใหม่หรือแยกทางกับพนักงาน มีทีมพร้อมตอบคำถามการใช้งานจาก GM ของคุณตลอด"}'::jsonb,
 'Chrome', 'core', 44, FALSE),

('microsoft-365',
 '{"en":"Microsoft 365","th":"Microsoft 365"}'::jsonb,
 '{"en":"Microsoft 365 licences, tenant setup, and admin under F2''s Microsoft partner services.","th":"บริการ Microsoft 365 — license, ตั้งค่า tenant และดูแลผู้ดูแลระบบภายใต้ F2 Microsoft partner services"}'::jsonb,
 '{"en":"F2 is a Microsoft partner — we resell M365 licences at competitive local pricing, set up the tenant (Azure AD, MFA, conditional access, Exchange Online), and provide ongoing administration. Preferred by properties standardised on Outlook, Teams, and SharePoint.","th":"F2 เป็น Microsoft partner — จำหน่าย license M365 ในราคาแข่งขันได้ในประเทศ ตั้งค่า tenant (Azure AD, MFA, conditional access, Exchange Online) และดูแลผู้ดูแลระบบต่อเนื่อง เหมาะสำหรับกิจการที่ใช้ Outlook, Teams และ SharePoint เป็นมาตรฐาน"}'::jsonb,
 'Building2', 'core', 45, FALSE)

ON CONFLICT (slug) DO NOTHING;


-- ---------- 2. Re-tag customers with the specific service slugs ----------
-- Idempotent by setting arrays literally rather than appending. Only touches
-- the customers I just added (045) + SALA (existing case study). Other
-- customers are left as-is because they were tagged deliberately.

UPDATE customers SET services_used = ARRAY['domain-hosting','dns-management']
    WHERE slug = 'library-koh-samui';

UPDATE customers SET services_used = ARRAY['domain-hosting','dns-management','website-development']
    WHERE slug = 'diamond-pool-villas-samui';

UPDATE customers SET services_used = ARRAY['domain-hosting','dns-management']
    WHERE slug = 'theatre-residence';

UPDATE customers SET services_used = ARRAY['business-email']
    WHERE slug = 'samui-natien';

UPDATE customers SET services_used = ARRAY['domain-hosting','dns-management','web-hosting']
    WHERE slug = 'samui-arena';

UPDATE customers SET services_used = ARRAY['domain-hosting','dns-management','google-workspace']
    WHERE slug = 'jm-asia';

-- SALA's existing services_used was ['domain-hosting'] — enrich with the
-- DNS service they actually consume (per docs/case-studies/sala.md).
UPDATE customers SET services_used = ARRAY['domain-hosting','dns-management']
    WHERE slug = 'sala-hospitality'
      AND NOT ('dns-management' = ANY(services_used));
