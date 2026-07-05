-- 032_service_suspensions.sql
-- Service suspension: when dunning level 3 has been sent and the
-- invoice is still unpaid after another 14 days, the scheduler pauses
-- the related services and tells the customer (+ billing team).
--
-- Two pieces:
--   1. customer_sla_contracts.status grows a 'suspended' state so the
--      portal/admin can render the SLA as paused without an extra flag.
--   2. service_suspensions records every suspension event so admins can
--      review history, undo manually, and the auto-restore path (when
--      the invoice gets paid) knows what to flip back.
--
-- A suspension targets ONE underlying resource (subscription / SLA /
-- whatever the invoice item points at). One overdue invoice with three
-- line items can produce three suspension rows — easier to audit than
-- a single composite suspension row.
--
-- Next migration: 033_*.sql

BEGIN;

-- ---------- 1. SLA suspended state ----------
ALTER TABLE customer_sla_contracts
    DROP CONSTRAINT IF EXISTS customer_sla_contracts_status_check;
ALTER TABLE customer_sla_contracts
    ADD CONSTRAINT customer_sla_contracts_status_check
    CHECK (status IN ('draft','active','renewing','expired','suspended'));

-- ---------- 2. service_suspensions ----------
CREATE TABLE IF NOT EXISTS service_suspensions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          UUID         NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id         UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    -- What was suspended. product_type mirrors invoice_items + adds
    -- 'subscription' for the case where the scheduler walked from an
    -- invoice → invoice.subscription_id (vs from a line item).
    product_type        TEXT         NOT NULL CHECK (product_type IN ('subscription','sla','hosting','msp','custom')),
    product_ref         UUID,
    -- Snapshot of the resource's state at suspension time so the
    -- auto-restore path can put it back exactly as it was.
    previous_state      TEXT,
    -- Suspension lifecycle. 'active' = currently suspended,
    -- 'restored' = service back, 'overridden' = admin manually
    -- cancelled the suspension without restoring (rare).
    status              TEXT         NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active','restored','overridden')),
    reason              TEXT,
    suspended_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    restored_at         TIMESTAMPTZ,
    restored_by_user_id UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
    -- created_by NULL = the scheduler (system action)
    metadata            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Don't double-suspend the same resource via the same invoice.
    UNIQUE (invoice_id, product_type, product_ref)
);

CREATE INDEX IF NOT EXISTS idx_suspensions_active
    ON service_suspensions (invoice_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_suspensions_customer
    ON service_suspensions (customer_id, status, suspended_at DESC);

CREATE OR REPLACE TRIGGER set_service_suspensions_updated_at
    BEFORE UPDATE ON service_suspensions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- 3. Email templates ----------
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('service_suspended_customer',
 jsonb_build_object(
     'en', '[F2] Service paused — invoice {{invoice_number}} unpaid',
     'th', '[F2] หยุดบริการชั่วคราว — ใบแจ้งหนี้ {{invoice_number}} ยังไม่ชำระ'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nWe''ve paused {{service_count}} service(s) on your account because invoice {{invoice_number}} ({{currency}} {{amount}}) is now {{days_overdue}} days past due. We notified you three times before taking this step.\n\nServices paused:\n{{service_list}}\n\nTo restore everything immediately, pay the invoice in your portal:\n{{portal_link}}\n\nServices auto-restore the moment payment clears. If there''s a billing dispute we should resolve first, reply to this email.\n\n— F2 Billing\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nเราได้หยุดบริการ {{service_count}} รายการในบัญชีของคุณชั่วคราว เนื่องจากใบแจ้งหนี้ {{invoice_number}} ({{currency}} {{amount}}) เลยกำหนดมาแล้ว {{days_overdue}} วัน · เราได้แจ้งเตือนคุณมาแล้ว 3 ครั้งก่อนหน้านี้\n\nบริการที่หยุดชั่วคราว:\n{{service_list}}\n\nหากต้องการเปิดใช้งานทันที กรุณาชำระเงินที่พอร์ทัล:\n{{portal_link}}\n\nระบบจะเปิดบริการอัตโนมัติทันทีที่ payment ผ่าน · หากมีประเด็นการเรียกเก็บที่ต้องแก้ไขก่อน ตอบกลับอีเมลฉบับนี้\n\n— F2 Billing\nhttps://f2.co.th'
 ),
 'Sent to the customer when the scheduler suspends services after dunning level 3 + 14 days.',
 true),

('service_restored_customer',
 jsonb_build_object(
     'en', '[F2] Services restored',
     'th', '[F2] เปิดบริการเรียบร้อย'
 ),
 jsonb_build_object(
     'en', E'Hello {{customer_name}},\n\nThanks — your payment cleared and we''ve restored {{service_count}} service(s) on your account. Sorry for the disruption.\n\nServices restored:\n{{service_list}}\n\nIf you spot anything off, reply to this email and we''ll look immediately.\n\n— F2 Billing\nhttps://f2.co.th',
     'th', E'สวัสดีคุณ {{customer_name}}\n\nขอบคุณครับ/ค่ะ — payment ของคุณผ่านเรียบร้อย เราได้เปิดบริการ {{service_count}} รายการกลับคืนแล้ว · ขออภัยในความไม่สะดวก\n\nบริการที่เปิดใหม่:\n{{service_list}}\n\nหากพบความผิดปกติ ตอบกลับอีเมลฉบับนี้เราจะรีบดูให้ทันที\n\n— F2 Billing\nhttps://f2.co.th'
 ),
 'Sent to the customer when the invoice gets paid and the scheduler auto-restores suspended services.',
 true),

('services_suspended_internal',
 jsonb_build_object(
     'en', '[F2 Ops] {{service_count}} service(s) auto-suspended for {{customer_name}}',
     'th', '[F2 Ops] หยุดบริการอัตโนมัติ {{service_count}} รายการของ {{customer_name}}'
 ),
 jsonb_build_object(
     'en', E'The dunning scheduler just suspended services for an unpaid invoice.\n\nCustomer:   {{customer_name}}\nInvoice:    {{invoice_number}}\nAmount:     {{currency}} {{amount}}\nOverdue:    {{days_overdue}} days\n\nServices suspended:\n{{service_list}}\n\nReview / override in the admin queue:\n{{admin_link}}\n\n— F2 dunning scheduler',
     'th', E'Dunning scheduler เพิ่งหยุดบริการสำหรับใบแจ้งหนี้ที่ยังไม่ชำระ\n\nลูกค้า:     {{customer_name}}\nใบแจ้งหนี้: {{invoice_number}}\nจำนวน:    {{currency}} {{amount}}\nเกินกำหนด: {{days_overdue}} วัน\n\nบริการที่หยุด:\n{{service_list}}\n\nตรวจสอบ / ยกเลิกการหยุดได้ในคิว admin:\n{{admin_link}}\n\n— F2 dunning scheduler'
 ),
 'Internal alert to the billing team after the scheduler auto-suspends services.',
 true)
ON CONFLICT (code) DO NOTHING;

-- ---------- 4. Module ----------
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.suspensions', 'admin', 'Suspensions', 'การระงับบริการ',
 'Services paused by the dunning scheduler — review, manually restore, or override',
 true, false, 72)
ON CONFLICT (key) DO NOTHING;

COMMIT;
