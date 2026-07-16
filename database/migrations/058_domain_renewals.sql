-- 058_domain_renewals.sql
-- Phase 2 of recurring-renewal automation: the DOMAIN expiry engine.
--
-- Unlike subscriptions (billing-cycle driven, migration 057), domains are
-- EXPIRY-date driven off customer_domains.expires_at. The payment-api
-- scheduler now:
--   • sends advance expiry notices at configurable day tiers before
--     expiry (default 60 / 30 / 7), reusing renewal_reminders with
--     entity_type='domain';
--   • auto-generates a renewal invoice from domain_pricing.renew_price_thb
--     when a domain with auto_renew=true enters the invoice-lead window
--     (default 14 days out);
--   • sends a post-expiry "domain expired" notice (default 1 day after)
--     satisfying the ICANN "≥2 before + 1 after" reminder minimum;
--   • sends the billing team an internal heads-up once per cycle.
--
-- renewal_reminders sentinel offsets used for domains (see 057):
--   > 0  → a before-expiry customer notice tier (60 / 30 / 7)
--     0  → internal billing-team heads-up sent
--    -1  → renewal invoice generated (idempotency guard)
--    -2  → post-expiry "domain expired" notice sent
-- These reset automatically when staff update expires_at after renewing
-- at the registrar (due_date changes → fresh cycle).
--
-- No auto-charge: like WHMCS defaults, we notify + invoice; the customer
-- pays through the existing portal and staff push the new expiry date.
--
-- Next migration: 059_*.sql

BEGIN;

-- Domain renewal templates (EN + TH). Variables from the scheduler:
--   {{customer_name}} {{domain}} {{registrar}} {{expiry_date}}
--   {{days_until}} {{days_expired}} {{amount}} {{currency}}
--   {{portal_link}} {{admin_link}}
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('domain_renewal_upcoming',
 jsonb_build_object(
     'en', '[F2] {{domain}} expires on {{expiry_date}} — renewal coming up',
     'th', '[F2] {{domain}} จะหมดอายุวันที่ {{expiry_date}} — ใกล้ถึงกำหนดต่ออายุ'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nYour domain is coming up for renewal.\n\nDomain:    {{domain}}\nExpires:   {{expiry_date}} (in {{days_until}} day(s))\nRegistrar: {{registrar}}\n\nBecause this domain is set to auto-renew, we''ll issue the renewal invoice shortly and email it to you. You can settle it in your client portal:\n{{portal_link}}\n\nPlease renew before the expiry date — an expired domain stops resolving (website + email go down) and can be costly to recover once it enters the registry redemption period.\n\nIf you''d prefer NOT to renew this domain, just reply and we''ll turn off auto-renew.\n\n— F2 Co., Ltd.\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nโดเมนของคุณใกล้ถึงกำหนดต่ออายุ\n\nโดเมน:     {{domain}}\nหมดอายุ:   {{expiry_date}} (อีก {{days_until}} วัน)\nผู้รับจดทะเบียน: {{registrar}}\n\nเนื่องจากโดเมนนี้ตั้งค่าให้ต่ออายุอัตโนมัติ เราจะออกใบแจ้งหนี้ต่ออายุและส่งอีเมลให้คุณเร็ว ๆ นี้ ชำระได้ที่พอร์ทัลลูกค้า:\n{{portal_link}}\n\nกรุณาต่ออายุก่อนวันหมดอายุ — โดเมนที่หมดอายุจะใช้งานไม่ได้ (เว็บไซต์และอีเมลจะล่ม) และอาจมีค่าใช้จ่ายสูงในการกู้คืนหากเข้าสู่ช่วง redemption ของ registry\n\nหากไม่ต้องการต่ออายุโดเมนนี้ ตอบกลับอีเมลนี้เพื่อปิดการต่ออายุอัตโนมัติได้เลย\n\n— F2 Co., Ltd.\nhttps://f2.co.th'
 ),
 'Advance domain-expiry notice sent to the customer at configurable day tiers before expires_at (default 60/30/7).',
 true),

