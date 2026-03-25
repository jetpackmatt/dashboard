-- Add auto_file_claims preference to clients table
-- When enabled, eligible shipments will automatically have claims filed
ALTER TABLE clients ADD COLUMN IF NOT EXISTS auto_file_claims boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN clients.auto_file_claims IS 'When true, automatically file claims for eligible shipments';
