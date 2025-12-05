-- Migration: Convert date columns to timestamptz for time-of-day analysis
-- Date: 2025-11-27
-- Reason: Need full timestamps for label_generation vs shipped time comparisons

-- Convert label_generation_date from DATE to TIMESTAMPTZ
ALTER TABLE shipments
  ALTER COLUMN label_generation_date TYPE TIMESTAMPTZ
  USING label_generation_date::TIMESTAMPTZ;

-- Verify the change
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'shipments' AND column_name LIKE '%date%';
