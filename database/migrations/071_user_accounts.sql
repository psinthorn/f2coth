-- 071_user_accounts.sql
-- Portal user (customer_contacts) account lifecycle.
--
-- Extends the existing customer_contacts identity — NOT a new user system.
-- Reuses the password_resets token primitive (042) by adding a `purpose`
-- column so one hashed-token table serves reset / activation / verification.
--
-- Adds:
--   1. customer_contacts lifecycle + profile columns
--   2. password_resets.purpose (reset | activation | verification)
--   3. contact_org_memberships — a person (one email) may belong to many
--      orgs. The existing customer_contacts.customer_id stays as the
--      "primary/home" org; extra orgs live here. Backfilled from existing rows.
--   4. portal_settings singleton — require_email_verification toggle
--   5. Two notification templates: invite (login instructions) + verify email
--   6. Module registry key: portal.user_accounts
--
-- Idempotent throughout (IF NOT EXISTS, ON CONFLICT DO NOTHING).
--
-- Next migration: 072_*.sql

-- ─────────────────────────────────────────────
-- 1. customer_contacts — lifecycle + profile
--    password_hash stays NOT NULL: an admin-created account always gets a
--    generated temp password, and must_change_password forces a change on
--    first login. email_verified_at is independent of active/disabled.
-- ─────────────────────────────────────────────
ALTER TABLE customer_contacts
    ADD COLUMN IF NOT EXISTS email_verified_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS invited_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS activated_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS phone                TEXT,
    ADD COLUMN IF NOT EXISTS job_title            TEXT;

-- ─────────────────────────────────────────────
-- 2. password_resets.purpose — one token primitive for all email links.
--    Existing rows are password resets, hence the default.
-- ─────────────────────────────────────────────
ALTER TABLE password_resets
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'reset'
        CHECK (purpose IN ('reset','activation','verification'));

-- ─────────────────────────────────────────────
-- 3. contact_org_memberships — many orgs per person.
--    role lives on the membership (a person may be owner of one org and
--    member of another). Global-unique customer_contacts.email is the join
--    key: inviting an existing email under a new org adds a membership.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_org_memberships (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id   UUID        NOT NULL REFERENCES customer_contacts(id) ON DELETE CASCADE,
    customer_id  UUID        NOT NULL REFERENCES customers(id)         ON DELETE CASCADE,
    role         TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
    is_primary   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_org_memberships_contact  ON contact_org_memberships(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_org_memberships_customer ON contact_org_memberships(customer_id);

-- Backfill: one primary membership per existing contact from its home org.
INSERT INTO contact_org_memberships (contact_id, customer_id, role, is_primary)
SELECT id, customer_id, role, TRUE
  FROM customer_contacts
ON CONFLICT (contact_id, customer_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- 4. portal_settings — singleton (id=1)
--    require_email_verification: when TRUE, unverified users can still log in
--    but sensitive actions (create ticket / reply) are blocked until verified.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_settings (
    id                         INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    require_email_verification BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by                 UUID        REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO portal_settings (id, require_email_verification)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE TRIGGER trg_portal_settings_updated_at
    BEFORE UPDATE ON portal_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 5. Notification templates
--    contact_invite_customer  — login instructions: username + temp password
--                               + change-password notice + verify link.
--    email_verification_customer — standalone verify link (resend / self-request).
--    Customer links target /portal/*.
-- ─────────────────────────────────────────────
INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'contact_invite_customer',
    'Login instructions for a newly created portal user (temp password + verify link)',
    jsonb_build_object(
        'en', '[F2 Portal] Your account is ready',
        'th', '[F2 Portal] บัญชีของคุณพร้อมใช้งานแล้ว'
    ),
    jsonb_build_object(
        'en',
'Hi {{full_name}},

An F2 Portal account has been created for you at {{org_name}}.

  Username: {{email}}
  Temporary password: {{temp_password}}

Log in here and you will be asked to change your password right away:

{{login_url}}

Please also verify your email address using the link below (it expires in {{ttl_minutes}} minutes):

{{verify_url}}

If you weren''t expecting this, you can ignore this email.

— F2 Co., Ltd.',
        'th',
'สวัสดี {{full_name}}

มีการสร้างบัญชี F2 Portal ให้คุณภายใต้ {{org_name}}

  ชื่อผู้ใช้: {{email}}
  รหัสผ่านชั่วคราว: {{temp_password}}

เข้าสู่ระบบที่นี่ และระบบจะให้คุณเปลี่ยนรหัสผ่านทันที:

{{login_url}}

กรุณายืนยันอีเมลของคุณผ่านลิงก์ด้านล่างด้วย (ลิงก์จะหมดอายุใน {{ttl_minutes}} นาที):

{{verify_url}}

หากคุณไม่ได้คาดหมายอีเมลนี้ สามารถละเว้นได้

— F2 Co., Ltd.'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'email_verification_customer',
    'Standalone email-verification link for a portal user',
    jsonb_build_object(
        'en', '[F2 Portal] Verify your email',
        'th', '[F2 Portal] ยืนยันอีเมลของคุณ'
    ),
    jsonb_build_object(
        'en',
'Hi {{full_name}},

Please verify your email address for your F2 Portal account using the link below. It expires in {{ttl_minutes}} minutes and can only be used once.

{{verify_url}}

If you didn''t request this, ignore this email.

— F2 Co., Ltd.',
        'th',
'สวัสดี {{full_name}}

กรุณายืนยันอีเมลสำหรับบัญชี F2 Portal ของคุณผ่านลิงก์ด้านล่าง ลิงก์จะหมดอายุใน {{ttl_minutes}} นาที และใช้ได้เพียงครั้งเดียว

{{verify_url}}

หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลนี้

— F2 Co., Ltd.'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- 6. Module registry — portal user accounts feature
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order)
VALUES ('portal.user_accounts', 'portal', 'User accounts', 'บัญชีผู้ใช้',
        'Portal user invite, activation, email verification + org membership', true, false, 140)
ON CONFLICT (key) DO NOTHING;
