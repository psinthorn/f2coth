-- 026_payment_slip_files.sql
-- Real slip uploads. Until now portal users had to host the image
-- themselves and paste a URL — terrible UX. This migration adds a small
-- in-DB store so customers can drag-and-drop a screenshot/PDF straight
-- from the pay screen.
--
-- File size is capped at 5 MB by the application layer. We keep the
-- bytea inline (vs S3) because:
--   1. Volumes are small (a few hundred per month, ~500 KB each).
--   2. Slip files are audit evidence — atomic with the payment row.
--   3. F2 is currently single-region; no CDN to optimise for.
--
-- payments.slip_url now stores `/api/payment/slips/{file_id}` for new
-- uploads. Legacy rows that already have an off-site URL continue to
-- work — slip_url is opaque to the rest of the system.
--
-- Next migration: 027_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS payment_slip_files (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID         REFERENCES payments(id) ON DELETE SET NULL,
    customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    filename   TEXT         NOT NULL,
    mime_type  TEXT         NOT NULL,
    size_bytes INT          NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    sha256     TEXT,
    content    BYTEA        NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slip_files_payment  ON payment_slip_files (payment_id);
CREATE INDEX IF NOT EXISTS idx_slip_files_customer ON payment_slip_files (customer_id, uploaded_at DESC);

COMMIT;
