-- Migration: Rename order_date to order_import_date and convert to timestamptz
-- Date: 2025-11-27
-- Reason: Clearer naming and need full timestamps for import-to-ship time analysis

-- Rename and convert the column
ALTER TABLE orders RENAME COLUMN order_date TO order_import_date;

ALTER TABLE orders
  ALTER COLUMN order_import_date TYPE TIMESTAMPTZ
  USING order_import_date::TIMESTAMPTZ;

-- Verify
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' AND column_name LIKE '%date%';
