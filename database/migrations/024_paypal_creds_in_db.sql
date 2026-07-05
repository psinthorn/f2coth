-- 024_paypal_creds_in_db.sql
-- Move PayPal credentials from environment variables into
-- payment_methods_config.config so they can be edited through the admin
-- UI. Credentials live in two nested objects — one per environment —
-- and both can be populated independently of which mode is active:
--
--   {
--     "sandbox": { "client_id":"", "client_secret":"", "webhook_id":"",
--                  "merchant_email":"" },
--     "live":    { "client_id":"", "client_secret":"", "webhook_id":"",
--                  "merchant_email":"" }
--   }
--
-- The application layer redacts `client_secret` on every read — the GET
-- endpoint returns `client_secret_set: bool` instead of the value. PUT
-- treats an empty/missing `client_secret` as "preserve existing", so
-- admins can edit the other fields without re-entering the secret.
--
-- Next migration: 025_*.sql

BEGIN;

UPDATE payment_methods_config
   SET config = jsonb_build_object(
       'sandbox', jsonb_build_object(
           'client_id',      COALESCE(config->>'client_id_public', ''),
           'client_secret',  '',
           'webhook_id',     '',
           'merchant_email', COALESCE(config->>'merchant_email', '')
       ),
       'live', jsonb_build_object(
           'client_id',      '',
           'client_secret',  '',
           'webhook_id',     '',
           'merchant_email', ''
       )
   )
 WHERE method = 'paypal';

COMMIT;
