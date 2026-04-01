-- Filter SKU cost trend to shipments where selected SKU has quantity = 1
-- This excludes bundle/multi-qty orders that inflate per-shipment cost
-- but still includes multi-SKU shipments (e.g., branded box + product)
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
      AND COALESCE(si.quantity, 1) = 1
      AND s.client_id = p_client_id
      AND s.deleted_at IS NULL
      AND s.event_labeled >= p_start::date
      AND s.event_labeled < (p_end::date + INTERVAL '1 day')
      AND (p_country = 'ALL' OR s.destination_country = p_country)
    GROUP BY date_trunc('week', s.event_labeled)
    ORDER BY date_trunc('week', s.event_labeled) ASC
  ) r;
$$;
