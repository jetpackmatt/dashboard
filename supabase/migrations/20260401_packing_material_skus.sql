-- Packing material SKUs: items like branded boxes and inserts that ship
-- with every order but aren't real products. Excluded from analytics
-- so single-product shipment filters work correctly.

CREATE TABLE public.packing_material_skus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  sku TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, sku)
);

ALTER TABLE public.packing_material_skus ENABLE ROW LEVEL SECURITY;

-- Seed: Eli Health packing materials
INSERT INTO public.packing_material_skus (client_id, sku, name) VALUES
  ('e6220921-695e-41f9-9f49-af3e0cdc828a', 'KIT-C1', 'Eli Branded Box'),
  ('e6220921-695e-41f9-9f49-af3e0cdc828a', 'PRINT-QSG-V1', 'Quick Start Guide');

-- Update get_cost_by_sku to exclude packing material from product dropdown
CREATE OR REPLACE FUNCTION public.get_cost_by_sku(
  p_client_id UUID,
  p_start TEXT,
  p_end TEXT,
  p_country TEXT DEFAULT 'ALL',
  p_limit INTEGER DEFAULT 20
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_agg(row_to_json(r))
    FROM (
      SELECT
        si.sku,
        MAX(si.name) AS product_name,
        COUNT(DISTINCT s.shipment_id) AS order_count,
        ROUND(COALESCE(SUM(t.billed_amount::numeric), 0), 2) AS total_cost,
        CASE
          WHEN COUNT(DISTINCT s.shipment_id) > 0
          THEN ROUND(COALESCE(SUM(t.billed_amount::numeric), 0) / COUNT(DISTINCT s.shipment_id), 2)
          ELSE 0
        END AS avg_cost_per_order
      FROM shipment_items si
      JOIN shipments s ON s.shipment_id = si.shipment_id AND s.client_id = si.client_id
      JOIN transactions t ON t.reference_id = s.shipment_id
        AND t.client_id = s.client_id
        AND t.fee_type = 'Shipping'
        AND t.is_voided IS NOT TRUE
      LEFT JOIN packing_material_skus pm ON pm.client_id = si.client_id AND pm.sku = si.sku
      WHERE si.client_id = p_client_id
        AND pm.id IS NULL
        AND s.deleted_at IS NULL
        AND s.event_labeled >= p_start::date
        AND s.event_labeled < (p_end::date + interval '1 day')
        AND (p_country = 'ALL' OR s.fc_name IN (
          SELECT name FROM fulfillment_centers WHERE country = p_country
        ))
      GROUP BY si.sku
      ORDER BY COUNT(DISTINCT s.shipment_id) DESC
      LIMIT p_limit
    ) r
  );
END;
$$;

-- Update get_sku_cost_trend: avg shipping cost grouped by week AND quantity
-- All shipments containing the SKU, with qty dropdown for filtering on frontend
CREATE OR REPLACE FUNCTION public.get_sku_cost_trend(
  p_client_id UUID,
  p_sku TEXT,
  p_start TEXT,
  p_end TEXT,
  p_country TEXT DEFAULT 'ALL'
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
  FROM (
    SELECT
      to_char(date_trunc('week', s.event_labeled), 'YYYY-MM-DD') AS week,
      COALESCE(si.quantity, 1)::int AS qty,
      COUNT(DISTINCT s.shipment_id)::int AS order_count,
      ROUND(COALESCE(SUM(t.billed_amount::numeric), 0), 2) AS total_cost,
      CASE
        WHEN COUNT(DISTINCT s.shipment_id) > 0
        THEN ROUND(COALESCE(SUM(t.billed_amount::numeric), 0) / COUNT(DISTINCT s.shipment_id), 2)
        ELSE 0
      END AS avg_cost_per_order
    FROM shipment_items si
    JOIN shipments s ON s.shipment_id = si.shipment_id
    JOIN transactions t ON t.reference_id = s.shipment_id
      AND t.fee_type = 'Shipping'
      AND t.is_voided IS NOT TRUE
    WHERE si.sku = p_sku
      AND s.client_id = p_client_id
      AND s.deleted_at IS NULL
      AND s.event_labeled >= p_start::date
      AND s.event_labeled < (p_end::date + INTERVAL '1 day')
      AND (p_country = 'ALL' OR s.destination_country = p_country)
    GROUP BY date_trunc('week', s.event_labeled), COALESCE(si.quantity, 1)
    ORDER BY date_trunc('week', s.event_labeled) ASC, COALESCE(si.quantity, 1) ASC
  ) r;
$$;
