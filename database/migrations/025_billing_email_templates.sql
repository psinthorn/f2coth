-- 025_billing_email_templates.sql
-- Seed the three notification templates that payment-api already calls:
--
--   invoice_issued          — sent to billing contact when admin issues
--                             an invoice (variables: invoice_number,
--                             amount, currency, portal_link).
--   payment_received        — sent to billing contact when a payment
--                             clears (PayPal capture or admin slip
--                             verify). Variables: invoice_number,
--                             payment_number, amount, currency.
--   payment_slip_received   — internal alert to billing team when a
--                             customer uploads a slip. Variables:
--                             payment_id, slip_url, bank_ref.
--
-- Without these rows payment-api's notify.Send() calls were silently
-- dropped — the notification_templates table is the source of truth and
-- has a NOT NULL row requirement.
--
-- Next migration: 026_*.sql

BEGIN;

INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('invoice_issued',
 jsonb_build_object(
     'en', '[F2] Invoice {{invoice_number}} — {{currency}} {{amount}}',
     'th', '[F2] ใบแจ้งหนี้ {{invoice_number}} — {{currency}} {{amount}}'
 ),
 jsonb_build_object(
     'en', E'Hello,\n\nA new invoice has been issued for your account.\n\nInvoice:  {{invoice_number}}\nAmount:   {{currency}} {{amount}}\n\nReview and pay it in your client portal:\n{{portal_link}}\n\nWe accept bank transfer, Thai QR, PromptPay, and PayPal — pick whichever is convenient.\n\nIf you have any questions, just reply to this email.\n\n— F2 Co., Ltd.\nhttps://f2.co.th',
     'th', E'สวัสดีครับ/ค่ะ\n\nเราได้ออกใบแจ้งหนี้ใหม่ในบัญชีของคุณ\n\nเลขที่:    {{invoice_number}}\nจำนวน:    {{currency}} {{amount}}\n\nดูรายละเอียดและชำระเงินผ่านพอร์ทัลลูกค้าได้ที่:\n{{portal_link}}\n\nรับชำระผ่านโอนเงิน, Thai QR, พร้อมเพย์ และ PayPal — เลือกวิธีที่สะดวกที่สุด\n\nสอบถามเพิ่มเติม ตอบกลับอีเมลฉบับนี้ได้เลย\n\n— F2 Co., Ltd.\nhttps://f2.co.th'
 ),
 'Sent to the customer''s billing contact when an invoice transitions from draft → issued.',
 true),

('payment_received',
 jsonb_build_object(
     'en', '[F2] Payment received for invoice {{invoice_number}}',
     'th', '[F2] รับชำระเงินสำหรับใบแจ้งหนี้ {{invoice_number}}'
 ),
 jsonb_build_object(
     'en', E'Thanks — your payment has cleared.\n\nInvoice:        {{invoice_number}}\nPayment ref:    {{payment_number}}\nAmount:         {{currency}} {{amount}}\n\nThis email serves as your receipt. The official tax invoice (where applicable) will be available in your portal shortly.\n\n— F2 Co., Ltd.\nhttps://f2.co.th',
     'th', E'ขอบคุณครับ/ค่ะ — ได้รับชำระเงินเรียบร้อยแล้ว\n\nใบแจ้งหนี้:       {{invoice_number}}\nรหัสการชำระ:     {{payment_number}}\nจำนวน:          {{currency}} {{amount}}\n\nอีเมลฉบับนี้ใช้เป็นใบเสร็จเบื้องต้น ใบกำกับภาษี (ในกรณีที่มี) จะปรากฏในพอร์ทัลของคุณในไม่ช้า\n\n— F2 Co., Ltd.\nhttps://f2.co.th'
 ),
 'Sent to the customer''s billing contact when a payment is marked completed (PayPal capture, admin slip verification, or sandbox force-complete).',
 true),

('payment_slip_received',
 jsonb_build_object(
     'en', '[F2 Billing] Slip awaiting verification — payment {{payment_id}}',
     'th', '[F2 Billing] รอตรวจสลิป — payment {{payment_id}}'
 ),
 jsonb_build_object(
     'en', E'A customer has uploaded a transfer slip awaiting verification.\n\nPayment ID:   {{payment_id}}\nBank ref:     {{bank_ref}}\nSlip:         {{slip_url}}\n\nReview and verify it in the admin payments queue:\nhttps://f2.co.th/admin/payments?status=awaiting_verification\n\n— F2 ops',
     'th', E'มีลูกค้าอัปโหลดสลิปการโอนรอตรวจสอบ\n\nรหัส payment:   {{payment_id}}\nเลขอ้างอิงธนาคาร: {{bank_ref}}\nสลิป:           {{slip_url}}\n\nตรวจสอบและยืนยันในคิว admin payments:\nhttps://f2.co.th/admin/payments?status=awaiting_verification\n\n— F2 ops'
 ),
 'Internal alert to the billing team whenever a customer uploads a slip via the portal pay flow.',
 true)
ON CONFLICT (code) DO NOTHING;

COMMIT;
