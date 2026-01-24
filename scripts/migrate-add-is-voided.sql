-- Migration: Add is_voided column to transactions table
-- Run this in Supabase SQL Editor

-- Add the column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_voided BOOLEAN DEFAULT FALSE;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_transactions_is_voided ON transactions (is_voided) WHERE is_voided = true;

-- Mark the 8 known duplicate transactions as voided
-- (keeping only the latest charge_date per shipment_id + tracking_id + invoice_id_sb)
WITH duplicates AS (
  SELECT
    transaction_id,
    ROW_NUMBER() OVER (
      PARTITION BY reference_id, tracking_id, invoice_id_sb
      ORDER BY charge_date DESC
    ) as rn
  FROM transactions
  WHERE fee_type = 'Shipping'
    AND reference_type = 'Shipment'
    AND invoice_id_sb IS NOT NULL
    AND reference_id IN (
      SELECT reference_id
      FROM transactions
      WHERE fee_type = 'Shipping' AND reference_type = 'Shipment'
      GROUP BY reference_id, tracking_id, invoice_id_sb
      HAVING COUNT(*) > 1
    )
)
UPDATE transactions
SET is_voided = true
WHERE transaction_id IN (
  SELECT transaction_id FROM duplicates WHERE rn > 1
);

-- Verify the fix
SELECT
  COUNT(*) as total_shipping,
  COUNT(*) FILTER (WHERE is_voided = false) as billable,
  COUNT(*) FILTER (WHERE is_voided = true) as voided
FROM transactions
WHERE fee_type = 'Shipping'
  AND reference_type = 'Shipment'
  AND invoice_id_sb IN (8818835, 8818838, 8818840, 8818843, 8818846, 8818851);
