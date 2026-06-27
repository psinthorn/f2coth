-- 016_dsr_notifications.sql
-- Correct DSR notification templates.
--
-- Migration 015 inserted these templates using the column name 'name' instead
-- of 'code', causing the INSERT to fail and leaving the templates absent from
-- the DB. This migration re-inserts them correctly:
--
--   • Uses the correct column 'code' (matches notification_templates schema).
--   • Uses JSONB format (required after migration 012).
--   • Template variables use {{key}} format to match renderTemplate() in
--     notification-api (no dot-notation, no Go text/template syntax).
--   • ON CONFLICT (code) DO UPDATE ensures idempotency.
--
-- Variables resolved at send time by auth-api/dispatchDSRNotifications:
--   {{name}}         — requester full name
--   {{email}}        — requester email address
--   {{request_type}} — e.g. access, erasure, portability …
--   {{id}}           — DSR UUID (reference number)
--   {{due_date}}     — PDPA 30-day deadline (YYYY-MM-DD)
--   {{admin_url}}    — deep link to admin DSR detail page
--   {{response_notes}} — used in fulfilled template only
--
-- Next migration: 017_*.sql

INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description)
VALUES
(
    'dsr_received_requester',
    '{"en": "Your data request has been received — F2 Co., Ltd.", "th": "เราได้รับคำขอข้อมูลของท่านแล้ว — บริษัท เอฟทู จำกัด"}',
    E'{"en": "Dear {{name}},\\n\\nWe have received your {{request_type}} request (Reference: {{id}}).\\n\\nUnder Thailand''s Personal Data Protection Act (PDPA), we will respond within 30 days — by {{due_date}}.\\n\\nIf you have any questions in the meantime, please contact us at privacy@f2.co.th.\\n\\nF2 Co., Ltd.\\nhttps://f2.co.th", "th": "เรียน คุณ{{name}}\\n\\nเราได้รับคำขอ{{request_type}}ของท่านแล้ว (อ้างอิง: {{id}})\\n\\nภายใต้พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA) เราจะตอบสนองภายใน 30 วัน — ภายในวันที่ {{due_date}}\\n\\nหากมีคำถาม ติดต่อเราได้ที่ privacy@f2.co.th\\n\\nบริษัท เอฟทู จำกัด\\nhttps://f2.co.th"}',
    'Sent to the DSR requester to confirm receipt of their request.'
),
(
    'dsr_received_staff',
    '{"en": "New DSR received: {{request_type}} from {{email}}", "th": "ได้รับ DSR ใหม่: {{request_type}} จาก {{email}}"}',
    E'{"en": "A new Data Subject Request has been submitted.\\n\\nReference: {{id}}\\nType:      {{request_type}}\\nFrom:      {{name}} <{{email}}>\\nDue by:    {{due_date}}\\n\\nReview and respond:\\n{{admin_url}}\\n\\n— f2.co.th", "th": "มีคำขอสิทธิ์ข้อมูลส่วนบุคคลใหม่\\n\\nอ้างอิง: {{id}}\\nประเภท:  {{request_type}}\\nจาก:     {{name}} <{{email}}>\\nกำหนด:  {{due_date}}\\n\\nดูและจัดการ:\\n{{admin_url}}\\n\\n— f2.co.th"}',
    'Internal alert to F2 privacy team when a new DSR is submitted.'
),
(
    'dsr_fulfilled_requester',
    '{"en": "Your data request is complete — F2 Co., Ltd.", "th": "คำขอข้อมูลของท่านเสร็จสมบูรณ์แล้ว — บริษัท เอฟทู จำกัด"}',
    E'{"en": "Dear {{name}},\\n\\nYour {{request_type}} request (Reference: {{id}}) has been completed.\\n\\n{{response_notes}}\\n\\nIf you have further questions, please contact privacy@f2.co.th.\\n\\nF2 Co., Ltd.\\nhttps://f2.co.th", "th": "เรียน คุณ{{name}}\\n\\nคำขอ{{request_type}}ของท่าน (อ้างอิง: {{id}}) เสร็จสมบูรณ์แล้ว\\n\\n{{response_notes}}\\n\\nหากมีคำถาม ติดต่อ privacy@f2.co.th\\n\\nบริษัท เอฟทู จำกัด\\nhttps://f2.co.th"}',
    'Sent to the DSR requester when their request is marked completed.'
)
ON CONFLICT (code) DO UPDATE SET
    subject_tmpl = EXCLUDED.subject_tmpl,
    body_tmpl    = EXCLUDED.body_tmpl,
    description  = EXCLUDED.description,
    is_active    = TRUE;
