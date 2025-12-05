-- Migration: Split shipments table into orders + shipments
-- Date: 2025-11-27
-- Reason: Orders are the stable entity; one order can have multiple shipments
--
-- IMPORTANT: Run this in Supabase SQL Editor
-- Back up data before running in production!

-- ============================================
-- STEP 1: Create new orders table
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,

  -- ShipBob identifiers
  shipbob_order_id TEXT NOT NULL,        -- Stable order identifier from ShipBob
  store_order_id TEXT,                    -- Customer-facing order # (Shopify/BigCommerce)

  -- Order details (stable, set at order creation)
  customer_name TEXT,
  order_date DATE,
  status TEXT,                            -- Processing, Fulfilled, Cancelled, etc.

  -- Destination (from order, not shipment)
  zip_code TEXT,
  city TEXT,
  state TEXT,
  country TEXT,

  -- Order classification
  order_category TEXT,                    -- e.g., 'standard', 'express', 'economy'

  -- Aggregated totals (calculated from shipments)
  total_shipments INTEGER DEFAULT 0,
  total_base_cost DECIMAL(10,2) DEFAULT 0,
  total_marked_up_cost DECIMAL(10,2) DEFAULT 0,

  -- Metadata
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint on client_id + shipbob_order_id
  CONSTRAINT orders_client_shipbob_order_unique UNIQUE (client_id, shipbob_order_id)
);

-- Indexes for orders table
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_store_order ON orders(client_id, store_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- ============================================
-- STEP 2: Rename old shipments table (backup)
-- ============================================
ALTER TABLE IF EXISTS shipments RENAME TO shipments_old;

-- ============================================
-- STEP 3: Create new shipments table
-- ============================================
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,

  -- ShipBob identifiers
  shipment_id TEXT NOT NULL,              -- Used for claims, disputes, tracking
  shipbob_order_id TEXT,                  -- Denormalized for convenience
  tracking_id TEXT,

  -- Shipment details
  status TEXT,                            -- Processing, LabeledCreated, Completed, Cancelled
  label_generation_date DATE,
  shipped_date TIMESTAMPTZ,
  delivered_date TIMESTAMPTZ,
  transit_time_days DECIMAL(5,2),

  -- Carrier & service
  carrier TEXT,
  carrier_service TEXT,
  ship_option_id INTEGER,                 -- ShipBob Ship Option ID (146, 49, 3, etc.)
  zone_used INTEGER,
  fc_name TEXT,

  -- Package dimensions & weights
  actual_weight_oz DECIMAL(10,2),
  dim_weight_oz DECIMAL(10,2),            -- Calculated: (L*W*H)/139
  billable_weight_oz DECIMAL(10,2),       -- max(actual, dim)
  length DECIMAL(6,2),
  width DECIMAL(6,2),
  height DECIMAL(6,2),

  -- BASE costs (ShipBob's cost to us)
  base_fulfillment_cost DECIMAL(10,2),
  base_surcharge DECIMAL(10,2),
  base_insurance DECIMAL(10,2),
  base_total_cost DECIMAL(10,2),

  -- MARKED UP costs (what client sees/pays)
  marked_up_fulfillment_cost DECIMAL(10,2),
  marked_up_surcharge DECIMAL(10,2),
  marked_up_insurance DECIMAL(10,2),
  marked_up_total_cost DECIMAL(10,2),

  -- Metadata
  invoice_number TEXT,
  invoice_date DATE,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint on shipment_id
  CONSTRAINT shipments_shipment_id_unique UNIQUE (shipment_id)
);

-- Indexes for shipments table
CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments(client_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_shipbob_order ON shipments(shipbob_order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_shipments_date ON shipments(label_generation_date);

-- ============================================
-- STEP 4: Migrate data from shipments_old
-- ============================================

-- 4a. Insert unique orders (deduplicated by shipbob_order_id)
INSERT INTO orders (
  client_id,
  shipbob_order_id,
  store_order_id,
  customer_name,
  order_date,
  status,
  zip_code,
  city,
  state,
  country,
  created_at,
  updated_at
)
SELECT DISTINCT ON (client_id, shipbob_order_id)
  client_id,
  shipbob_order_id,
  store_order_id,
  customer_name,
  order_date,
  transaction_status as status,
  zip_code,
  city,
  state,
  country,
  created_at,
  updated_at
FROM shipments_old
WHERE shipbob_order_id IS NOT NULL
ORDER BY client_id, shipbob_order_id, created_at DESC;

-- 4b. Insert shipments with FK to orders
INSERT INTO shipments (
  client_id,
  order_id,
  shipment_id,
  shipbob_order_id,
  tracking_id,
  status,
  label_generation_date,
  carrier,
  carrier_service,
  ship_option_id,
  zone_used,
  fc_name,
  actual_weight_oz,
  dim_weight_oz,
  billable_weight_oz,
  length,
  width,
  height,
  base_fulfillment_cost,
  base_surcharge,
  base_insurance,
  base_total_cost,
  marked_up_fulfillment_cost,
  marked_up_surcharge,
  marked_up_insurance,
  marked_up_total_cost,
  invoice_number,
  invoice_date,
  raw_data,
  created_at,
  updated_at
)
SELECT
  so.client_id,
  o.id as order_id,
  so.shipment_id,
  so.shipbob_order_id,
  so.tracking_id,
  so.transaction_status as status,
  so.label_generation_date::DATE,
  so.carrier,
  so.carrier_service,
  so.ship_option_id::INTEGER,
  so.zone_used::INTEGER,
  so.fc_name,
  so.actual_weight_oz,
  so.dim_weight_oz,
  so.billable_weight_oz,
  so.length,
  so.width,
  so.height,
  so.base_fulfillment_cost,
  so.base_surcharge,
  so.base_insurance,
  so.base_total_cost,
  so.marked_up_fulfillment_cost,
  so.marked_up_surcharge,
  so.marked_up_insurance,
  so.marked_up_total_cost,
  so.invoice_number,
  so.invoice_date,
  so.raw_data,
  so.created_at,
  so.updated_at
FROM shipments_old so
JOIN orders o ON o.client_id = so.client_id AND o.shipbob_order_id = so.shipbob_order_id
WHERE so.shipment_id IS NOT NULL;

-- ============================================
-- STEP 5: Update order aggregates
-- ============================================
UPDATE orders o SET
  total_shipments = (
    SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id
  ),
  total_base_cost = (
    SELECT COALESCE(SUM(base_total_cost), 0) FROM shipments s WHERE s.order_id = o.id
  ),
  total_marked_up_cost = (
    SELECT COALESCE(SUM(marked_up_total_cost), 0) FROM shipments s WHERE s.order_id = o.id
  );

-- ============================================
-- STEP 6: Enable RLS on new tables
-- ============================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

-- RLS policies (service_role only - no browser access)
-- Same pattern as existing tables

-- ============================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================
-- Check counts match:
-- SELECT 'orders' as table_name, COUNT(*) FROM orders
-- UNION ALL
-- SELECT 'shipments', COUNT(*) FROM shipments
-- UNION ALL
-- SELECT 'shipments_old', COUNT(*) FROM shipments_old;

-- Check multi-shipment orders:
-- SELECT total_shipments, COUNT(*) as order_count
-- FROM orders
-- GROUP BY total_shipments
-- ORDER BY total_shipments;

-- ============================================
-- CLEANUP (run after verification)
-- ============================================
-- DROP TABLE IF EXISTS shipments_old;
