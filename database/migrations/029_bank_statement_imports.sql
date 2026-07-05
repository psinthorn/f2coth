-- 029_bank_statement_imports.sql
-- Bank-statement reconciliation: admins paste/upload a CSV from their
-- bank's online portal, the system parses each line and proposes
-- matches against pending bank_transfer payments. Admins review the
-- matches and click "Apply" to verify them in bulk — which is much
-- faster than verifying slips one by one.
--
-- We support a single normalised CSV shape:
--
--   transferred_at, amount_thb, bank_ref, description
--
-- with a permissive header (any spelling/order). Admins who only have
-- their raw bank export (SCB / Kasikorn / BBL / etc.) normalise in
-- Excel first — building per-bank parsers is the next step but is
-- out of scope for this migration.
--
-- Matching heuristic (handler):
--   • exact amount_cents match against payments in 'awaiting_verification'
--   • +/- 3-day window on transferred_at vs payment.transferred_at
--     (or created_at if transferred_at is null)
--   • prefer rows whose bank_ref appears in payment.bank_ref or in
--     payment_slip_files.filename (substring match)
--
-- Next migration: 030_*.sql

BEGIN;

CREATE TABLE IF NOT EXISTS bank_statement_imports (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
    source_name     TEXT,                                    -- admin-supplied label e.g. "Kasikorn Jan 2026"
    raw_filename    TEXT,
    status          TEXT         NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'applied', 'discarded')),
    parsed_rows     INT          NOT NULL DEFAULT 0,
    matched_rows    INT          NOT NULL DEFAULT 0,
    applied_rows    INT          NOT NULL DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    applied_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bank_imports_status ON bank_statement_imports (status, created_at DESC);

CREATE OR REPLACE TRIGGER set_bank_statement_imports_updated_at
    BEFORE UPDATE ON bank_statement_imports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS bank_statement_rows (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id       UUID         NOT NULL REFERENCES bank_statement_imports(id) ON DELETE CASCADE,
    line_number     INT          NOT NULL,
    transferred_at  TIMESTAMPTZ  NOT NULL,
    amount_cents    BIGINT       NOT NULL,
    bank_ref        TEXT,
    description     TEXT,
    -- Proposed or applied match
    matched_payment_id UUID      REFERENCES payments(id) ON DELETE SET NULL,
    match_status    TEXT         NOT NULL DEFAULT 'unmatched'
                                 CHECK (match_status IN ('unmatched', 'proposed', 'applied', 'skipped')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_rows_import ON bank_statement_rows (import_id, line_number);
CREATE INDEX IF NOT EXISTS idx_bank_rows_payment ON bank_statement_rows (matched_payment_id)
    WHERE matched_payment_id IS NOT NULL;

-- Register module
INSERT INTO modules (key, area, name_en, name_th, description, enabled, core, sort_order) VALUES
('admin.bank_imports', 'admin', 'Bank reconciliation', 'กระทบยอดธนาคาร',
 'Upload bank statement CSV and auto-match transfers to pending payments', true, false, 70)
ON CONFLICT (key) DO NOTHING;

COMMIT;
