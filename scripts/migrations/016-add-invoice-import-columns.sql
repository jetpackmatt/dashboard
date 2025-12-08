-- Migration: Add import tracking columns to invoices_jetpack
-- Date: 2025-12-07
-- Purpose: Track imported historical invoices and their source

ALTER TABLE invoices_jetpack
ADD COLUMN IF NOT EXISTS import_source TEXT,
ADD COLUMN IF NOT EXISTS import_notes JSONB;

-- Add comment for documentation
COMMENT ON COLUMN invoices_jetpack.import_source IS 'Source of invoice: generated, xlsx_import, recalculated';
COMMENT ON COLUMN invoices_jetpack.import_notes IS 'JSON notes about import: source file, category totals, discrepancies';
