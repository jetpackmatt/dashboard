-- Function to backfill missing shipment_items.quantity from order_items
-- Used by sync code to fill in quantities when API doesn't provide them

CREATE OR REPLACE FUNCTION backfill_shipment_item_quantities(p_shipment_ids TEXT[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update shipment_items where quantity is NULL
  -- Match by order_id (via shipments table) and shipbob_product_id
  UPDATE shipment_items si
  SET quantity = oi.quantity
  FROM shipments s
  JOIN order_items oi ON oi.order_id = s.order_id AND oi.shipbob_product_id = si.shipbob_product_id
  WHERE si.shipment_id = s.shipment_id
    AND si.shipment_id = ANY(p_shipment_ids)
    AND si.quantity IS NULL
    AND oi.quantity IS NOT NULL;
END;
$$;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION backfill_shipment_item_quantities(TEXT[]) TO service_role;
