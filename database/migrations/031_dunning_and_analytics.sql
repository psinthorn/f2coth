-- 031_dunning_and_analytics.sql
-- Two related operational features in one migration:
--
--   1. dunning_reminders + 3 staged dunning email templates so the
--      scheduler can dispatch progressive reminders for overdue
--      invoices (1d / 7d / 14d / 30d) without sending duplicates.
--
--   2. (No schema for analytics — the endpoints query existing tables.)
--
-- Progressive levels — handler dispatches in scheduler.go:
--   level 1 → 1+ day overdue   · friendly tone
--   level 2 → 7+ days overdue  · firmer
--   level 3 → 14+ days overdue · final notice, mentions possible
--                                 service suspension
--   level 4 → 30+ days overdue · escalation to billing@f2.co.th
--                                 (no customer email)
--
-- UNIQUE(invoice_id, reminder_level) guarantees idempotency across
-- restarts of the scheduler — re-running the loop is a no-op once a
-- level is recorded.
--
-- Next migration: 032_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS dunning_reminders (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID         NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    reminder_level  INT          NOT NULL CHECK (reminder_level BETWEEN 1 AND 4),
    template_used   TEXT         NOT NULL,
    sent_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (invoice_id, reminder_level)
);

CREATE INDEX IF NOT EXISTS idx_dunning_invoice ON dunning_reminders (invoice_id, reminder_level);

-- Dunning email templates (EN + TH). Variables come from the scheduler:
--   {{invoice_number}} {{amount}} {{currency}} {{portal_link}}
--   {{days_overdue}}   {{customer_name}}
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('invoice_reminder_friendly',
 jsonb_build_object(
     'en', 'Friendly reminder — invoice {{invoice_number}} is past due',
     'th', '[F2] เตือนใบแจ้งหนี้ {{invoice_number}} เลยกำหนด'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} ({{currency}} {{amount}}) is {{days_overdue}} day(s) past due.\n\nIf you''ve already paid, please disregard. Otherwise, you can settle it in your client portal:\n{{portal_link}}\n\nWe accept bank transfer, Thai QR, PromptPay, and PayPal.\n\n— F2 Co., Ltd.\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nขอแจ้งเตือนว่าใบแจ้งหนี้ {{invoice_number}} ({{currency}} {{amount}}) เลยกำหนดมาแล้ว {{days_overdue}} วัน\n\nหากชำระเงินเรียบร้อยแล้ว ขออภัยในความไม่สะดวก หากยังไม่ชำระสามารถดำเนินการได้ที่พอร์ทัลลูกค้า:\n{{portal_link}}\n\nรับชำระผ่านโอนเงิน, Thai QR, พร้อมเพย์ และ PayPal\n\n— F2 Co., Ltd.\nhttps://f2.co.th'
 ),
 'Dunning level 1 — sent 1+ day after due_date with a friendly tone.',
 true),

('invoice_reminder_firm',
 jsonb_build_object(
     'en', 'Second notice — invoice {{invoice_number}} is {{days_overdue}} days past due',
     'th', '[F2] แจ้งเตือนครั้งที่ 2 — ใบแจ้งหนี้ {{invoice_number}} เลยกำหนด {{days_overdue}} วัน'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nWe haven''t received payment for invoice {{invoice_number}} ({{currency}} {{amount}}) yet. It''s now {{days_overdue}} days past due.\n\nPlease settle it as soon as possible to avoid any disruption to your services:\n{{portal_link}}\n\nIf there''s an issue (incorrect amount, billing details to update, payment-method problem) just reply to this email and we''ll sort it out.\n\n— F2 Billing\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nเรายังไม่ได้รับการชำระเงินสำหรับใบแจ้งหนี้ {{invoice_number}} ({{currency}} {{amount}}) ตอนนี้เลยกำหนดมาแล้ว {{days_overdue}} วัน\n\nกรุณาดำเนินการชำระโดยเร็วเพื่อหลีกเลี่ยงการกระทบกับบริการของคุณ:\n{{portal_link}}\n\nหากมีปัญหา (จำนวนไม่ถูก ต้องอัปเดตข้อมูลผู้เสียภาษี หรือปัญหาในการชำระ) ตอบกลับอีเมลฉบับนี้ได้เลย ทีมงานจะดูแลให้\n\n— F2 Billing\nhttps://f2.co.th'
 ),
 'Dunning level 2 — sent 7+ days after due_date, firmer tone.',
 true),

