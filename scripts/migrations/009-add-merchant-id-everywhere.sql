-- ============================================
-- MIGRATION 009: Add Merchant ID Everywhere
-- Date: 2025-11-27
-- ============================================
-- Adds merchant_id (ShipBob 6-digit User ID) to all data tables as a denormalized
-- column for easy filtering and display without requiring joins to clients table.
--
-- This keeps UUID client_id for internal FK relationships while providing
-- the human-readable merchant_id for all external/display purposes.
--
-- Tables modified:
--   - clients (rename shipbob_user_id → merchant_id)
--   - orders
--   - shipments
--   - order_items
--   - shipment_items
--   - shipment_cartons
--   - transactions
-- ============================================

-- ============================================
-- PART 1: Standardize clients table
-- Rename shipbob_user_id to merchant_id for consistency
-- ============================================
ALTER TABLE clients RENAME COLUMN shipbob_user_id TO merchant_id;

-- Add unique constraint on merchant_id (it should be unique per client)
ALTER TABLE clients ADD CONSTRAINT clients_merchant_id_unique UNIQUE (merchant_id);

-- ============================================
-- PART 2: Add merchant_id to orders
-- ============================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_id TEXT;

-- Backfill from clients table
UPDATE orders o
SET merchant_id = c.merchant_id
FROM clients c
WHERE o.client_id = c.id
AND o.merchant_id IS NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);

-- ============================================
-- PART 3: Add merchant_id to shipments
-- ============================================
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS merchant_id TEXT;

-- Backfill from clients table
UPDATE shipments s
SET merchant_id = c.merchant_id
FROM clients c
WHERE s.client_id = c.id
AND s.merchant_id IS NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_shipments_merchant_id ON shipments(merchant_id);

-- ============================================
-- PART 4: Add merchant_id to order_items
-- ============================================
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS merchant_id TEXT;

-- Backfill from clients table
UPDATE order_items oi
SET merchant_id = c.merchant_id
FROM clients c
WHERE oi.client_id = c.id
AND oi.merchant_id IS NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_order_items_merchant_id ON order_items(merchant_id);

-- ============================================
-- PART 5: Add merchant_id to shipment_items
-- ============================================
ALTER TABLE shipment_items ADD COLUMN IF NOT EXISTS merchant_id TEXT;

-- Backfill from clients table
UPDATE shipment_items si
SET merchant_id = c.merchant_id
FROM clients c
WHERE si.client_id = c.id
AND si.merchant_id IS NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_shipment_items_merchant_id ON shipment_items(merchant_id);

-- ============================================
-- PART 6: Add merchant_id to shipment_cartons
-- ============================================
ALTER TABLE shipment_cartons ADD COLUMN IF NOT EXISTS merchant_id TEXT;

-- Backfill from clients table
UPDATE shipment_cartons sc
SET merchant_id = c.merchant_id
FROM clients c
WHERE sc.client_id = c.id
AND sc.merchant_id IS NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_shipment_cartons_merchant_id ON shipment_cartons(merchant_id);

-- ============================================
-- PART 7: Add merchant_id to transactions
-- ============================================
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS merchant_id TEXT;

-- Backfill from clients table
UPDATE transactions t
SET merchant_id = c.merchant_id
FROM clients c
WHERE t.client_id = c.id
AND t.merchant_id IS NULL;

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_id ON transactions(merchant_id);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Check that all tables have merchant_id populated:
--
-- SELECT 'orders' as tbl, COUNT(*) as total, COUNT(merchant_id) as with_merchant FROM orders
-- UNION ALL SELECT 'shipments', COUNT(*), COUNT(merchant_id) FROM shipments
-- UNION ALL SELECT 'order_items', COUNT(*), COUNT(merchant_id) FROM order_items
-- UNION ALL SELECT 'shipment_items', COUNT(*), COUNT(merchant_id) FROM shipment_items
-- UNION ALL SELECT 'shipment_cartons', COUNT(*), COUNT(merchant_id) FROM shipment_cartons
-- UNION ALL SELECT 'transactions', COUNT(*), COUNT(merchant_id) FROM transactions;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
