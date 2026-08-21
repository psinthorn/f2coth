-- 081_magic_link.sql
-- ─────────────────────────────────────────────
-- Passwordless "magic link" sign-in for portal users. Reuses the password_resets
-- token table with a new purpose='magic' (single-use, short TTL). A verified link
-- proves email possession and issues a session (MFA still applies if enrolled).
--
-- Next migration: 082_*.sql
-- ─────────────────────────────────────────────

ALTER TABLE password_resets DROP CONSTRAINT IF EXISTS password_resets_purpose_check;
ALTER TABLE password_resets
    ADD CONSTRAINT password_resets_purpose_check
    CHECK (purpose IN ('reset','activation','verification','magic'));

INSERT INTO notification_templates (code, description, subject_tmpl, body_tmpl, is_active)
VALUES (
    'magic_link_customer',
    'Passwordless sign-in link for a portal user',
    jsonb_build_object(
        'en', '[F2 Portal] Your sign-in link',
        'th', '[F2 Portal] ลิงก์เข้าสู่ระบบของคุณ'
    ),
    jsonb_build_object(
        'en',
'Hi {{full_name}},

Click the link below to sign in to your F2 Portal account. It expires in {{ttl_minutes}} minutes and can only be used once.

{{login_url}}

If you didn''t request this, you can safely ignore this email.

— F2 Co., Ltd.',
        'th',
'สวัสดี {{full_name}}

คลิกลิงก์ด้านล่างเพื่อเข้าสู่ระบบบัญชี F2 Portal ของคุณ ลิงก์จะหมดอายุใน {{ttl_minutes}} นาที และใช้ได้เพียงครั้งเดียว

{{login_url}}

หากคุณไม่ได้เป็นผู้ขอ สามารถละเว้นอีเมลนี้ได้

— F2 Co., Ltd.'
    ),
    TRUE
) ON CONFLICT (code) DO NOTHING;
