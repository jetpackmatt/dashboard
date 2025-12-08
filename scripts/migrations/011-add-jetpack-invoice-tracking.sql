-- Migration 011: Add Jetpack Invoice Tracking to ShipBob Invoices
-- Date: December 6, 2025
-- Description: Links ShipBob invoices to Jetpack invoices for tracking which have been processed

-- ============================================
-- 1. Add jetpack_invoice_id column to invoices_shipbob
-- ============================================
ALTER TABLE invoices_shipbob
ADD COLUMN IF NOT EXISTS jetpack_invoice_id UUID REFERENCES invoices_jetpack(id);

-- Index for efficient lookup of unprocessed invoices
CREATE INDEX IF NOT EXISTS idx_invoices_shipbob_jetpack_invoice_id
ON invoices_shipbob(jetpack_invoice_id);

-- Index for finding unprocessed invoices per client
CREATE INDEX IF NOT EXISTS idx_invoices_shipbob_unprocessed
ON invoices_shipbob(client_id, jetpack_invoice_id)
WHERE jetpack_invoice_id IS NULL;

-- ============================================
-- 2. Add comment explaining the relationship
-- ============================================
COMMENT ON COLUMN invoices_shipbob.jetpack_invoice_id IS
'Links this ShipBob invoice to the Jetpack invoice that processed it. NULL = not yet processed.';

-- ============================================
-- Done!
-- ============================================
