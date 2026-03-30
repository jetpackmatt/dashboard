-- RPC to aggregate KPI totals from analytics_daily_summaries in SQL
-- Replaces cursor-paginated JS aggregation (thousands of rows → 1 row)
CREATE OR REPLACE FUNCTION get_dashboard_kpi_totals(
  p_client_id uuid DEFAULT NULL,
  p_start date DEFAULT CURRENT_DATE - 90,
  p_end date DEFAULT CURRENT_DATE - 1
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'shipments', COALESCE(SUM(shipment_count), 0),
    'total_charge', COALESCE(SUM(total_charge), 0),
    'total_transit_days', COALESCE(SUM(total_transit_days), 0),
    'delivered_count', COALESCE(SUM(delivered_count), 0),
    'on_time_count', COALESCE(SUM(on_time_count), 0),
    'breached_count', COALESCE(SUM(breached_count), 0),
    'total_fulfill_business_hours', COALESCE(SUM(total_fulfill_business_hours), 0),
    'fulfill_count', COALESCE(SUM(fulfill_count), 0),
    'delay_count', COALESCE(SUM(delay_count), 0),
    'delay_fulfill_biz_hours', COALESCE(SUM(delay_fulfill_biz_hours), 0),
    'delay_on_time_count', COALESCE(SUM(delay_on_time_count), 0),
    'delay_breached_count', COALESCE(SUM(delay_breached_count), 0)
  ) INTO result
  FROM analytics_daily_summaries
  WHERE summary_date BETWEEN p_start AND p_end
    AND (p_client_id IS NULL OR client_id = p_client_id);

  RETURN result;
END;
$$;

-- RPC to get daily aggregates for volume chart + sparklines
-- Returns ~90 rows (one per date) instead of ~4,500 dimension rows
CREATE OR REPLACE FUNCTION get_dashboard_daily_aggregates(
  p_client_id uuid DEFAULT NULL,
  p_start date DEFAULT CURRENT_DATE - 90,
  p_end date DEFAULT CURRENT_DATE - 1
)
RETURNS TABLE(
  day date,
  shipments bigint,
  total_charge bigint,
  transit_days numeric,
  delivered bigint,
  on_time bigint,
  breached bigint,
  delay_on_time bigint,
  delay_breached bigint
)
LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.summary_date AS day,
    COALESCE(SUM(a.shipment_count), 0)::bigint AS shipments,
    COALESCE(SUM(a.total_charge), 0)::bigint AS total_charge,
    COALESCE(SUM(a.total_transit_days), 0)::numeric AS transit_days,
    COALESCE(SUM(a.delivered_count), 0)::bigint AS delivered,
    COALESCE(SUM(a.on_time_count), 0)::bigint AS on_time,
    COALESCE(SUM(a.breached_count), 0)::bigint AS breached,
    COALESCE(SUM(a.delay_on_time_count), 0)::bigint AS delay_on_time,
    COALESCE(SUM(a.delay_breached_count), 0)::bigint AS delay_breached
  FROM analytics_daily_summaries a
  WHERE a.summary_date BETWEEN p_start AND p_end
    AND (p_client_id IS NULL OR a.client_id = p_client_id)
  GROUP BY a.summary_date
  ORDER BY a.summary_date;
END;
$$;
