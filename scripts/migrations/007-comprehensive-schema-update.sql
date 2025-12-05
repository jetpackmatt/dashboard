-- ============================================
-- MIGRATION 007: Comprehensive Schema Update
-- Date: 2025-11-27
-- ============================================
-- This migration:
-- 1. Adds missing fields to orders and shipments tables
-- 2. Removes redundant cost fields from shipments (costs live in transactions)
-- 3. Creates new tables: fulfillment_centers, order_items, shipment_items, shipment_cartons, invoices
-- 4. Adds proper indexes for performance
-- ============================================

-- ============================================
-- PART 1: FULFILLMENT CENTERS REFERENCE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS fulfillment_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fc_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  country TEXT NOT NULL,  -- 'US', 'CA', 'AU', 'UK', 'DE', etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed with known ShipBob FCs (add more as discovered)
INSERT INTO fulfillment_centers (fc_id, name, city, state, country) VALUES
  (1, 'Cicero (IL)', 'Cicero', 'IL', 'US'),
  (2, 'Moreno Valley (CA)', 'Moreno Valley', 'CA', 'US'),
  (3, 'Dallas (TX)', 'Dallas', 'TX', 'US'),
  (4, 'Bethlehem (PA)', 'Bethlehem', 'PA', 'US'),
  (5, 'Las Vegas (NV)', 'Las Vegas', 'NV', 'US'),
  (6, 'Mesa (AZ)', 'Mesa', 'AZ', 'US'),
  (7, 'Carrollton (TX)', 'Carrollton', 'TX', 'US'),
  (8, 'Ottawa (ON)', 'Ottawa', 'ON', 'CA'),
  (9, 'Melbourne (VIC)', 'Melbourne', 'VIC', 'AU'),
  (10, 'Feltham (UK)', 'Feltham', NULL, 'UK')
ON CONFLICT (fc_id) DO NOTHING;

-- ============================================
-- PART 2: ORDERS TABLE UPDATES
-- ============================================
-- Add B2B/Freight fields
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_message TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_type TEXT;      -- 'Parcel' or 'Freight'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_term TEXT;      -- 'Collect' or 'Prepaid'

-- ============================================
-- PART 3: SHIPMENTS TABLE UPDATES
-- ============================================
-- Add new fields
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS estimated_fulfillment_date TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS estimated_fulfillment_date_status TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_update_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_tracking_update_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS fc_id INTEGER;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS package_material_type TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS require_signature BOOLEAN;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS gift_message TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS invoice_amount DECIMAL(10,2);
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS invoice_currency_code TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_bol TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_pro_number TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS tracking_scac TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_country TEXT;       -- For DIM calculation
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS destination_country TEXT;  -- For DIM calculation

-- Remove redundant cost fields (costs live in transactions table only)
ALTER TABLE shipments DROP COLUMN IF EXISTS base_fulfillment_cost;
ALTER TABLE shipments DROP COLUMN IF EXISTS base_insurance;
ALTER TABLE shipments DROP COLUMN IF EXISTS base_surcharge;
ALTER TABLE shipments DROP COLUMN IF EXISTS base_total_cost;
ALTER TABLE shipments DROP COLUMN IF EXISTS marked_up_fulfillment_cost;
ALTER TABLE shipments DROP COLUMN IF EXISTS marked_up_insurance;
ALTER TABLE shipments DROP COLUMN IF EXISTS marked_up_surcharge;
ALTER TABLE shipments DROP COLUMN IF EXISTS marked_up_total_cost;
ALTER TABLE shipments DROP COLUMN IF EXISTS invoice_date;    -- Will be on invoices table
ALTER TABLE shipments DROP COLUMN IF EXISTS invoice_number;  -- Will be on invoices table

-- Add FK to fulfillment_centers
-- Note: We don't enforce FK constraint since fc_id might be unknown initially
CREATE INDEX IF NOT EXISTS idx_shipments_fc_id ON shipments(fc_id);

-- ============================================
-- PART 4: ORDER_ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipbob_product_id INTEGER,
  sku TEXT,
  reference_id TEXT,
  name TEXT,
  quantity INTEGER,
  unit_price DECIMAL(10,2),
  gtin TEXT,
  upc TEXT,
  external_line_id INTEGER,
  quantity_unit_of_measure_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, shipbob_product_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_client_id ON order_items(client_id);
CREATE INDEX IF NOT EXISTS idx_order_items_sku ON order_items(sku);

-- ============================================
-- PART 5: SHIPMENT_ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  shipment_id TEXT NOT NULL,
  shipbob_product_id INTEGER,
  sku TEXT,
  reference_id TEXT,
  name TEXT,
  -- Inventory tracking fields
  inventory_id INTEGER,
  lot TEXT,
  expiration_date DATE,
  quantity INTEGER,
  quantity_committed INTEGER,
  is_dangerous_goods BOOLEAN DEFAULT FALSE,
  serial_numbers JSONB,  -- Array of serial number strings
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index that handles NULL lots properly
CREATE UNIQUE INDEX IF NOT EXISTS idx_shipment_items_unique
  ON shipment_items(shipment_id, inventory_id, COALESCE(lot, ''));

CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment_id ON shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_client_id ON shipment_items(client_id);
CREATE INDEX IF NOT EXISTS idx_shipment_items_sku ON shipment_items(sku);
CREATE INDEX IF NOT EXISTS idx_shipment_items_lot ON shipment_items(lot) WHERE lot IS NOT NULL;

-- ============================================
-- PART 6: SHIPMENT_CARTONS TABLE (B2B Pallets)
-- ============================================
CREATE TABLE IF NOT EXISTS shipment_cartons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  shipment_id TEXT NOT NULL,
  carton_id INTEGER,
  barcode TEXT,
  carton_type TEXT,           -- 'Box' or 'Pallet'
  parent_barcode TEXT,        -- For nested cartons (carton inside pallet)
  -- Measurements
  length_in DECIMAL(8,2),
  width_in DECIMAL(8,2),
  depth_in DECIMAL(8,2),
  weight_oz DECIMAL(10,2),
  -- Contents (products in this carton)
  contents JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipment_cartons_shipment_id ON shipment_cartons(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_cartons_client_id ON shipment_cartons(client_id);
CREATE INDEX IF NOT EXISTS idx_shipment_cartons_barcode ON shipment_cartons(barcode) WHERE barcode IS NOT NULL;

-- ============================================
-- PART 7: INVOICES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  invoice_id INTEGER NOT NULL,
  amount DECIMAL(12,2),
  currency_code TEXT DEFAULT 'USD',
  invoice_date DATE,
  invoice_type TEXT,          -- 'Shipping', 'Inbound Fee', 'WarehouseStorage', etc.
  running_balance DECIMAL(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_type ON invoices(invoice_type);

-- ============================================
-- PART 8: ADD INVOICE FK TO TRANSACTIONS
-- ============================================
-- Transactions already have invoice_id, but let's ensure index exists
CREATE INDEX IF NOT EXISTS idx_transactions_invoice_id ON transactions(invoice_id) WHERE invoice_id IS NOT NULL;

-- ============================================
-- VERIFICATION QUERIES (run these to confirm)
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' ORDER BY ordinal_position;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'shipments' ORDER BY ordinal_position;
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('fulfillment_centers', 'order_items', 'shipment_items', 'shipment_cartons', 'invoices');

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
