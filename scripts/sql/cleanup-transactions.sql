-- =============================================================
-- TRANSACTIONS TABLE CLEANUP SQL
-- Run these in Supabase SQL Editor for fast execution
-- =============================================================

-- Check current state before running
SELECT
  'Before Cleanup' as stage,
  COUNT(*) as total,
  COUNT(tracking_id) as has_tracking,
  COUNT(invoice_date_sb) as has_sb_date,
  COUNT(raw_data) as has_raw_data
FROM transactions;

-- =============================================================
-- STEP 1: Backfill tracking_id from additional_details.TrackingId
-- Expected: ~128,000 rows updated
-- =============================================================
UPDATE transactions
SET tracking_id = additional_details->>'TrackingId'
WHERE reference_type = 'Shipment'
  AND tracking_id IS NULL
  AND additional_details->>'TrackingId' IS NOT NULL
  AND additional_details->>'TrackingId' != '';

-- =============================================================
-- STEP 2: Backfill tracking_id from shipments table (remaining)
-- Expected: ~50,000+ rows updated
-- =============================================================
UPDATE transactions t
SET tracking_id = s.tracking_id
FROM shipments s
WHERE t.reference_type = 'Shipment'
  AND t.reference_id::bigint = s.shipment_id
  AND t.tracking_id IS NULL
  AND s.tracking_id IS NOT NULL;

-- =============================================================
-- STEP 3: Backfill invoice_date_sb from invoices_sb table
-- Expected: ~142,000 rows updated
-- =============================================================
UPDATE transactions t
SET invoice_date_sb = sb.invoice_date::date
FROM invoices_sb sb
WHERE t.invoice_id_sb::text = sb.shipbob_invoice_id
  AND t.invoice_date_sb IS NULL
  AND sb.invoice_date IS NOT NULL;

-- =============================================================
-- STEP 4: Drop raw_data column (only 50 records, never used properly)
-- =============================================================
ALTER TABLE transactions DROP COLUMN IF EXISTS raw_data;

-- =============================================================
-- STEP 5: Rename transaction_fee to fee_type for clarity
-- NOTE: Requires code changes too - see below
-- =============================================================
-- UNCOMMENT WHEN READY (after code changes):
-- ALTER TABLE transactions RENAME COLUMN transaction_fee TO fee_type;

-- =============================================================
-- Verify results
-- =============================================================
SELECT
  'After Cleanup' as stage,
  COUNT(*) as total,
  COUNT(tracking_id) as has_tracking,
  ROUND(COUNT(tracking_id)::numeric / COUNT(*)::numeric * 100, 1) as tracking_pct,
  COUNT(invoice_date_sb) as has_sb_date,
  ROUND(COUNT(invoice_date_sb)::numeric / COUNT(*)::numeric * 100, 1) as sb_date_pct
FROM transactions;

-- Check tracking_id by reference type
SELECT
  reference_type,
  COUNT(*) as total,
  COUNT(tracking_id) as has_tracking,
  ROUND(COUNT(tracking_id)::numeric / COUNT(*)::numeric * 100, 1) as pct
FROM transactions
GROUP BY reference_type
ORDER BY total DESC;
