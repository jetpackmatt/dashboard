-- Migration: Add order type and channel fields to orders table
-- Date: 2025-11-27
-- Reason: ShipBob provides order type (B2B/DTC) and channel info
--
-- Run this in Supabase SQL Editor

-- Add new columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type TEXT;          -- 'B2B' or 'DTC'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_id INTEGER;       -- ShipBob channel ID
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_name TEXT;        -- e.g., 'hs-wholesale', 'sjconsulting'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reference_id TEXT;        -- External order ID (Shopify/BigCommerce)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_method TEXT;     -- e.g., 'Express International'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMPTZ; -- Original purchase date

-- Add index for order_type filtering
CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders(channel_id);

-- Verify columns were added
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders';