('domain_expired',
 jsonb_build_object(
     'en', '[F2] URGENT — {{domain}} has expired',
     'th', '[F2] ด่วน — {{domain}} หมดอายุแล้ว'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nYour domain {{domain}} expired on {{expiry_date}} ({{days_expired}} day(s) ago) and has NOT been renewed.\n\nWhile expired, the domain may stop resolving — your website and email tied to it can go offline at any time. Most registries then move the domain into a redemption period where recovery costs significantly more.\n\nPlease renew immediately in your client portal:\n{{portal_link}}\n\nIf you have already paid the renewal invoice, disregard this — we''ll push the renewal to the registrar and update the record. Questions? Reply to this email.\n\n— F2 Co., Ltd.\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nโดเมน {{domain}} ของคุณหมดอายุเมื่อวันที่ {{expiry_date}} (เมื่อ {{days_expired}} วันก่อน) และยังไม่ได้ต่ออายุ\n\nระหว่างที่หมดอายุ โดเมนอาจใช้งานไม่ได้ — เว็บไซต์และอีเมลที่ผูกไว้อาจล่มได้ทุกเมื่อ และ registry ส่วนใหญ่จะย้ายโดเมนเข้าสู่ช่วง redemption ซึ่งมีค่ากู้คืนสูงกว่ามาก\n\nกรุณาต่ออายุทันทีที่พอร์ทัลลูกค้า:\n{{portal_link}}\n\nหากคุณชำระใบแจ้งหนี้ต่ออายุแล้ว ไม่ต้องดำเนินการใด ๆ — เราจะดำเนินการต่ออายุกับผู้รับจดทะเบียนและอัปเดตข้อมูลให้ มีคำถาม ตอบกลับอีเมลนี้ได้เลย\n\n— F2 Co., Ltd.\nhttps://f2.co.th'
 ),
 'Post-expiry notice sent to the customer N days after expires_at when a domain lapses unrenewed (default 1 day after).',
 true),

('domain_renewal_internal',
 jsonb_build_object(
     'en', '[F2 Billing] Domain renewal — {{domain}} ({{customer_name}}) expires {{expiry_date}}',
     'th', '[F2 Billing] ต่ออายุโดเมน — {{domain}} ({{customer_name}}) หมดอายุ {{expiry_date}}'
 ),
 jsonb_build_object(
     'en', E'A customer domain is approaching expiry.\n\nCustomer:  {{customer_name}}\nDomain:    {{domain}}\nExpires:   {{expiry_date}} (in {{days_until}} day(s))\nRegistrar: {{registrar}}\n\nIf auto-renew is on, the renewal invoice auto-generates ~{{invoice_lead}} days out from domain_pricing. Once the customer pays, renew at the registrar and update expires_at in the admin console:\n{{admin_link}}\n\nIf domain_pricing has no active row for this TLD, no invoice was generated — quote it manually.\n\n— F2 renewal scheduler',
     'th', E'มีโดเมนของลูกค้าใกล้หมดอายุ\n\nลูกค้า:     {{customer_name}}\nโดเมน:     {{domain}}\nหมดอายุ:   {{expiry_date}} (อีก {{days_until}} วัน)\nผู้รับจดทะเบียน: {{registrar}}\n\nหากเปิดต่ออายุอัตโนมัติ ระบบจะออกใบแจ้งหนี้ต่ออายุอัตโนมัติประมาณ {{invoice_lead}} วันก่อนหมดอายุจาก domain_pricing เมื่อลูกค้าชำระแล้ว ให้ต่ออายุกับผู้รับจดทะเบียนและอัปเดต expires_at ในระบบแอดมิน:\n{{admin_link}}\n\nหาก domain_pricing ไม่มีข้อมูลสำหรับ TLD นี้ จะไม่มีการออกใบแจ้งหนี้ — กรุณาเสนอราคาด้วยตนเอง\n\n— F2 renewal scheduler'
 ),
 'Internal billing-team heads-up sent once per cycle when a customer domain enters the renewal window. Recipient = BILLING_NOTIFY_TO.',
 true)
ON CONFLICT (code) DO NOTHING;

-- Register the feature for /admin/features visibility. Like
-- api.payment_scheduler, the background pass is toggled via config
-- (RENEWAL_* / DOMAIN_RENEWAL_* env) rather than a runtime module read;
-- this row documents it in the admin console.
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('api.domain_renewals', 'api', 'Domain renewals', 'การต่ออายุโดเมน',
 'Background: domain-expiry notices + auto renewal invoicing from domain_pricing', true, false, 111)
ON CONFLICT (key) DO NOTHING;

COMMIT;
