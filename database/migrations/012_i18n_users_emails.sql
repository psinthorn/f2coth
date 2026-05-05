-- =============================================================
-- 012_i18n_users_emails.sql
-- Phase 3C — User-side locale persistence + bilingual email templates +
-- per-job locale on the notifications queue.
-- =============================================================

-- ---------- users.locale ----------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en','th'));

-- ---------- customer_contacts.locale ----------
ALTER TABLE customer_contacts
    ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en','th'));

-- ---------- notifications.locale (queue-side audit) ----------
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en','th'));

-- ---------- notification_templates: convert to JSONB ----------
ALTER TABLE notification_templates
    ADD COLUMN IF NOT EXISTS subject_tmpl_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS body_tmpl_i18n    JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE notification_templates SET
    subject_tmpl_i18n = jsonb_build_object('en', subject_tmpl),
    body_tmpl_i18n    = jsonb_build_object('en', body_tmpl)
WHERE subject_tmpl_i18n = '{}'::jsonb;

ALTER TABLE notification_templates
    ADD CONSTRAINT notification_templates_subject_has_en CHECK (subject_tmpl_i18n ? 'en'),
    ADD CONSTRAINT notification_templates_body_has_en    CHECK (body_tmpl_i18n ? 'en');

ALTER TABLE notification_templates DROP COLUMN subject_tmpl;
ALTER TABLE notification_templates DROP COLUMN body_tmpl;
ALTER TABLE notification_templates RENAME COLUMN subject_tmpl_i18n TO subject_tmpl;
ALTER TABLE notification_templates RENAME COLUMN body_tmpl_i18n    TO body_tmpl;

-- ---------- Thai template variants ----------
-- All templates are merged with `||` so existing en stays untouched.

UPDATE notification_templates SET
    subject_tmpl = subject_tmpl || jsonb_build_object('th', 'ข้อมูลลูกค้าใหม่: {{full_name}} ({{property_name}})'),
    body_tmpl    = body_tmpl    || jsonb_build_object('th',
        E'มีข้อความติดต่อใหม่เข้ามาผ่าน {{source}}\n\nชื่อ: {{full_name}}\nอีเมล: {{email}}\nโทรศัพท์: {{phone}}\nบริษัท: {{company}}\nสถานที่: {{property_name}} ({{property_type}})\nสนใจ: {{interest}}\n\nข้อความ:\n{{message}}\n\n— f2.co.th')
WHERE code = 'lead_received_sales';

UPDATE notification_templates SET
    subject_tmpl = subject_tmpl || jsonb_build_object('th', 'ขอบคุณที่ติดต่อ F2 Co., Ltd.'),
    body_tmpl    = body_tmpl    || jsonb_build_object('th',
        E'สวัสดีคุณ {{full_name}}\n\nขอบคุณที่ติดต่อ F2 Co., Ltd. เราได้รับข้อความของคุณแล้ว ทีมงานของเราจะติดต่อกลับภายในหนึ่งวันทำการ\n\nระหว่างนี้ ดูกรณีศึกษาของเราได้ที่ https://f2.co.th/th/case-studies\n\n— ทีม F2')
WHERE code = 'lead_received_visitor';

UPDATE notification_templates SET
    subject_tmpl = subject_tmpl || jsonb_build_object('th', '[F2 Tickets] {{priority}} · {{customer_name}}: {{subject}}'),
    body_tmpl    = body_tmpl    || jsonb_build_object('th',
        E'มีเคสซัพพอร์ตใหม่ถูกเปิดขึ้น\n\nลูกค้า: {{customer_name}}\nเปิดโดย: {{opened_by}}\nความสำคัญ: {{priority}}\nบริการที่เกี่ยวข้อง: {{service}}\n\nหัวข้อ:\n{{subject}}\n\nข้อความ:\n{{body}}\n\nดูในระบบแอดมิน: {{ticket_url}}\n\n— f2.co.th')
WHERE code = 'ticket_received_staff';

UPDATE notification_templates SET
    subject_tmpl = subject_tmpl || jsonb_build_object('th', 'F2 ตอบกลับเคสของคุณ: {{subject}}'),
    body_tmpl    = body_tmpl    || jsonb_build_object('th',
        E'สวัสดีคุณ {{contact_name}}\n\nเราได้ตอบกลับเคสซัพพอร์ต "{{subject}}" บนพอร์ทัลลูกค้าของ F2\n\n{{author_name}} ตอบว่า:\n\n{{body}}\n\nดูเธรดทั้งหมด: {{ticket_url}}\n\nหากเรื่องนี้ได้รับการแก้ไขแล้ว คุณสามารถทำเครื่องหมายว่าเสร็จสิ้นได้จากพอร์ทัล\n\n— ทีม F2')
WHERE code = 'ticket_reply_customer';

UPDATE notification_templates SET
    subject_tmpl = subject_tmpl || jsonb_build_object('th', 'F2 เปิดเคสในนามของคุณ: {{subject}}'),
    body_tmpl    = body_tmpl    || jsonb_build_object('th',
        E'สวัสดีคุณ {{contact_name}}\n\n{{author_name}} จาก F2 ได้เปิดเคสซัพพอร์ตในบัญชีของคุณ: "{{subject}}"\n\nรายละเอียด:\n{{body}}\n\nดูและตอบกลับ: {{ticket_url}}\n\n— ทีม F2')
WHERE code = 'ticket_opened_on_behalf_customer';

-- ---------- Set staff admin to Thai by default? No — keep en, F2 staff can switch.
-- Customer contacts default to en too; F2 admins can flip via /admin/customers.

-- ---------- Index for the worker query (status + locale + scheduled) ----------
-- Existing idx_notifications_status_sched still works; locale column doesn't affect it.
