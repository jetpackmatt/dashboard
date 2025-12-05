-- ============================================
-- MIGRATION 008: Add status_details JSONB column
-- Date: 2025-11-27
-- ============================================
-- Stores the status_details array from ShipBob API
-- Contains exception reasons, processing status, etc.
-- Example: [{"name": "OutOfStock", "description": "No Stock On Hand For Sku", "inventory_id": 20101215}]
-- ============================================

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS status_details JSONB;

-- Index for querying specific status types (e.g., find all OutOfStock exceptions)
CREATE INDEX IF NOT EXISTS idx_shipments_status_details ON shipments USING GIN (status_details);

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
