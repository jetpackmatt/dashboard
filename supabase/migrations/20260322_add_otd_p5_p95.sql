-- Add P5/P95 extremes + weighted average for Order-to-Delivery spectrum
-- Called alongside existing get_otd_percentiles to show full distribution

CREATE OR REPLACE FUNCTION get_otd_extreme_percentiles(
  p_client_id UUID,
  p_start_date TEXT,
  p_end_date TEXT,
  p_country TEXT DEFAULT 'ALL',
  p_state TEXT DEFAULT NULL,
  p_include_delayed BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
SET statement_timeout = '30s'
AS $$
  -- Same query logic as get_otd_percentiles but computes P5, P95, and mean
  WITH delivered AS (
    SELECT
      EXTRACT(EPOCH FROM (s.event_delivered - o.order_import_date)) / 86400.0 AS delivery_days
    FROM shipments s
    INNER JOIN LATERAL (
      SELECT o2.order_import_date, o2.state
      FROM orders o2
      WHERE o2.shipbob_order_id = s.shipbob_order_id
        AND o2.client_id = s.client_id
      ORDER BY o2.id DESC
      LIMIT 1
    ) o ON true
    WHERE s.deleted_at IS NULL
      AND s.event_delivered IS NOT NULL
      AND s.transit_time_days > 0
      AND s.event_labeled >= p_start_date::timestamptz
      AND s.event_labeled <= (p_end_date || 'T23:59:59.999Z')::timestamptz
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
      AND (p_country = 'ALL' OR s.fc_name IN (SELECT name FROM fulfillment_centers WHERE country = p_country))
      AND (p_state IS NULL OR normalize_state_code(COALESCE(o.state, ''), COALESCE(s.destination_country, 'US')) = p_state)
      AND o.order_import_date IS NOT NULL
      AND EXTRACT(EPOCH FROM (s.event_delivered - o.order_import_date)) / 86400.0 BETWEEN 0 AND 60
      AND EXTRACT(EPOCH FROM (s.event_labeled - o.order_import_date)) / 3600.0 BETWEEN 0 AND 720
  )
  SELECT json_build_object(
    'otd_p5',   round((percentile_cont(0.05) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1),
    'otd_p95',  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1),
    'otd_mean', round(avg(delivery_days)::numeric, 1)
  )
  FROM delivered;
$$;
