-- =============================================================
-- BACKFILL markup_rule_id on transactions table
-- Run via psql for best performance
-- =============================================================

-- Check current state
SELECT
  'Before Backfill' as stage,
  COUNT(*) as total,
  COUNT(markup_rule_id) as has_rule,
  ROUND(COUNT(markup_rule_id)::numeric / COUNT(*)::numeric * 100, 1) as pct
FROM transactions
WHERE markup_applied IS NOT NULL AND markup_applied != 0;

-- =============================================================
-- HENSON (6b94c274-0446-4167-9d02-b998f8be59ad)
-- =============================================================

-- 1. Henson Per Pick Fee → rule b54393fa-2edc-47d5-bb9c-c33d1c5bec52
UPDATE transactions
SET markup_rule_id = 'b54393fa-2edc-47d5-bb9c-c33d1c5bec52'
WHERE client_id = '6b94c274-0446-4167-9d02-b998f8be59ad'
  AND transaction_fee = 'Per Pick Fee'
  AND markup_applied IS NOT NULL AND markup_applied != 0
  AND markup_rule_id IS NULL;

-- 2. Henson Shipping (ship_option_id = 146) → rule 26721ec8-c13f-4474-befa-0e7b60eedc0f
UPDATE transactions t
SET markup_rule_id = '26721ec8-c13f-4474-befa-0e7b60eedc0f'
FROM shipments s
WHERE t.client_id = '6b94c274-0446-4167-9d02-b998f8be59ad'
  AND t.transaction_fee = 'Shipping'
  AND t.reference_type = 'Shipment'
  AND t.reference_id = s.shipment_id::text
  AND s.ship_option_id = 146
  AND t.markup_applied IS NOT NULL AND t.markup_applied != 0
  AND t.markup_rule_id IS NULL;

-- 3. Henson Shipping (other ship_option_ids) → rule e1e2c800-c419-4671-b157-602c89800fc3
UPDATE transactions t
SET markup_rule_id = 'e1e2c800-c419-4671-b157-602c89800fc3'
FROM shipments s
WHERE t.client_id = '6b94c274-0446-4167-9d02-b998f8be59ad'
  AND t.transaction_fee = 'Shipping'
  AND t.reference_type = 'Shipment'
  AND t.reference_id = s.shipment_id::text
  AND (s.ship_option_id IS NULL OR s.ship_option_id != 146)
  AND t.markup_applied IS NOT NULL AND t.markup_applied != 0
  AND t.markup_rule_id IS NULL;

-- 4. Henson Shipping (no shipment match - use Standard rule)
UPDATE transactions
SET markup_rule_id = 'e1e2c800-c419-4671-b157-602c89800fc3'
WHERE client_id = '6b94c274-0446-4167-9d02-b998f8be59ad'
  AND transaction_fee = 'Shipping'
  AND markup_applied IS NOT NULL AND markup_applied != 0
  AND markup_rule_id IS NULL;

-- 5. Henson Inventory Placement Program Fee → rule a5878a13-f0b1-48cc-9ed7-d479b7d132ca
UPDATE transactions
SET markup_rule_id = 'a5878a13-f0b1-48cc-9ed7-d479b7d132ca'
WHERE client_id = '6b94c274-0446-4167-9d02-b998f8be59ad'
  AND transaction_fee = 'Inventory Placement Program Fee'
  AND markup_applied IS NOT NULL AND markup_applied != 0
  AND markup_rule_id IS NULL;

-- =============================================================
-- METHYL-LIFE (ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e)
-- =============================================================

-- 1. Methyl-Life Per Pick Fee → rule b759cd8b-182f-441f-ad61-a10910134bc6
UPDATE transactions
SET markup_rule_id = 'b759cd8b-182f-441f-ad61-a10910134bc6'
WHERE client_id = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'
  AND transaction_fee = 'Per Pick Fee'
  AND markup_applied IS NOT NULL AND markup_applied != 0
  AND markup_rule_id IS NULL;

-- 2. Methyl-Life Shipping → rule 67460844-cefa-4104-a422-f095dde597dc
UPDATE transactions
SET markup_rule_id = '67460844-cefa-4104-a422-f095dde597dc'
WHERE client_id = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'
  AND transaction_fee = 'Shipping'
  AND markup_applied IS NOT NULL AND markup_applied != 0
  AND markup_rule_id IS NULL;

-- 3. Methyl-Life Inventory Placement Program Fee → rule d68b8396-8f98-4c3b-ac1f-4418d438a10a
UPDATE transactions
SET markup_rule_id = 'd68b8396-8f98-4c3b-ac1f-4418d438a10a'
WHERE client_id = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'
  AND transaction_fee = 'Inventory Placement Program Fee'
  AND markup_applied IS NOT NULL AND markup_applied != 0
  AND markup_rule_id IS NULL;

-- =============================================================
-- Verify results
-- =============================================================
SELECT
  'After Backfill' as stage,
  COUNT(*) as total,
  COUNT(markup_rule_id) as has_rule,
  ROUND(COUNT(markup_rule_id)::numeric / COUNT(*)::numeric * 100, 1) as pct
FROM transactions
WHERE markup_applied IS NOT NULL AND markup_applied != 0;

-- Breakdown by transaction_fee
SELECT
  transaction_fee,
  COUNT(*) as total,
  COUNT(markup_rule_id) as has_rule,
  ROUND(COUNT(markup_rule_id)::numeric / COUNT(*)::numeric * 100, 1) as pct
FROM transactions
WHERE markup_applied IS NOT NULL AND markup_applied != 0
GROUP BY transaction_fee
ORDER BY total DESC;
