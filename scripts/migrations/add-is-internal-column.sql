-- Add is_internal flag to clients table
-- This distinguishes internal/system entries from real merchant clients

ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false;

-- Mark existing internal clients
UPDATE clients SET is_internal = true WHERE company_name IN ('ShipBob Payments', 'Jetpack Costs');

-- Add comment for documentation
COMMENT ON COLUMN clients.is_internal IS 'True for internal/system entries (e.g., parent-level transactions), false for real merchant clients';
