-- Migration 016: Change invoice_id_jp from UUID to TEXT
-- Purpose: Allow human-readable invoice numbers like "JPHS-0001-032425" instead of UUIDs
-- Run in Supabase SQL Editor

-- Step 1: Alter column type from UUID to TEXT
ALTER TABLE transactions
ALTER COLUMN invoice_id_jp TYPE TEXT
USING invoice_id_jp::TEXT;

-- Step 2: Add a comment documenting the change
COMMENT ON COLUMN transactions.invoice_id_jp IS 'Human-readable Jetpack invoice number (e.g., JPHS-0001-032425). Changed from UUID to TEXT on 2025-12-07.';

-- Verify the change
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name = 'invoice_id_jp';
