-- Add billing_address column for invoice generation
-- Run this in Supabase SQL Editor

ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_address JSONB;

COMMENT ON COLUMN clients.billing_address IS 'Client billing address for invoices: {street, city, region, postalCode, country}';

-- Example data structure:
-- {
--   "street": "123 Main St, Suite 400",
--   "city": "Toronto",
--   "region": "ON",
--   "postalCode": "M5V 1K4",
--   "country": "CANADA"
-- }
