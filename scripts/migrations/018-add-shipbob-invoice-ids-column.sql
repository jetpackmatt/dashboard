-- Migration 018: Add shipbob_invoice_ids and line_items_json columns to invoices_jetpack
--
-- This refactors the invoice workflow:
-- 1. shipbob_invoice_ids: Stores which ShipBob invoices are included (for regeneration)
-- 2. line_items_json: Stores the calculated line items with markup data (for approval)
--
-- New workflow:
-- - Generate: Calculate markups, store line_items_json, generate files
-- - Review: Admin reviews PDF/XLS (which match line_items_json)
-- - Approve: Read line_items_json, mark transactions with those exact amounts
--
-- This ensures what gets approved is EXACTLY what was generated and reviewed.

-- Add shipbob_invoice_ids column (array of SB invoice IDs)
ALTER TABLE invoices_jetpack
ADD COLUMN IF NOT EXISTS shipbob_invoice_ids JSONB DEFAULT '[]'::jsonb;

-- Add line_items_json column (cached calculated line items with markup data)
ALTER TABLE invoices_jetpack
ADD COLUMN IF NOT EXISTS line_items_json JSONB;

-- Add comments for documentation
COMMENT ON COLUMN invoices_jetpack.shipbob_invoice_ids IS
'Array of ShipBob invoice IDs that are the source for this Jetpack invoice. Stored at generation time, used for regeneration.';

COMMENT ON COLUMN invoices_jetpack.line_items_json IS
'Cached line items with all markup calculations. Stored at generation time, used at approval to mark transactions. Ensures approved amounts match generated files exactly.';

-- Index for potential queries
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_shipbob_invoice_ids
ON invoices_jetpack USING GIN (shipbob_invoice_ids);
