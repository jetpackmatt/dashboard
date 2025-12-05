-- Migration: Add missing fields and remove unused columns
-- Date: 2025-11-27
-- Reason: Comprehensive field analysis revealed missing API data and unused columns

-- ============================================
-- ORDERS TABLE CHANGES
-- ============================================

-- Add new fields for recipient address (needed for claims, verification)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address1 TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS address2 TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_name TEXT;

-- Add order value (from financials.total_price)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_price DECIMAL(10,2);

-- Remove unused columns
ALTER TABLE orders DROP COLUMN IF EXISTS order_category;
ALTER TABLE orders DROP COLUMN IF EXISTS raw_data;

-- ============================================
-- SHIPMENTS TABLE CHANGES
-- ============================================

-- Add tracking URL for customer support
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_url TEXT;

-- Add insurance value for claims processing
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS insurance_value DECIMAL(10,2);

-- Remove unused column
ALTER TABLE shipments DROP COLUMN IF EXISTS raw_data;

-- Note: shipped_date and delivered_date columns already exist but weren't being synced
-- The sync script will now populate them

-- ============================================
-- VERIFICATION
-- ============================================
-- Run these queries to verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' ORDER BY column_name;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'shipments' ORDER BY column_name;
