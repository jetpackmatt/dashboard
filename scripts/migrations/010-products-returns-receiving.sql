-- ============================================
-- MIGRATION 010: Products, Returns, Receiving Tables (2025-07 API)
-- Date: 2025-11-27
-- ============================================
-- Creates 3 tables for ShipBob catalog data that supports billing transaction details.
-- Uses JSONB for nested arrays (variants, inventory items) to minimize table count.
--
-- Tables:
--   - products (product catalog with variants as JSONB)
--   - returns (return orders with inventory items as JSONB)
--   - receiving_orders (WROs with inventory_quantities as JSONB)
-- ============================================

-- ============================================
-- PART 1: Products Table
-- ============================================
-- Stores product catalog from 2025-07 /products endpoint
-- Variants array stored as JSONB (one product → many variants)

DROP TABLE IF EXISTS products CASCADE;

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id TEXT,                           -- ShipBob user_id (e.g., '386350')

  -- ShipBob identifiers
  shipbob_product_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,                                  -- 'Bundle', 'Simple', etc.
  taxonomy TEXT,                              -- Product category

  -- Variants array as JSONB
  -- Each variant has: id, sku, name, gtin, upc, status, is_digital,
  -- inventory {inventory_id, on_hand_qty}, bundle_definition[],
  -- fulfillment_settings, dimension, weight, created_on, updated_on
  variants JSONB,

  -- Timestamps
  created_on TIMESTAMPTZ,
  updated_on TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_products_shipbob_id UNIQUE (client_id, shipbob_product_id)
);

CREATE INDEX idx_products_client ON products(client_id);
CREATE INDEX idx_products_merchant ON products(merchant_id);
CREATE INDEX idx_products_name ON products(name);

-- ============================================
-- PART 2: Returns Table
-- ============================================
-- Stores return orders from 2025-07 /returns endpoint
-- Inventory items array stored as JSONB

DROP TABLE IF EXISTS returns CASCADE;

CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id TEXT,                           -- Derived from client config

  -- ShipBob identifiers
  shipbob_return_id INTEGER NOT NULL,
  reference_id TEXT,                          -- ShipBob UUID reference

  -- Return details
  status TEXT,                                -- 'Completed', 'Processing', 'AwaitingArrival', etc.
  return_type TEXT,                           -- 'Regular', 'System Generated', 'ReturnToSender'
  tracking_number TEXT,
  shipment_tracking_number TEXT,

  -- Original order reference
  original_shipment_id INTEGER,               -- Links to shipments table
  store_order_id TEXT,                        -- Customer-facing order #
  customer_name TEXT,

  -- Invoice info
  invoice_amount DECIMAL(10,2),
  invoice_currency TEXT DEFAULT 'USD',

  -- Fulfillment center
  fc_id INTEGER,
  fc_name TEXT,

  -- Channel
  channel_id INTEGER,
  channel_name TEXT,

  -- All date fields from 2025-07 API
  insert_date TIMESTAMPTZ,
  awaiting_arrival_date TIMESTAMPTZ,
  arrived_date TIMESTAMPTZ,
  processing_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  cancelled_date TIMESTAMPTZ,

  -- Full status timeline as JSONB
  -- Array of {status, timestamp}
  status_history JSONB,

  -- Inventory items as JSONB
  -- Each item has: id, name, sku, quantity, action_requested, action_taken, lot_information
  inventory JSONB,

  synced_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_returns_shipbob_id UNIQUE (shipbob_return_id)
);

CREATE INDEX idx_returns_client ON returns(client_id);
CREATE INDEX idx_returns_merchant ON returns(merchant_id);
CREATE INDEX idx_returns_status ON returns(status);
CREATE INDEX idx_returns_original_shipment ON returns(original_shipment_id);

-- ============================================
-- PART 3: Receiving Orders (WROs) Table
-- ============================================
-- Stores warehouse receiving orders from 2025-07 /receiving endpoint
-- Inventory quantities array stored as JSONB

DROP TABLE IF EXISTS receiving_orders CASCADE;

CREATE TABLE receiving_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id TEXT,

  -- ShipBob identifiers
  shipbob_receiving_id INTEGER NOT NULL,
  purchase_order_number TEXT,

  -- WRO details
  status TEXT,                                -- 'Awaiting', 'Processing', 'Completed', 'Cancelled'
  package_type TEXT,                          -- 'Pallet', 'Package', 'FloorLoaded'
  box_packaging_type TEXT,                    -- 'OneSkuPerBox', 'MultipleSkusPerBox'

  -- Fulfillment center
  fc_id INTEGER,
  fc_name TEXT,
  fc_timezone TEXT,
  fc_address TEXT,
  fc_city TEXT,
  fc_state TEXT,
  fc_country TEXT,
  fc_zip TEXT,

  -- Dates
  expected_arrival_date TIMESTAMPTZ,
  insert_date TIMESTAMPTZ,
  last_updated_date TIMESTAMPTZ,

  -- Status history as JSONB
  -- Array of {status, timestamp, id}
  status_history JSONB,

  -- Inventory quantities as JSONB
  -- Each item has: inventory_id, sku, expected_quantity, received_quantity, stowed_quantity
  inventory_quantities JSONB,

  -- Box labels
  box_labels_uri TEXT,

  synced_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_receiving_orders_shipbob_id UNIQUE (shipbob_receiving_id)
);

CREATE INDEX idx_receiving_orders_client ON receiving_orders(client_id);
CREATE INDEX idx_receiving_orders_merchant ON receiving_orders(merchant_id);
CREATE INDEX idx_receiving_orders_status ON receiving_orders(status);
CREATE INDEX idx_receiving_orders_po ON receiving_orders(purchase_order_number);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- After running migration, verify tables exist:
--
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('products', 'returns', 'receiving_orders');
--
-- ============================================
-- MIGRATION COMPLETE
-- ============================================
