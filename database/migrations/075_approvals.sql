-- 075_approvals.sql
-- Reusable customer-approval primitive. Staff bundle items a customer must
-- approve (a quotation for materials/labour, a resolved issue), email a
-- single-use magic-link, and the customer approves/declines WITHOUT logging in.
-- Soft-polymorphic over (subject_type, subject_id) — matches attachments (053)
-- and audit_log (019) — so tickets-first generalises to contracts/checklists
-- later with no schema churn. Full spec: docs/approval-system-specs.md.
--
-- Money = BIGINT minor units (satang); VAT in basis points (700 = 7%), matching
-- ticket_line_items / invoices. Magic-link tokens mirror the password_resets /
-- DSR design: raw 64-hex token in the URL only, sha256 hash stored, single-use.

-- ---------- Approval requests ----------
CREATE TABLE IF NOT EXISTS approvals (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_type          TEXT         NOT NULL CHECK (subject_type IN ('ticket')),
    subject_id            UUID         NOT NULL,             -- soft ref (no FK), like attachments
    customer_id           UUID         NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    kind                  TEXT         NOT NULL DEFAULT 'general'
                                       CHECK (kind IN ('quotation','resolution','general')),
    status                TEXT         NOT NULL DEFAULT 'draft'
                                       CHECK (status IN ('draft','sent','approved','declined','cancelled','expired')),
    title                 TEXT         NOT NULL,
    body_md               TEXT         NOT NULL DEFAULT '',

    -- Frozen money snapshot (set at send time; nullable currency for non-priced).
    currency              TEXT         CHECK (currency IN ('THB','USD')),
    subtotal_cents        BIGINT       NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
    vat_rate_bp           INT          NOT NULL DEFAULT 700,
    vat_cents             BIGINT       NOT NULL DEFAULT 0 CHECK (vat_cents >= 0),
    total_cents           BIGINT       NOT NULL DEFAULT 0 CHECK (total_cents >= 0),

    requested_by_user_id  UUID         REFERENCES users(id) ON DELETE SET NULL,
    decided_by_contact_id UUID         REFERENCES customer_contacts(id) ON DELETE SET NULL,
    decided_via           TEXT         CHECK (decided_via IN ('magic_link','portal')),
    decided_at            TIMESTAMPTZ,
    decline_reason        TEXT,

    sent_at               TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approvals_subject   ON approvals (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_customer  ON approvals (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_approvals_status    ON approvals (status, expires_at);

CREATE TRIGGER trg_approvals_updated_at
BEFORE UPDATE ON approvals
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Bundled items (whole-bundle decision; no per-item status) ----------
CREATE TABLE IF NOT EXISTS approval_items (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id       UUID         NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
    item_type         TEXT         NOT NULL DEFAULT 'text'
                                   CHECK (item_type IN ('line','issue','text')),
    ref_type          TEXT,                                  -- provenance, e.g. 'ticket_line_item'
    ref_id            UUID,
    label             TEXT         NOT NULL,
    detail_md         TEXT         NOT NULL DEFAULT '',
    quantity          INT,
    unit              TEXT,
    unit_price_cents  BIGINT,
    amount_cents      BIGINT       NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
    sort_order        INT          NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_items_approval ON approval_items (approval_id, sort_order);

-- ---------- Magic-link tokens (DSR / password_resets pattern) ----------
CREATE TABLE IF NOT EXISTS approval_tokens (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_id  UUID         NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
    contact_id   UUID         NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
    token_hash   TEXT         NOT NULL UNIQUE,               -- sha256 hex of the raw token
    expires_at   TIMESTAMPTZ  NOT NULL,
    used_at      TIMESTAMPTZ,                                -- stamped when a decision is made
    revoked_at   TIMESTAMPTZ,                                -- set on resend/cancel
    ip_address   INET,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_tokens_approval ON approval_tokens (approval_id);

-- ---------- Attachments: allow 'approval' owner_type ----------
-- The CHECK on attachments.owner_type is an unnamed inline constraint; Postgres
-- auto-names it attachments_owner_type_check.
ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_owner_type_check;
ALTER TABLE attachments ADD  CONSTRAINT attachments_owner_type_check
    CHECK (owner_type IN ('ticket','ticket_message','project','project_item','visit_log','approval'));

-- ---------- Module toggles (surface automatically in /admin/features) ----------
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
    ('api.approvals',    'api',    'Approvals',        'การอนุมัติ',
     'Customer approval requests — quotation / resolved-issue sign-off via magic-link', true, false, 91),
    ('admin.approvals',  'admin',  'Approvals',        'การอนุมัติ',
     'Build and send approval requests from tickets and other sections', true, false, 91),
    ('portal.approvals', 'portal', 'Approvals',        'การอนุมัติ',
     'Customer views and approves requests in the portal', true, false, 91)
ON CONFLICT (key) DO NOTHING;

-- ---------- Email templates (bilingual JSONB; en required) ----------
INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'approval_request_customer',
    'Magic-link email asking a customer to approve a quotation / request',
    jsonb_build_object(
        'en', 'F2 needs your approval: {{title}}',
        'th', 'F2 ขอการอนุมัติจากคุณ: {{title}}'
    ),
    jsonb_build_object(
        'en',
'Hi {{contact_name}},

F2 has prepared the following for your approval:

  {{title}}
  Total: {{total}}

Please review the details and approve or decline using the secure link below. You do not need to log in — the link expires on {{expires_on}}.

{{approval_url}}

If you have any questions, just reply to this email.

— F2 Co., Ltd.',
        'th',
'สวัสดี {{contact_name}}

F2 ได้จัดเตรียมรายการต่อไปนี้เพื่อขอการอนุมัติจากคุณ:

  {{title}}
  ยอดรวม: {{total}}

กรุณาตรวจสอบรายละเอียดแล้วอนุมัติหรือปฏิเสธผ่านลิงก์ปลอดภัยด้านล่าง คุณไม่จำเป็นต้องเข้าสู่ระบบ — ลิงก์จะหมดอายุวันที่ {{expires_on}}

{{approval_url}}

หากมีคำถาม สามารถตอบกลับอีเมลนี้ได้เลย

— F2 Co., Ltd.'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'approval_approved_staff',
    'Internal alert when a customer approves a request',
    jsonb_build_object(
        'en', 'Approved by customer: {{title}}',
        'th', 'ลูกค้าอนุมัติแล้ว: {{title}}'
    ),
    jsonb_build_object(
        'en',
'{{decided_by}} at {{customer_name}} approved:

  {{title}}

Decided: {{decided_at}}
Open the ticket: {{subject_url}}

— F2 Platform',
        'th',
'{{decided_by}} จาก {{customer_name}} ได้อนุมัติ:

  {{title}}

เวลาที่ตัดสินใจ: {{decided_at}}
เปิดตั๋ว: {{subject_url}}

— F2 Platform'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'approval_declined_staff',
    'Internal alert when a customer declines a request (with reason)',
    jsonb_build_object(
        'en', 'Declined by customer: {{title}}',
        'th', 'ลูกค้าปฏิเสธ: {{title}}'
    ),
    jsonb_build_object(
        'en',
'{{decided_by}} at {{customer_name}} declined:

  {{title}}

Reason: {{reason}}

Decided: {{decided_at}}
Open the ticket to revise and re-send: {{subject_url}}

— F2 Platform',
        'th',
'{{decided_by}} จาก {{customer_name}} ได้ปฏิเสธ:

  {{title}}

เหตุผล: {{reason}}

เวลาที่ตัดสินใจ: {{decided_at}}
เปิดตั๋วเพื่อแก้ไขและส่งใหม่: {{subject_url}}

— F2 Platform'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;