('invoice_reminder_final',
 jsonb_build_object(
     'en', 'FINAL NOTICE — invoice {{invoice_number}} {{days_overdue}} days overdue',
     'th', '[F2] แจ้งเตือนครั้งสุดท้าย — ใบแจ้งหนี้ {{invoice_number}} เลยกำหนด {{days_overdue}} วัน'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nThis is the final reminder for invoice {{invoice_number}} ({{currency}} {{amount}}), now {{days_overdue}} days past due.\n\nIf we don''t receive payment within the next 14 days, we may need to:\n  • pause associated services (hosting, SLA, etc.)\n  • refer the account to F2''s collections team\n\nPlease settle it now in your portal — it takes a minute and avoids all of the above:\n{{portal_link}}\n\nOr reply to this email if there''s a billing dispute we should resolve first.\n\n— F2 Billing\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nนี่คือการแจ้งเตือนครั้งสุดท้ายสำหรับใบแจ้งหนี้ {{invoice_number}} ({{currency}} {{amount}}) ตอนนี้เลยกำหนดมาแล้ว {{days_overdue}} วัน\n\nหากไม่ได้รับการชำระภายใน 14 วันข้างหน้า เราอาจจำเป็นต้อง:\n  • หยุดบริการที่เกี่ยวข้อง (โฮสติ้ง, SLA ฯลฯ) ชั่วคราว\n  • ส่งบัญชีให้ทีมติดตามทวงถามของ F2\n\nกรุณาดำเนินการชำระตอนนี้ที่พอร์ทัล — ใช้เวลาไม่กี่นาที:\n{{portal_link}}\n\nหรือตอบกลับอีเมลฉบับนี้หากมีประเด็นที่เราควรแก้ไขก่อน\n\n— F2 Billing\nhttps://f2.co.th'
 ),
 'Dunning level 3 — sent 14+ days after due_date, final notice mentioning service suspension.',
 true)
ON CONFLICT (code) DO NOTHING;

-- Internal escalation template (sent to billing team, not customer)
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('invoice_escalation_internal',
 jsonb_build_object(
     'en', '[F2 Billing] Escalation — invoice {{invoice_number}} {{days_overdue}} days overdue',
     'th', '[F2 Billing] ยกระดับ — ใบแจ้งหนี้ {{invoice_number}} เลยกำหนด {{days_overdue}} วัน'
 ),
 jsonb_build_object(
     'en', E'Invoice escalation — manual collection required.\n\nCustomer:   {{customer_name}}\nInvoice:    {{invoice_number}}\nAmount:     {{currency}} {{amount}}\nOverdue:    {{days_overdue}} days\n\nReview in the admin queue:\n{{admin_link}}\n\nThe customer has received 3 automated reminders and has not paid. Consider:\n  • calling the customer''s primary contact\n  • pausing services pending resolution\n  • referring to a collections workflow\n\n— F2 dunning scheduler',
     'th', E'ยกระดับใบแจ้งหนี้ — ต้องติดตามด้วยมือ\n\nลูกค้า:     {{customer_name}}\nใบแจ้งหนี้: {{invoice_number}}\nจำนวน:    {{currency}} {{amount}}\nเกินกำหนด: {{days_overdue}} วัน\n\nตรวจสอบในคิว admin:\n{{admin_link}}\n\nลูกค้าได้รับการแจ้งเตือนอัตโนมัติ 3 ครั้งแล้วและยังไม่ชำระ ควรพิจารณา:\n  • โทรหาผู้ติดต่อหลักของลูกค้า\n  • หยุดบริการชั่วคราวระหว่างรอการแก้ไข\n  • ส่งต่อให้ทีมติดตามทวงถาม\n\n— F2 dunning scheduler'
 ),
 'Dunning level 4 — internal escalation to billing team after 30 days, no customer email.',
 true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
