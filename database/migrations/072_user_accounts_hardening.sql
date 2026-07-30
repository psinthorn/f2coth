-- 072_user_accounts_hardening.sql
-- Follow-up hardening for the portal user-account module (071), from code review.
--
--   1. customer_refresh_tokens.active_customer_id — binds the active org to the
--      refresh token so a transparent token refresh preserves a switch-org
--      instead of silently reverting to the primary org.
--   2. contact_org_memberships.disabled_at — per-org disable. Disabling a
--      person from one org must NOT lock them out of their other orgs.
--      (customer_contacts.disabled_at stays as a global kill-switch.)
--   3. Humanize the verification-link TTL in the two email templates
--      (was rendering "expires in 1440 minutes").
--
-- Idempotent. Next migration: 073_*.sql

-- ─────────────────────────────────────────────
-- 1. Active-org binding on the refresh token
-- ─────────────────────────────────────────────
ALTER TABLE customer_refresh_tokens
    ADD COLUMN IF NOT EXISTS active_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- 2. Per-org membership disable
-- ─────────────────────────────────────────────
ALTER TABLE contact_org_memberships
    ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;

-- ─────────────────────────────────────────────
-- 3. Templates: render TTL as hours, not raw minutes.
--    Uses {{ttl_hours}} now (senders pass ttl_hours=24).
-- ─────────────────────────────────────────────
UPDATE notification_templates SET body_tmpl = jsonb_build_object(
    'en',
'Hi {{full_name}},

An F2 Portal account has been created for you at {{org_name}}.

  Username: {{email}}
  Temporary password: {{temp_password}}

Log in here and you will be asked to change your password right away:

{{login_url}}

Please also verify your email address using the link below (it expires in {{ttl_hours}} hours):

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

กรุณายืนยันอีเมลของคุณผ่านลิงก์ด้านล่างด้วย (ลิงก์จะหมดอายุใน {{ttl_hours}} ชั่วโมง):

{{verify_url}}

หากคุณไม่ได้คาดหมายอีเมลนี้ สามารถละเว้นได้

— F2 Co., Ltd.'
) WHERE code = 'contact_invite_customer';

UPDATE notification_templates SET body_tmpl = jsonb_build_object(
    'en',
'Hi {{full_name}},

Please verify your email address for your F2 Portal account using the link below. It expires in {{ttl_hours}} hours and can only be used once.

{{verify_url}}

If you didn''t request this, ignore this email.

— F2 Co., Ltd.',
    'th',
'สวัสดี {{full_name}}

กรุณายืนยันอีเมลสำหรับบัญชี F2 Portal ของคุณผ่านลิงก์ด้านล่าง ลิงก์จะหมดอายุใน {{ttl_hours}} ชั่วโมง และใช้ได้เพียงครั้งเดียว

{{verify_url}}

หากคุณไม่ได้เป็นผู้ขอ ให้ละเว้นอีเมลนี้

— F2 Co., Ltd.'
) WHERE code = 'email_verification_customer';
