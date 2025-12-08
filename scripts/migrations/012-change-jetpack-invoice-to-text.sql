-- Migration 012: Change jetpack_invoice_id from UUID to TEXT
-- Date: December 6, 2025
-- Description: Store invoice_number directly instead of UUID reference
--              More human-readable and eliminates unnecessary indirection

-- ============================================
-- 1. Drop the foreign key constraint first
-- ============================================
ALTER TABLE invoices_shipbob
DROP CONSTRAINT IF EXISTS invoices_shipbob_jetpack_invoice_id_fkey;

-- ============================================
-- 2. Change column type from UUID to TEXT
-- ============================================
ALTER TABLE invoices_shipbob
ALTER COLUMN jetpack_invoice_id TYPE TEXT;

-- ============================================
-- 3. Update comment
-- ============================================
COMMENT ON COLUMN invoices_shipbob.jetpack_invoice_id IS
'Invoice number (e.g., JPHS-0037-120225) that processed this ShipBob invoice. NULL = not yet processed.';

-- ============================================
-- Done!
-- ============================================
