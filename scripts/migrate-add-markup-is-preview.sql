-- Migration: Add markup_is_preview column to transactions table
-- Purpose: Track whether markup values are preview (pre-invoice) or final (invoice-approved)
--
-- Values:
--   NULL  = no markup calculated yet (show "-" in UI)
--   TRUE  = preview markup (calculated before invoicing)
--   FALSE = final (invoice-approved, authoritative)

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS markup_is_preview BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN transactions.markup_is_preview IS
  'NULL = no markup calculated, TRUE = preview (pre-invoice), FALSE = final (invoice approved)';
