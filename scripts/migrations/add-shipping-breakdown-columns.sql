-- Migration: Add shipping breakdown columns to transactions table
-- These columns store base cost, surcharge, and insurance from the weekly SFTP file
-- Only populated for Shipment transactions with transaction_fee = 'Shipping'

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_cost DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS surcharge DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS insurance_cost DECIMAL(10,2);

-- Add comment for documentation
COMMENT ON COLUMN transactions.base_cost IS 'Base shipping cost before surcharges (from SFTP extras file)';
COMMENT ON COLUMN transactions.surcharge IS 'Carrier surcharges - passed through at cost (from SFTP extras file)';
COMMENT ON COLUMN transactions.insurance_cost IS 'Insurance amount - passed through at cost (from SFTP extras file)';
