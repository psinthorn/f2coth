-- 056_bank_accounts_multi.sql
-- Bank transfer used to hold a single bank in payment_methods_config.config:
--   { "bank_name","account_name","account_number","branch","swift" }
-- Move to a list so F2 can offer several banks, each independently
-- enabled, and shown to customers on the portal pay screen:
--   { "banks": [ { id, bank_code, bank_name, account_name,
--                  account_number, branch, swift, enabled }, ... ] }
--
-- Idempotent: only rewrites the row while it is still in the old flat
-- shape (no `banks` key). The existing single bank becomes the first,
-- enabled entry so nothing is lost.
--
-- Next migration: 057_*.sql

BEGIN;

UPDATE payment_methods_config
   SET config = jsonb_build_object(
       'banks', jsonb_build_array(
           jsonb_build_object(
               'id',             gen_random_uuid()::text,
               'bank_code',      COALESCE(config->>'bank_code', ''),
               'bank_name',      COALESCE(config->>'bank_name', ''),
               'account_name',   COALESCE(config->>'account_name', ''),
               'account_number', COALESCE(config->>'account_number', ''),
               'branch',         COALESCE(config->>'branch', ''),
               'swift',          COALESCE(config->>'swift', ''),
               'enabled',        true
           )
       )
   )
 WHERE method = 'bank_transfer'
   AND NOT (config ? 'banks');

COMMIT;
