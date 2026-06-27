-- 017_dsr_verification.sql
-- PDPA s.30 requires reasonable verification of the data subject's identity
-- before a Data Subject Request is processed. Without it, anyone can submit a
-- request against any email address — exposing victims to spam ACK emails and,
-- worse, exposing F2 staff to triggering erasure of someone else's data.
--
-- This migration adds an email-confirmation step (double opt-in):
--
--   1. POST /api/privacy/dsr stores the request with status='unverified'
--      and a one-time hashed token; a verification email goes to the
--      requester only (no staff alert yet).
--   2. The requester clicks the link → GET /api/privacy/dsr/verify?token=…
--      flips status to 'pending', records verified_at, clears the token,
--      and only then fires the ACK + staff alert.
--   3. Tokens expire after 7 days; unverified requests can be safely pruned.
--
-- Next migration: 018_*.sql

-- ---------- columns ----------
ALTER TABLE data_subject_requests
    ADD COLUMN IF NOT EXISTS verification_token_hash  TEXT,
    ADD COLUMN IF NOT EXISTS verification_expires_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_at              TIMESTAMPTZ;

-- Partial unique index: only enforces uniqueness while a token is live,
-- so cleared (NULL) tokens after verification do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dsr_verification_token
    ON data_subject_requests (verification_token_hash)
    WHERE verification_token_hash IS NOT NULL;

-- ---------- status: allow 'unverified' and make it the new default ----------
ALTER TABLE data_subject_requests
    DROP CONSTRAINT IF EXISTS data_subject_requests_status_check;

ALTER TABLE data_subject_requests
    ADD CONSTRAINT data_subject_requests_status_check
        CHECK (status IN (
            'unverified',     -- submitted, awaiting requester email confirmation
            'pending',        -- verified, in admin queue
            'in_progress',    -- assigned to staff
            'completed',      -- fulfilled within 30-day PDPA deadline
            'rejected',       -- with documented reason
            'withdrawn'       -- requester withdrew
        ));

ALTER TABLE data_subject_requests
    ALTER COLUMN status SET DEFAULT 'unverified';

-- Backfill: any pre-existing rows in 'pending' from before verification
-- existed are grandfathered as already-verified (no point asking historic
-- submitters to re-confirm).
UPDATE data_subject_requests
   SET verified_at = COALESCE(verified_at, created_at)
 WHERE status <> 'unverified'
   AND verified_at IS NULL;

-- Partial index for the staff queue — exclude unverified by default.
CREATE INDEX IF NOT EXISTS idx_dsr_queue
    ON data_subject_requests (due_date, created_at)
    WHERE status IN ('pending', 'in_progress');

-- ---------- notification template: verification email ----------
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description)
VALUES
(
    'dsr_verify_email',
    '{"en": "Please confirm your data request — F2 Co., Ltd.", "th": "กรุณายืนยันคำขอข้อมูลของท่าน — บริษัท เอฟทู จำกัด"}',
    E'{"en": "Dear {{name}},\\n\\nWe received a {{request_type}} request submitted under your email address.\\n\\nTo prevent fraudulent requests, please confirm by clicking the link below within 7 days:\\n\\n{{verify_url}}\\n\\nIf you did not submit this request, you can safely ignore this email — no action will be taken.\\n\\nF2 Co., Ltd.\\nhttps://f2.co.th", "th": "เรียน คุณ{{name}}\\n\\nเราได้รับคำขอ{{request_type}}ที่ส่งภายใต้อีเมลของท่าน\\n\\nเพื่อป้องกันคำขอที่ไม่ได้รับอนุญาต กรุณายืนยันโดยคลิกลิงก์ด้านล่างภายใน 7 วัน:\\n\\n{{verify_url}}\\n\\nหากท่านไม่ได้ส่งคำขอนี้ ท่านสามารถไม่สนใจอีเมลนี้ได้ — เราจะไม่ดำเนินการใดๆ\\n\\nบริษัท เอฟทู จำกัด\\nhttps://f2.co.th"}',
    'Sent to a DSR submitter to confirm they own the email address before the request enters the staff queue.'
)
ON CONFLICT (code) DO UPDATE SET
    subject_tmpl = EXCLUDED.subject_tmpl,
    body_tmpl    = EXCLUDED.body_tmpl,
    description  = EXCLUDED.description,
    is_active    = TRUE;
