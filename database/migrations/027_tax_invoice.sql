-- 027_tax_invoice.sql
-- Thai tax-invoice fields. Thailand's Revenue Department requires that
-- a "ใบกำกับภาษี" (tax invoice) carry:
--   • Buyer's name + address + tax_id (เลขประจำตัวผู้เสียภาษี)
--   • Branch code (สำนักงานใหญ่ / 5-digit branch number)
--   • Seller's name + address + tax_id
--   • Document number, issue date
--   • Itemised goods/services with VAT calculation
--
-- The seller info is constant for F2 (configured in code). The buyer
-- info is per-customer — we add a billing profile table so admins can
-- maintain it without bloating the customers table.
--
-- invoices gains a `doc_type` column so the same invoice row can be
-- rendered as quotation / invoice / receipt / tax_invoice depending on
-- workflow stage, and `billing_snapshot` JSONB so a tax invoice's buyer
-- details are frozen at issue time (compliance — invoices must reflect
-- the customer's data as it was when the document was issued, even if
-- the customer later changes name/address).
--
-- Next migration: 028_*.sql

BEGIN;

-- ---------- customer_billing_profiles ----------
CREATE TABLE IF NOT EXISTS customer_billing_profiles (
    customer_id  UUID         PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    legal_name   TEXT         NOT NULL,
    tax_id       TEXT,                                   -- 13-digit Thai tax ID
    branch_code  TEXT         NOT NULL DEFAULT '00000',  -- HQ default
    address_line1 TEXT,
    address_line2 TEXT,
    subdistrict  TEXT,                                   -- ตำบล/แขวง
    district     TEXT,                                   -- อำเภอ/เขต
    province     TEXT,                                   -- จังหวัด
    postal_code  TEXT,
    country      TEXT         NOT NULL DEFAULT 'TH',
    billing_email TEXT,                                  -- override of primary contact
    notes        TEXT,
    updated_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER set_customer_billing_profiles_updated_at
    BEFORE UPDATE ON customer_billing_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- invoices: doc_type + billing snapshot ----------
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'invoice'
        CHECK (doc_type IN ('quotation', 'invoice', 'tax_invoice', 'receipt')),
    ADD COLUMN IF NOT EXISTS billing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index for quickly filtering tax invoices for revenue reports.
CREATE INDEX IF NOT EXISTS idx_invoices_doc_type ON invoices (doc_type, issue_date DESC);

COMMIT;
