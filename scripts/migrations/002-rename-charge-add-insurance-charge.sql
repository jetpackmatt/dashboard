-- Migration: Rename charge to total_charge, add insurance_charge
-- Purpose: Better column naming for shipment billing breakdown
--
-- For shipments:
--   base_cost (from SFTP) → apply markup → base_charge (calculated)
--   surcharge (from SFTP) → passed through at 0%
--   insurance_cost (from SFTP) → apply markup → insurance_charge
--   total_charge = base_charge + surcharge + insurance_charge
--
-- For non-shipments:
--   total_charge = cost + (cost × markup_percent) + markup_amount

-- Step 1: Rename charge to total_charge
ALTER TABLE transactions RENAME COLUMN charge TO total_charge;

-- Step 2: Add insurance_charge column
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS insurance_charge NUMERIC(12,2);

-- Step 3: Add comments for clarity
COMMENT ON COLUMN transactions.cost IS 'Our cost from ShipBob (API amount field)';
COMMENT ON COLUMN transactions.base_cost IS 'Base shipping cost before surcharges (from SFTP)';
COMMENT ON COLUMN transactions.surcharge IS 'Carrier surcharges - passed through at cost (from SFTP)';
COMMENT ON COLUMN transactions.insurance_cost IS 'Insurance cost (from SFTP)';
COMMENT ON COLUMN transactions.insurance_charge IS 'Marked up insurance amount we charge the client';
COMMENT ON COLUMN transactions.markup_percent IS 'Markup percentage applied (e.g., 0.175 for 17.5%)';
COMMENT ON COLUMN transactions.markup_amount IS 'Flat markup amount added';
COMMENT ON COLUMN transactions.total_charge IS 'Total amount we charge the client';

-- Verification query (run after migration)
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'transactions'
-- AND column_name IN ('cost', 'base_cost', 'surcharge', 'insurance_cost', 'insurance_charge', 'markup_percent', 'markup_amount', 'total_charge')
-- ORDER BY ordinal_position;
