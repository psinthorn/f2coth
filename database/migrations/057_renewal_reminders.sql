-- 057_renewal_reminders.sql
-- Phase 1 of recurring-renewal automation (hosting + other subscriptions).
--
-- Adds an *advance* renewal-reminder channel: WHMCS-style "your service
-- renews soon" notices sent BEFORE next_billing_at, so customers (and the
-- billing team) get a heads-up before the invoice is even generated.
--
-- This complements — does not replace — the existing machinery:
--   • generateSubscriptionInvoices() issues the invoice at LeadDays (7)
--     before next_billing_at and emails `invoice_issued`.
--   • dunning_reminders (031) handles AFTER-due chasing.
-- The gap this fills is the window > 7 days out, where nothing was sent.
--
-- renewal_reminders is the idempotency stamp (mirrors dunning_reminders):
-- one row per (entity, renewal date, offset tier) guarantees a given
-- reminder tier fires exactly once per renewal cycle across scheduler
-- restarts. entity_type is generic so Phase 2 (domain expiry, off
-- customer_domains.expires_at) reuses the same table.
--
-- offset_days sentinel: 0 = "internal billing-team heads-up sent for this
-- cycle" (real customer tiers are always > 0, e.g. 30 / 14).
--
-- Next migration: 058_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS renewal_reminders (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type    TEXT         NOT NULL CHECK (entity_type IN ('subscription', 'domain')),
    entity_id      UUID         NOT NULL,
    due_date       DATE         NOT NULL,  -- the renewal/expiry date this reminder covered
    offset_days    INT          NOT NULL,  -- days-before tier (0 = internal heads-up sentinel)
    template_used  TEXT         NOT NULL,
    sent_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, entity_id, due_date, offset_days)
);

CREATE INDEX IF NOT EXISTS idx_renewal_reminders_entity
    ON renewal_reminders (entity_type, entity_id, due_date);

-- Advance renewal templates (EN + TH). Variables from the scheduler:
--   {{customer_name}} {{service_name}} {{amount}} {{currency}}
--   {{billing_cycle}} {{renewal_date}} {{days_until}} {{portal_link}}
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('service_renewal_upcoming',
 jsonb_build_object(
     'en', '[F2] {{service_name}} renews on {{renewal_date}} — {{currency}} {{amount}}',
     'th', '[F2] {{service_name}} จะต่ออายุวันที่ {{renewal_date}} — {{currency}} {{amount}}'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nA quick heads-up that your service is coming up for renewal.\n\nService:   {{service_name}}\nRenews on: {{renewal_date}} (in {{days_until}} day(s))\nAmount:    {{currency}} {{amount}} / {{billing_cycle}}\n\nNo action is needed right now — we''ll issue the renewal invoice about a week before the date, and you can settle it in your client portal:\n{{portal_link}}\n\nWe accept bank transfer, Thai QR, PromptPay, and PayPal.\n\nIf you''d like to change or cancel this service before it renews, just reply to this email and we''ll take care of it.\n\n— F2 Co., Ltd.\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nขอแจ้งให้ทราบล่วงหน้าว่าบริการของคุณใกล้ถึงกำหนดต่ออายุ\n\nบริการ:      {{service_name}}\nต่ออายุวันที่: {{renewal_date}} (อีก {{days_until}} วัน)\nจำนวน:      {{currency}} {{amount}} / {{billing_cycle}}\n\nยังไม่ต้องดำเนินการใด ๆ ในตอนนี้ — เราจะออกใบแจ้งหนี้ต่ออายุประมาณหนึ่งสัปดาห์ก่อนถึงกำหนด และคุณสามารถชำระได้ที่พอร์ทัลลูกค้า:\n{{portal_link}}\n\nรับชำระผ่านโอนเงิน, Thai QR, พร้อมเพย์ และ PayPal\n\nหากต้องการเปลี่ยนแปลงหรือยกเลิกบริการก่อนต่ออายุ ตอบกลับอีเมลฉบับนี้ได้เลย ทีมงานจะดูแลให้\n\n— F2 Co., Ltd.\nhttps://f2.co.th'
 ),
 'Advance renewal heads-up sent to the customer''s billing contact N days before a subscription''s next_billing_at (offsets configurable, default 30 & 14 days).',
 true),

('service_renewal_upcoming_internal',
 jsonb_build_object(
     'en', '[F2 Billing] Renewal upcoming — {{service_name}} ({{customer_name}}) on {{renewal_date}}',
     'th', '[F2 Billing] ใกล้ต่ออายุ — {{service_name}} ({{customer_name}}) วันที่ {{renewal_date}}'
 ),
 jsonb_build_object(
     'en', E'A subscription is approaching its renewal date.\n\nCustomer:   {{customer_name}}\nService:    {{service_name}}\nRenews on:  {{renewal_date}} (in {{days_until}} day(s))\nAmount:     {{currency}} {{amount}} / {{billing_cycle}}\n\nThe renewal invoice will auto-generate ~7 days before the date. Review the subscription if anything needs changing first:\n{{admin_link}}\n\n— F2 renewal scheduler',
     'th', E'มีบริการที่ใกล้ถึงกำหนดต่ออายุ\n\nลูกค้า:      {{customer_name}}\nบริการ:     {{service_name}}\nต่ออายุวันที่: {{renewal_date}} (อีก {{days_until}} วัน)\nจำนวน:     {{currency}} {{amount}} / {{billing_cycle}}\n\nระบบจะออกใบแจ้งหนี้ต่ออายุอัตโนมัติประมาณ 7 วันก่อนถึงกำหนด ตรวจสอบรายการหากต้องแก้ไขก่อน:\n{{admin_link}}\n\n— F2 renewal scheduler'
 ),
 'Internal billing-team heads-up sent once per renewal cycle when a subscription enters the advance-reminder window. Recipient = BILLING_NOTIFY_TO.',
 true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
