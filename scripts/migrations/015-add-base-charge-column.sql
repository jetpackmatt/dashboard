-- Migration: Add base_charge column to transactions table
-- Date: Dec 7, 2025
-- Purpose: Store the marked-up base shipping cost separately from internal cost

-- Add base_charge column for shipments only
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_charge NUMERIC(12,2);

-- Comment explaining the column
COMMENT ON COLUMN transactions.base_charge IS 'Marked up base cost = base_cost × (1 + markup%). For shipments only. Client sees as "Base Fulfillment Charge"';

-- Update existing comments for clarity
COMMENT ON COLUMN transactions.base_cost IS 'Base shipping cost from SFTP (internal only, NOT marked up). For shipments only.';
COMMENT ON COLUMN transactions.surcharge IS 'Carrier surcharges from SFTP (passed through at cost, NO markup). For shipments only.';
COMMENT ON COLUMN transactions.total_charge IS 'base_charge + surcharge. For shipments only. Client sees as "Total Charge".';
COMMENT ON COLUMN transactions.insurance_cost IS 'Insurance cost from SFTP (internal only, NOT marked up). For shipments only.';
COMMENT ON COLUMN transactions.insurance_charge IS 'Marked up insurance = insurance_cost × (1 + markup%). For shipments only. Client sees as "Insurance".';
COMMENT ON COLUMN transactions.billed_amount IS 'Universal total charged to client. For shipments: total_charge + insurance_charge. For non-shipments: cost × (1 + markup%).';
COMMENT ON COLUMN transactions.cost IS 'Our total cost from ShipBob API (internal only).';
COMMENT ON COLUMN transactions.markup_applied IS 'Dollar amount of markup (internal only).';
COMMENT ON COLUMN transactions.markup_percentage IS 'Markup percentage applied, e.g., 0.18 for 18% (internal only).';
