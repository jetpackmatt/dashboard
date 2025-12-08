-- Migration 013: Add jetpack_invoice_id to invoices_sb table
-- The correct table for ShipBob invoices is invoices_sb (not invoices_shipbob)
-- This column tracks which Jetpack invoice processed each ShipBob invoice

ALTER TABLE invoices_sb
ADD COLUMN IF NOT EXISTS jetpack_invoice_id TEXT;

-- Index for fast lookup of unprocessed invoices
CREATE INDEX IF NOT EXISTS idx_invoices_sb_jetpack_invoice_id
ON invoices_sb(jetpack_invoice_id)
WHERE jetpack_invoice_id IS NULL;

COMMENT ON COLUMN invoices_sb.jetpack_invoice_id IS 'Jetpack invoice number(s) that processed this ShipBob invoice. NULL = not yet processed. e.g., "JPHS-0037-120125, JPML-0021-120125"';
