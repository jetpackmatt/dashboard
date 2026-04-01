-- Weekly average shipping cost trend for a specific SKU (single-unit orders only)
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
      to_char(date_trunc('week', t.created_at), 'YYYY-MM-DD') AS week,
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
    -- Single-unit orders only: exactly 1 line item with quantity 1
    JOIN (
      SELECT shipment_id
      FROM shipment_items
      WHERE client_id = p_client_id
      GROUP BY shipment_id
      HAVING COUNT(*) = 1 AND SUM(quantity) = 1
    ) single ON single.shipment_id = si.shipment_id
    WHERE si.sku = p_sku
      AND s.client_id = p_client_id
      AND t.created_at >= p_start::date
      AND t.created_at < (p_end::date + INTERVAL '1 day')
      AND (p_country = 'ALL' OR s.destination_country = p_country)
    GROUP BY date_trunc('week', t.created_at)
    ORDER BY date_trunc('week', t.created_at) ASC
  ) r;
$$;
