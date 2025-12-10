-- ============================================================================
-- RPC Function: get_shipments_by_age
-- Calculates age at query time and filters/paginates in the database
-- IMPORTANT: Sorts by label_generation_date DESC to match UI expectations
--
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================================

CREATE OR REPLACE FUNCTION get_shipments_by_age(
  p_client_id UUID,
  p_age_ranges JSONB,  -- Array of {min: number, max: number|null} e.g., [{"min":0,"max":1},{"min":7,"max":null}]
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0,
  p_status_filter TEXT[] DEFAULT NULL,
  p_type_filter TEXT[] DEFAULT NULL,
  p_channel_filter TEXT[] DEFAULT NULL,
  p_carrier_filter TEXT[] DEFAULT NULL,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE(
  shipment_id UUID,
  age_days NUMERIC,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH age_calc AS (
    -- Calculate age for shipped shipments
    -- Age = time from label creation (event_labeled) to delivery (delivered_date) or now
    SELECT
      s.id as sid,
      EXTRACT(EPOCH FROM (COALESCE(s.delivered_date, NOW()) - s.event_labeled)) / 86400.0 as calc_age,
      s.status,
      s.delivered_date,
      s.carrier,
      s.event_labeled,  -- Include for sorting (label creation date)
      o.order_type,
      o.channel_name
    FROM shipments s
    INNER JOIN orders o ON s.order_id = o.id
    WHERE s.event_labeled IS NOT NULL  -- Only include shipments with label date
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
      -- Date range filter
      AND (p_start_date IS NULL OR o.order_import_date >= p_start_date)
      AND (p_end_date IS NULL OR o.order_import_date <= p_end_date + INTERVAL '1 day')
      -- Type filter
      AND (p_type_filter IS NULL OR o.order_type = ANY(p_type_filter))
      -- Channel filter
      AND (p_channel_filter IS NULL OR o.channel_name = ANY(p_channel_filter))
      -- Carrier filter
      AND (p_carrier_filter IS NULL OR s.carrier = ANY(p_carrier_filter))
  ),
  filtered AS (
    -- Filter by age ranges (match ANY of the provided ranges)
    SELECT ac.sid, ac.calc_age, ac.event_labeled
    FROM age_calc ac
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_age_ranges) r
      WHERE ac.calc_age >= (r->>'min')::NUMERIC
        AND (r->>'max' IS NULL OR ac.calc_age < (r->>'max')::NUMERIC)
    )
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM filtered
  )
  SELECT
    f.sid as shipment_id,
    f.calc_age as age_days,
    c.cnt as total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.event_labeled DESC NULLS LAST  -- Sort by label date (most recent first)
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION get_shipments_by_age TO authenticated;
GRANT EXECUTE ON FUNCTION get_shipments_by_age TO service_role;

-- ============================================================================
-- Test the function (run after creating):
-- ============================================================================
-- SELECT * FROM get_shipments_by_age(
--   '6b94c274-0446-4167-9d02-b998f8be59ad'::UUID,  -- client_id (Henson)
--   '[{"min": 7, "max": null}]'::JSONB,             -- 7+ days age
--   50,                                              -- limit
--   0                                                -- offset
-- );
