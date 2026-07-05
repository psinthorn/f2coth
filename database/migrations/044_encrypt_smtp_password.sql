-- 044_encrypt_smtp_password.sql
-- Encrypt smtp_settings.password at rest.
--
-- v1 shipped in 042 stored the SMTP password in plaintext with admin-role
-- gating at the API layer as the only barrier. That's fine for a small
-- team but leaks under: DB dump on a laptop, replica read-access, or a
-- SQL-injection-style bypass. Encrypting-at-rest with a symmetric key
-- from env raises the bar meaningfully without adding new infra.
--
-- Design:
--   • pgcrypto's pgp_sym_encrypt/decrypt. Key comes from
--     current_setting('app.smtp_crypt_key') — notification-api sets it
--     once per connection with SET LOCAL before touching the row.
--   • Column type changes from TEXT to BYTEA to hold ciphertext.
--   • Existing plaintext value is encrypted in-place inside the same
--     migration transaction using the current key (fallback: if the key
--     isn't set at migration time, the row is left empty; admin needs
--     to re-enter through the UI on first prod run).
--
-- Rollback: pgp_sym_decrypt against the old column would recover the
-- plaintext. Since we're pre-prod, the pragmatic rollback is to drop
-- the column and re-run 042; no restore needed.
--
-- Next migration: 045_*.sql

-- Add BYTEA column alongside the existing TEXT one.
ALTER TABLE smtp_settings
    ADD COLUMN IF NOT EXISTS password_enc BYTEA;

-- One-shot encrypt of any existing plaintext. Guarded on the
-- `app.smtp_crypt_key` setting being present — safe to run before the
-- env var is wired (leaves the column NULL, admin re-enters via UI).
DO $$
DECLARE
    k TEXT;
BEGIN
    BEGIN
        k := current_setting('app.smtp_crypt_key');
    EXCEPTION WHEN OTHERS THEN
        k := '';
    END;
    IF k <> '' THEN
        UPDATE smtp_settings
           SET password_enc = pgp_sym_encrypt(password, k)
         WHERE password IS NOT NULL AND password <> ''
           AND password_enc IS NULL;
    END IF;
END $$;

-- Drop the plaintext column. From this migration onward, notification-api
-- reads/writes through pgp_sym_encrypt/decrypt exclusively.
ALTER TABLE smtp_settings DROP COLUMN password;
