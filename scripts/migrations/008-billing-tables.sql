-- ============================================
-- MIGRATION 008: Billing Tables
-- Date: 2025-11-27
-- ============================================
-- Creates 6 billing tables for historical transaction data imported from ShipBob Excel exports.
-- These tables store BILLING-SPECIFIC data only - shipment/order details are in existing tables.
--
-- Tables:
--   1. billing_shipments (73,666 rows) - Main shipment costs, links to shipments table
--   2. billing_shipment_fees (51,366 rows) - Line-item fees per shipment
--   3. billing_storage (14,466 rows) - Warehouse storage fees
--   4. billing_credits (336 rows) - Credits and refunds
--   5. billing_returns (204 rows) - Return processing fees
--   6. billing_receiving (118 rows) - WRO/inbound receiving fees
-- ============================================

-- ============================================
-- Merchant ID to Client ID lookup table
-- Maps ShipBob User IDs to our internal client UUIDs
-- ============================================
CREATE TABLE IF NOT EXISTS merchant_client_map (
  merchant_id TEXT PRIMARY KEY,           -- ShipBob User ID (e.g., '386350')
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_name TEXT,                     -- For reference (e.g., 'Henson Shaving')
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with known merchants
INSERT INTO merchant_client_map (merchant_id, client_id, merchant_name) VALUES
  ('386350', '6b94c274-0446-4167-9d02-b998f8be59ad', 'Henson Shaving'),
  ('392333', 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e', 'Methyl-Life')
ON CONFLICT (merchant_id) DO NOTHING;

-- ============================================
-- TABLE 1: billing_shipments
-- Source: SHIPMENTS.xlsx (40 columns, 73,666 rows)
-- Purpose: Main shipment billing with cost breakdown
-- Links to: shipments.shipment_id
-- ============================================
CREATE TABLE IF NOT EXISTS billing_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_id TEXT,                       -- ShipBob User ID from Excel (for audit/debugging)

  -- Links to existing data (NOT duplicating shipment details)
  shipment_id TEXT,                       -- FK to shipments.shipment_id (TrackingId in Excel)
  order_id INTEGER,                       -- ShipBob OrderID for easy lookup

  -- Invoice/Billing Status
  transaction_status TEXT,                -- 'invoiced', 'invoice pending'
  transaction_type TEXT,                  -- 'Charge', 'Credit'
  invoice_number INTEGER,
  invoice_date DATE,
  transaction_date DATE,

  -- COST BREAKDOWN (the key billing data!)
  fulfillment_cost DECIMAL(10,2),         -- "Fulfillment without Surcharge"
  surcharge DECIMAL(10,2),                -- "Surcharge Applied"
  total_amount DECIMAL(10,2),             -- "Original Invoice" (total)
  pick_fees DECIMAL(10,2),                -- "Pick Fees"
  b2b_fees DECIMAL(10,2),                 -- "B2B Fees"
  insurance DECIMAL(10,2),                -- "Insurance Amount"

  -- Additional context
  store_integration_name TEXT,            -- Channel/store name
  products_sold TEXT,                     -- Text summary of products
  total_quantity INTEGER,
  order_category TEXT,
  transit_time_days DECIMAL(6,2),         -- Pre-calculated transit time

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'excel_import',

  UNIQUE(client_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_shipments_client ON billing_shipments(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_shipments_shipment ON billing_shipments(shipment_id);
CREATE INDEX IF NOT EXISTS idx_billing_shipments_order ON billing_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_billing_shipments_invoice ON billing_shipments(invoice_number);
CREATE INDEX IF NOT EXISTS idx_billing_shipments_status ON billing_shipments(transaction_status);
CREATE INDEX IF NOT EXISTS idx_billing_shipments_date ON billing_shipments(transaction_date);

-- ============================================
-- TABLE 2: billing_shipment_fees
-- Source: ADDITIONAL-SERVICES.xlsx (9 columns, 51,366 rows)
-- Purpose: Line-item fees per shipment (pick fees, etc.)
-- Links to: shipments.shipment_id via reference_id
-- ============================================
CREATE TABLE IF NOT EXISTS billing_shipment_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_id TEXT,                       -- ShipBob User ID from Excel

  -- Link to shipment
  shipment_id TEXT NOT NULL,              -- Reference ID in Excel = shipment_id

  -- Fee details
  fee_type TEXT NOT NULL,                 -- 'Per Pick Fee', 'Shipping', etc.
  amount DECIMAL(10,2),                   -- Invoice Amount

  -- Invoice info
  transaction_date DATE,
  invoice_number INTEGER,
  invoice_date DATE,
  transaction_status TEXT,                -- 'invoiced', 'invoice pending'

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'excel_import'
);

CREATE INDEX IF NOT EXISTS idx_billing_shipment_fees_client ON billing_shipment_fees(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_shipment_fees_shipment ON billing_shipment_fees(shipment_id);
CREATE INDEX IF NOT EXISTS idx_billing_shipment_fees_type ON billing_shipment_fees(fee_type);
CREATE INDEX IF NOT EXISTS idx_billing_shipment_fees_invoice ON billing_shipment_fees(invoice_number);

-- ============================================
-- TABLE 3: billing_storage
-- Source: STORAGE.xlsx (10 columns, 14,466 rows)
-- Purpose: Warehouse storage fees per inventory location
-- ============================================
CREATE TABLE IF NOT EXISTS billing_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_id TEXT,                       -- ShipBob User ID from Excel

  -- Storage identification
  inventory_id INTEGER NOT NULL,
  charge_start_date DATE,
  fc_name TEXT,
  location_type TEXT,                     -- 'Bin', 'Shelf', 'Pallet', 'HalfPallet', 'ShoeShelf'

  -- Parsed from Comment field
  quantity INTEGER,                       -- Number of storage units (parsed)
  rate_per_month DECIMAL(10,2),           -- Rate per unit (parsed)

  -- Billing
  amount DECIMAL(10,2),                   -- Invoice amount
  invoice_number INTEGER,
  invoice_date DATE,
  transaction_status TEXT,

  -- Raw comment preserved
  comment TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'excel_import',

  UNIQUE(client_id, inventory_id, charge_start_date)
);

CREATE INDEX IF NOT EXISTS idx_billing_storage_client ON billing_storage(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_storage_inventory ON billing_storage(inventory_id);
CREATE INDEX IF NOT EXISTS idx_billing_storage_fc ON billing_storage(fc_name);
CREATE INDEX IF NOT EXISTS idx_billing_storage_type ON billing_storage(location_type);
CREATE INDEX IF NOT EXISTS idx_billing_storage_date ON billing_storage(charge_start_date);

-- ============================================
-- TABLE 4: billing_credits
-- Source: CREDITS.xlsx (9 columns, 336 rows)
-- Purpose: Credits and refunds
-- ============================================
CREATE TABLE IF NOT EXISTS billing_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_id TEXT,                       -- ShipBob User ID from Excel

  -- Credit details
  reference_id TEXT,
  credit_reason TEXT,                     -- 'Courtesy', 'Shipping Error', etc.
  credit_amount DECIMAL(10,2),            -- Negative value

  -- Invoice info
  transaction_date DATE,
  credit_invoice_number INTEGER,
  invoice_date DATE,
  transaction_status TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'excel_import'
);

CREATE INDEX IF NOT EXISTS idx_billing_credits_client ON billing_credits(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_credits_reason ON billing_credits(credit_reason);
CREATE INDEX IF NOT EXISTS idx_billing_credits_invoice ON billing_credits(credit_invoice_number);

-- ============================================
-- TABLE 5: billing_returns
-- Source: RETURNS.xlsx (14 columns, 204 rows)
-- Purpose: Return processing fees (RTS, etc.)
-- Links to: orders.shipbob_order_id via original_order_id
-- ============================================
CREATE TABLE IF NOT EXISTS billing_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_id TEXT,                       -- ShipBob User ID from Excel

  -- Return identification
  return_id INTEGER NOT NULL,
  original_order_id INTEGER,              -- Links to orders.shipbob_order_id
  tracking_id TEXT,

  -- Return details
  transaction_type TEXT,                  -- 'Return Processed by Operations Fee', etc.
  return_status TEXT,                     -- 'Completed', etc.
  return_type TEXT,                       -- 'Regular', 'ReturnToSender'
  return_creation_date DATE,
  fc_name TEXT,

  -- Billing
  amount DECIMAL(10,2),                   -- Invoice amount
  invoice_number INTEGER,
  invoice_date DATE,
  transaction_status TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'excel_import',

  UNIQUE(client_id, return_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_returns_client ON billing_returns(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_returns_return ON billing_returns(return_id);
CREATE INDEX IF NOT EXISTS idx_billing_returns_order ON billing_returns(original_order_id);
CREATE INDEX IF NOT EXISTS idx_billing_returns_type ON billing_returns(return_type);

-- ============================================
-- TABLE 6: billing_receiving
-- Source: RECEIVING.xlsx (10 columns, 118 rows)
-- Purpose: WRO/inbound receiving fees
-- ============================================
CREATE TABLE IF NOT EXISTS billing_receiving (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  merchant_id TEXT,                       -- ShipBob User ID from Excel

  -- WRO identification
  reference_id TEXT NOT NULL,             -- WRO ID

  -- Fee details
  fee_type TEXT,                          -- 'WRO Receiving Fee', etc.
  amount DECIMAL(10,2),                   -- Invoice Amount
  transaction_type TEXT,                  -- 'Charge'

  -- Invoice info
  transaction_date DATE,
  invoice_number INTEGER,
  invoice_date DATE,
  transaction_status TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'excel_import',

  UNIQUE(client_id, reference_id, fee_type)
);

CREATE INDEX IF NOT EXISTS idx_billing_receiving_client ON billing_receiving(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_receiving_ref ON billing_receiving(reference_id);
CREATE INDEX IF NOT EXISTS idx_billing_receiving_type ON billing_receiving(fee_type);

-- ============================================
-- UNIFIED VIEW: billing_all
-- Purpose: Query all billing data in one place
-- ============================================
CREATE OR REPLACE VIEW billing_all AS
SELECT
  'shipment' as billing_type,
  order_id::text as reference_id,
  total_amount as amount,
  transaction_date,
  invoice_date,
  invoice_number,
  transaction_status,
  NULL as fc_name,
  client_id,
  merchant_id,
  created_at
FROM billing_shipments

UNION ALL

SELECT
  'fee' as billing_type,
  shipment_id as reference_id,
  amount,
  transaction_date,
  invoice_date,
  invoice_number,
  transaction_status,
  NULL as fc_name,
  client_id,
  merchant_id,
  created_at
FROM billing_shipment_fees

UNION ALL

SELECT
  'storage' as billing_type,
  inventory_id::text as reference_id,
  amount,
  charge_start_date as transaction_date,
  invoice_date,
  invoice_number,
  transaction_status,
  fc_name,
  client_id,
  merchant_id,
  created_at
FROM billing_storage

UNION ALL

SELECT
  'credit' as billing_type,
  reference_id,
  credit_amount as amount,
  transaction_date,
  invoice_date,
  credit_invoice_number as invoice_number,
  transaction_status,
  NULL as fc_name,
  client_id,
  merchant_id,
  created_at
FROM billing_credits

UNION ALL

SELECT
  'return' as billing_type,
  return_id::text as reference_id,
  amount,
  return_creation_date as transaction_date,
  invoice_date,
  invoice_number,
  transaction_status,
  fc_name,
  client_id,
  merchant_id,
  created_at
FROM billing_returns

UNION ALL

SELECT
  'receiving' as billing_type,
  reference_id,
  amount,
  transaction_date,
  invoice_date,
  invoice_number,
  transaction_status,
  NULL as fc_name,
  client_id,
  merchant_id,
  created_at
FROM billing_receiving;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'billing_%';
--
-- SELECT COUNT(*) FROM billing_shipments;
-- SELECT COUNT(*) FROM billing_shipment_fees;
-- SELECT COUNT(*) FROM billing_storage;
-- SELECT COUNT(*) FROM billing_credits;
-- SELECT COUNT(*) FROM billing_returns;
-- SELECT COUNT(*) FROM billing_receiving;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
