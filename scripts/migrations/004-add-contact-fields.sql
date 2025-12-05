-- Migration: Add contact fields for customer support and claims
-- Date: 2025-11-27
-- Note: These fields will be subject to GDPR auto-deletion based on record age

-- ============================================
-- ORDERS TABLE - Add contact fields
-- ============================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- ============================================
-- SHIPMENTS TABLE - Add shipment-level recipient fields
-- (Can differ from order-level in some cases)
-- ============================================
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_name TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_email TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS recipient_phone TEXT;

-- ============================================
-- VERIFICATION
-- ============================================
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name LIKE '%email%';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'shipments' AND column_name LIKE '%recipient%';
