-- PostgreSQL Full-Text Search Migration
-- This adds tsvector columns and GIN indexes for fast search on shipments and orders

-- ============================================================================
-- SHIPMENTS TABLE - Full-text search on recipient_name, tracking_id
-- ============================================================================

-- 1. Add search_vector column to shipments
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS shipments_search_idx ON shipments USING GIN (search_vector);

-- 3. Create function to update search vector
CREATE OR REPLACE FUNCTION shipments_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.recipient_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.tracking_id, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.shipbob_order_id::text, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.shipment_id::text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger to auto-update on INSERT/UPDATE
DROP TRIGGER IF EXISTS shipments_search_vector_trigger ON shipments;
CREATE TRIGGER shipments_search_vector_trigger
  BEFORE INSERT OR UPDATE OF recipient_name, tracking_id, shipbob_order_id, shipment_id
  ON shipments
  FOR EACH ROW
  EXECUTE FUNCTION shipments_search_vector_update();

-- 5. Backfill existing rows (run in batches for large tables)
UPDATE shipments SET search_vector =
  setweight(to_tsvector('english', coalesce(recipient_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(tracking_id, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(shipbob_order_id::text, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(shipment_id::text, '')), 'C')
WHERE search_vector IS NULL;

-- ============================================================================
-- ORDERS TABLE - Full-text search on customer_name, store_order_id
-- ============================================================================

-- 1. Add search_vector column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Create GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS orders_search_idx ON orders USING GIN (search_vector);

-- 3. Create function to update search vector
CREATE OR REPLACE FUNCTION orders_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.customer_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.store_order_id, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.shipbob_order_id::text, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger to auto-update on INSERT/UPDATE
DROP TRIGGER IF EXISTS orders_search_vector_trigger ON orders;
CREATE TRIGGER orders_search_vector_trigger
  BEFORE INSERT OR UPDATE OF customer_name, store_order_id, shipbob_order_id
  ON orders
  FOR EACH ROW
  EXECUTE FUNCTION orders_search_vector_update();

-- 5. Backfill existing rows
UPDATE orders SET search_vector =
  setweight(to_tsvector('english', coalesce(customer_name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(store_order_id, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(shipbob_order_id::text, '')), 'C')
WHERE search_vector IS NULL;

-- ============================================================================
-- HELPER FUNCTION for prefix search (websearch_to_tsquery doesn't support prefix)
-- ============================================================================

-- Function to convert search input to tsquery with prefix matching
CREATE OR REPLACE FUNCTION search_to_tsquery(search_text text) RETURNS tsquery AS $$
DECLARE
  result tsquery;
BEGIN
  -- Handle empty input
  IF search_text IS NULL OR trim(search_text) = '' THEN
    RETURN NULL;
  END IF;

  -- Split into words, add :* for prefix matching on each word
  -- Example: "john doe" -> "john:* & doe:*"
  SELECT string_agg(word || ':*', ' & ')::tsquery
  INTO result
  FROM unnest(string_to_array(trim(regexp_replace(search_text, '\s+', ' ', 'g')), ' ')) AS word
  WHERE word <> '';

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- USAGE EXAMPLES (for reference)
-- ============================================================================

-- Search shipments:
-- SELECT * FROM shipments
-- WHERE search_vector @@ search_to_tsquery('john')
-- AND client_id = 'xxx'
-- ORDER BY ts_rank(search_vector, search_to_tsquery('john')) DESC
-- LIMIT 50;

-- Search orders:
-- SELECT * FROM orders
-- WHERE search_vector @@ search_to_tsquery('smith')
-- AND client_id = 'xxx'
-- ORDER BY ts_rank(search_vector, search_to_tsquery('smith')) DESC
-- LIMIT 50;
