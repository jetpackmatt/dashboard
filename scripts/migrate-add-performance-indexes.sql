-- Performance Indexes Migration
-- Run this in Supabase SQL Editor to dramatically improve query performance
-- Created: January 2026
--
-- NOTE: Removed CONCURRENTLY keyword because Supabase SQL Editor runs in a
-- transaction block. For tables this size (~95K-191K rows), the brief lock
-- during index creation is acceptable (a few seconds).

-- =============================================================================
-- CRITICAL INDEX #1: transactions.tracking_id
-- Current: 512ms (full table scan of 191K rows)
-- Expected: <5ms with index
-- Used by: Shipments page billing lookup (every page load)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_transactions_tracking_id
ON transactions (tracking_id) WHERE tracking_id IS NOT NULL;

-- =============================================================================
-- CRITICAL INDEX #2: Composite index for shipped shipments queries
-- Current: 75ms (sequential scan)
-- Expected: <10ms with index
-- Used by: Shipments tab - the most-used transaction view
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_shipments_client_labeled_deleted
ON shipments (client_id, event_labeled DESC, deleted_at)
WHERE event_labeled IS NOT NULL AND deleted_at IS NULL;

-- =============================================================================
-- CRITICAL INDEX #3: Composite index for unfulfilled shipments queries
-- Current: 75ms (sequential scan)
-- Expected: <10ms with index
-- Used by: Unfulfilled tab
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_shipments_unfulfilled
ON shipments (client_id, created_at DESC)
WHERE event_labeled IS NULL AND status != 'Cancelled' AND deleted_at IS NULL;

-- =============================================================================
-- HELPFUL INDEX #4: event_labeled for sorting (covers most shipment queries)
-- Current: No dedicated index for event_labeled ordering
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_shipments_event_labeled_desc
ON shipments (event_labeled DESC NULLS LAST)
WHERE deleted_at IS NULL;

-- =============================================================================
-- HELPFUL INDEX #5: Carrier filtering (used in filter dropdowns)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_shipments_carrier
ON shipments (carrier)
WHERE carrier IS NOT NULL AND deleted_at IS NULL;

-- =============================================================================
-- HELPFUL INDEX #6: Orders date + client composite for faster date-filtered JOINs
-- Current: 212ms (nested loop with 14K lookups)
-- Expected: ~50ms with better index
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_orders_client_date
ON orders (client_id, order_import_date DESC);

-- =============================================================================
-- Verify indexes were created
-- =============================================================================
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('shipments', 'transactions', 'orders')
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- =============================================================================
-- FUTURE OPTIMIZATION: Denormalize order_import_date to shipments
-- This would eliminate the JOIN entirely for date filtering
-- Steps:
-- 1. ALTER TABLE shipments ADD COLUMN order_import_date TIMESTAMPTZ;
-- 2. UPDATE shipments s SET order_import_date = o.order_import_date FROM orders o WHERE s.order_id = o.id;
-- 3. CREATE INDEX idx_shipments_client_order_date ON shipments (client_id, order_import_date DESC);
-- 4. Update sync code to populate this field
-- 5. Update API routes to filter on shipments.order_import_date instead of JOIN
-- Expected improvement: 212ms → ~10ms
-- =============================================================================
