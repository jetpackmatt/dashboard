-- Add billing_currency column to clients table
-- Run this in Supabase SQL Editor

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS billing_currency text DEFAULT 'USD';

COMMENT ON COLUMN clients.billing_currency IS 'Currency for billing invoices (e.g., USD, CAD, EUR)';
