-- 059_domain_registrar_sync.sql
-- Phase 3 of recurring-renewal automation: registrar sync ("Domain Sync"
-- in WHMCS terms). A background worker in reseller-api polls the registrar
-- (ResellerClub) for each domain's authoritative expiry and writes it back
-- to customer_domains.expires_at — eliminating the manual step where staff
-- update the expiry date by hand after renewing.
--
-- Two new columns on customer_domains:
--   registry_order_id — the registrar's order/entity id for this domain,
--     resolved once via ResellerClub orderid.json and cached so later
--     syncs skip that lookup. NULL until first resolved.
--   last_synced_at    — last time the sync worker attempted this domain
--     (success OR unsupported/error). Drives batch rotation so the worker
--     cycles through all domains instead of re-hitting the same few.
--
-- Sync worker modes (RESELLER_SYNC_MODE): off (default — inert without
-- creds), notify (alert on drift, don't overwrite expiry), write (update
-- expires_at from the registry). See services/reseller-api/internal/syncer.
--
-- .th domains stay manual: THNIC has no wired API (EPP/mTLS), so the
-- adapter reports "unsupported" and the worker leaves those untouched.
--
-- Next migration: 060_*.sql

BEGIN;

ALTER TABLE customer_domains
    ADD COLUMN IF NOT EXISTS registry_order_id TEXT,
    ADD COLUMN IF NOT EXISTS last_synced_at    TIMESTAMPTZ;

-- Rotate the sync batch by staleness (oldest / never-synced first).
CREATE INDEX IF NOT EXISTS idx_customer_domains_sync
    ON customer_domains (last_synced_at NULLS FIRST);

-- Internal drift alert (notify mode) — registry expiry disagrees with our
-- stored value. Variables from the syncer:
--   {{domain}} {{customer_name}} {{stored_expiry}} {{registry_expiry}}
--   {{registry_status}} {{admin_link}}
INSERT INTO notification_templates (code, subject_tmpl, body_tmpl, description, is_active)
VALUES
('domain_sync_drift',
 jsonb_build_object(
     'en', '[F2 Billing] Domain expiry drift — {{domain}}',
     'th', '[F2 Billing] วันหมดอายุโดเมนไม่ตรงกัน — {{domain}}'
 ),
 jsonb_build_object(
     'en', E'The registrar reports a different expiry date than we have on file.\n\nDomain:          {{domain}}\nCustomer:        {{customer_name}}\nOur record:      {{stored_expiry}}\nRegistrar says:  {{registry_expiry}}\nRegistry status: {{registry_status}}\n\nSync is running in NOTIFY mode, so expires_at was NOT changed automatically. Review and update it in the admin console if the registrar is correct:\n{{admin_link}}\n\n(Switch RESELLER_SYNC_MODE to "write" to let the worker update expiry automatically.)\n\n— F2 domain sync',
     'th', E'ผู้รับจดทะเบียนรายงานวันหมดอายุไม่ตรงกับข้อมูลที่เรามี\n\nโดเมน:           {{domain}}\nลูกค้า:           {{customer_name}}\nข้อมูลของเรา:      {{stored_expiry}}\nผู้รับจดทะเบียน:    {{registry_expiry}}\nสถานะ registry:   {{registry_status}}\n\nการซิงค์ทำงานในโหมด NOTIFY จึงยังไม่เปลี่ยน expires_at อัตโนมัติ กรุณาตรวจสอบและอัปเดตในระบบแอดมินหากข้อมูลผู้รับจดทะเบียนถูกต้อง:\n{{admin_link}}\n\n(เปลี่ยน RESELLER_SYNC_MODE เป็น "write" เพื่อให้ระบบอัปเดตวันหมดอายุอัตโนมัติ)\n\n— F2 domain sync'
 ),
 'Internal alert sent when the registrar-reported expiry differs from customer_domains.expires_at while sync runs in notify mode. Recipient = BILLING_NOTIFY_TO.',
 true)
ON CONFLICT (code) DO NOTHING;

-- Register the feature for /admin/features visibility. The worker itself
-- is toggled via RESELLER_SYNC_MODE config, matching how the payment/
-- domain-renewal background passes are controlled.
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('api.domain_sync', 'api', 'Domain registrar sync', 'ซิงค์ผู้รับจดทะเบียนโดเมน',
 'Background: poll ResellerClub for authoritative domain expiry and update customer_domains', true, false, 112)
ON CONFLICT (key) DO NOTHING;

COMMIT;
