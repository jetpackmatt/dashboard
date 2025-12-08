-- Migration: Consolidate invoices_jetpack_line_items into transactions table
-- This removes redundancy by storing markup data directly on transactions

-- Step 1: Add new columns to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_applied numeric DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS billed_amount numeric;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_percentage numeric DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_rule_id uuid REFERENCES markup_rules(id);

-- Step 2: Migrate data from invoices_jetpack_line_items
UPDATE transactions t
SET
  markup_applied = li.markup_applied,
  billed_amount = li.billed_amount,
  markup_percentage = li.markup_percentage,
  markup_rule_id = li.markup_rule_id
FROM invoices_jetpack_line_items li
WHERE t.id = li.billing_record_id;

-- Step 3: For uninvoiced transactions, set billed_amount = cost (no markup yet)
UPDATE transactions
SET billed_amount = cost
WHERE billed_amount IS NULL;

-- Step 4: Drop old unused columns
ALTER TABLE transactions DROP COLUMN IF EXISTS markup_amount;
ALTER TABLE transactions DROP COLUMN IF EXISTS markup_percent;

-- Step 5: Drop the now-redundant line_items table
DROP TABLE IF EXISTS invoices_jetpack_line_items;

-- Add comment for documentation
COMMENT ON COLUMN transactions.markup_applied IS 'Markup amount applied when invoiced (cost * markup_percentage)';
COMMENT ON COLUMN transactions.billed_amount IS 'Final billed amount (cost + markup_applied)';
COMMENT ON COLUMN transactions.markup_percentage IS 'Markup percentage applied (e.g., 0.15 for 15%)';
COMMENT ON COLUMN transactions.markup_rule_id IS 'Reference to the markup rule used when invoicing';
