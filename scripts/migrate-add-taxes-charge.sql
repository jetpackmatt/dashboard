-- Add taxes_charge column to transactions table
-- This stores the marked-up tax amounts as a JSONB array
-- Format: [{ "tax_type": "GST", "tax_rate": 13, "tax_amount": 0.86 }, ...]
-- The tax_amount is calculated as: billed_amount * (tax_rate / 100)

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS taxes_charge JSONB;

-- Add comment for documentation
COMMENT ON COLUMN transactions.taxes_charge IS 'Marked-up tax amounts. Array of {tax_type, tax_rate, tax_amount} where tax_amount = billed_amount * (tax_rate/100)';
