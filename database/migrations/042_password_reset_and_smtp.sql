-- 042_password_reset_and_smtp.sql
-- Three related bits of platform plumbing:
--
--   1. password_resets — token-based password reset for both staff (users)
--      and customer contacts (customer_contacts). One table, one nullable
--      FK per identity type, exclusive-or constraint. Tokens are stored
--      as SHA-256 hashes so a DB dump can't reset accounts.
--   2. smtp_settings — singleton config row so ops can edit SMTP creds
--      from the admin UI instead of shelling into the compose .env.
--   3. Notification templates for the two reset emails + module toggle
--      for the new admin settings page.
--
-- Idempotent throughout: ON CONFLICT DO NOTHING on modules + templates,
-- ON CONFLICT DO NOTHING on the singleton smtp row.
--
-- Next migration: 043_*.sql

-- ─────────────────────────────────────────────
-- 1. password_resets
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_resets (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
    contact_id  UUID        REFERENCES customer_contacts(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- exactly one identity type per row
    CHECK ((user_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id    ON password_resets(user_id)    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_password_resets_contact_id ON password_resets(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_password_resets_expires    ON password_resets(expires_at);

-- ─────────────────────────────────────────────
-- 2. smtp_settings — singleton (id=1)
--    password stored in plaintext for v1; a follow-up migration should
--    move it to pgcrypto once we pick a key-management story. Until then,
--    access is gated to admin role at the API layer.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS smtp_settings (
    id          INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    host        TEXT        NOT NULL DEFAULT '',
    port        INT         NOT NULL DEFAULT 587,
    username    TEXT        NOT NULL DEFAULT '',
    password    TEXT        NOT NULL DEFAULT '',
    from_address TEXT       NOT NULL DEFAULT 'F2 Co., Ltd. <info@f2.co.th>',
    tls_mode    TEXT        NOT NULL DEFAULT 'starttls'
                            CHECK (tls_mode IN ('none','starttls','tls')),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID        REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO smtp_settings (id, host, port, username, password, from_address)
VALUES (1, '', 587, '', '', 'F2 Co., Ltd. <info@f2.co.th>')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE TRIGGER trg_smtp_settings_updated_at
    BEFORE UPDATE ON smtp_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- 3. Notification templates for password reset
--    Two templates — staff email links to /admin/login/reset/{token},
--    customer email links to /portal/login/reset/{token}.
-- ─────────────────────────────────────────────
INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'password_reset_staff',
    'Password reset link for a staff (users) account',
    jsonb_build_object(
        'en', '[F2] Reset your password',
        'th', '[F2] รีเซ็ตรหัสผ่านของคุณ'
    ),
    jsonb_build_object(
        'en',
'Hi {{full_name}},

Someone (hopefully you) requested a password reset for {{email}}.

Reset your password using the link below. It expires in {{ttl_minutes}} minutes and can only be used once.

{{reset_url}}

If you didn''t request this, ignore this email — your password stays the same.

— F2 Co., Ltd.',
        'th',
'สวัสดี {{full_name}}

มีผู้ (หวังว่าจะเป็นคุณ) ขอรีเซ็ตรหัสผ่านสำหรับ {{email}}

ตั้งรหัสผ่านใหม่ผ่านลิงก์ด้านล่าง ลิงก์จะหมดอายุใน {{ttl_minutes}} นาที และใช้ได้เพียงครั้งเดียว

{{reset_url}}

หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลนี้ รหัสผ่านของคุณจะไม่เปลี่ยนแปลง

— F2 Co., Ltd.'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;

INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'password_reset_customer',
    'Password reset link for a customer_contacts account (portal login)',
    jsonb_build_object(
        'en', '[F2 Portal] Reset your password',
        'th', '[F2 Portal] รีเซ็ตรหัสผ่านของคุณ'
    ),
    jsonb_build_object(
        'en',
'Hi {{full_name}},

Someone requested a password reset for your F2 Portal account ({{email}}).

Reset your password using the link below. It expires in {{ttl_minutes}} minutes and can only be used once.

{{reset_url}}

If you didn''t request this, ignore this email.

— F2 Co., Ltd.',
        'th',
'สวัสดี {{full_name}}

มีผู้ขอรีเซ็ตรหัสผ่านสำหรับบัญชี F2 Portal ของคุณ ({{email}})

ตั้งรหัสผ่านใหม่ผ่านลิงก์ด้านล่าง ลิงก์จะหมดอายุใน {{ttl_minutes}} นาที และใช้ได้เพียงครั้งเดียว

{{reset_url}}

หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลนี้

— F2 Co., Ltd.'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────
-- 4. Module registry — admin SMTP settings page
-- ─────────────────────────────────────────────
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order)
VALUES ('admin.smtp_settings', 'admin', 'SMTP settings', 'การตั้งค่า SMTP',
        'Email server credentials + test-send', true, false, 130)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────
-- 5. Miskawaan contact email fix
--    Owner asked for the shorter domain; identity fields update in the
--    same migration so the reset flow immediately targets the new address.
-- ─────────────────────────────────────────────
UPDATE customer_contacts
   SET email = 'admin@miskawaan.com'
 WHERE email = 'admin@miskawaanvillas.com';
