-- Fix get_shipments_by_age RPC function
-- Version 2: Added proper status filter support
--
-- The status filter now handles:
--   - 'delivered' -> event_delivered IS NOT NULL
--   - 'exception' -> status_details contains DeliveryException or DeliveryAttemptFailed
--   - 'labelled' -> status = 'LabeledCreated'
--   - 'awaiting carrier' -> status = 'AwaitingCarrierScan' or similar
--   - 'in transit' -> status_details contains InTransit
--   - 'out for delivery' -> status_details contains OutForDelivery
--
-- Run this in Supabase SQL Editor to fix the status filter not being applied

CREATE OR REPLACE FUNCTION public.get_shipments_by_age(
  p_client_id uuid,
  p_age_ranges jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status_filter text[] DEFAULT NULL::text[],
  p_type_filter text[] DEFAULT NULL::text[],
  p_channel_filter text[] DEFAULT NULL::text[],
  p_carrier_filter text[] DEFAULT NULL::text[],
  p_start_date date DEFAULT NULL::date,
  p_end_date date DEFAULT NULL::date
)
RETURNS TABLE(shipment_id uuid, age_days numeric, total_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH age_calc AS (
    SELECT
      s.id as sid,
      -- Age = time from label creation to delivery (or now if not delivered)
      EXTRACT(EPOCH FROM (COALESCE(s.event_delivered, NOW()) - s.event_labeled)) / 86400.0 as calc_age,
      s.status,
      s.status_details,
      s.event_delivered,
      s.carrier,
      s.event_labeled,
      o.order_type,
      o.channel_name,
      o.order_import_date
    FROM shipments s
    INNER JOIN orders o ON s.order_id = o.id
    WHERE s.event_labeled IS NOT NULL
      AND s.deleted_at IS NULL
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
      AND (p_start_date IS NULL OR o.order_import_date >= p_start_date)
      AND (p_end_date IS NULL OR o.order_import_date <= p_end_date + INTERVAL '1 day')
      AND (p_type_filter IS NULL OR o.order_type = ANY(p_type_filter))
      AND (p_channel_filter IS NULL OR o.channel_name = ANY(p_channel_filter))
      AND (p_carrier_filter IS NULL OR s.carrier = ANY(p_carrier_filter))
  ),
  -- Apply status filter (matching the JavaScript logic in route.ts)
  status_filtered AS (
    SELECT ac.*
    FROM age_calc ac
    WHERE p_status_filter IS NULL
       OR (
         -- delivered: event_delivered IS NOT NULL
         ('delivered' = ANY(p_status_filter) AND ac.event_delivered IS NOT NULL)
         OR
         -- exception: status_details contains DeliveryException or DeliveryAttemptFailed
         ('exception' = ANY(p_status_filter) AND (
           ac.status_details->0->>'name' = 'DeliveryException'
           OR ac.status_details->0->>'name' = 'DeliveryAttemptFailed'
         ))
         OR
         -- labelled: status = 'LabeledCreated'
         ('labelled' = ANY(p_status_filter) AND ac.status = 'LabeledCreated')
         OR
         -- awaiting carrier: various conditions
         ('awaiting carrier' = ANY(p_status_filter) AND (
           ac.status = 'AwaitingCarrierScan'
           OR ac.status_details->0->>'name' = 'AwaitingCarrierScan'
           OR ac.status_details->0->>'description' ILIKE '%Carrier%'
         ))
         OR
         -- in transit: status_details contains InTransit
         ('in transit' = ANY(p_status_filter) AND ac.status_details->0->>'name' = 'InTransit')
         OR
         -- out for delivery: status_details contains OutForDelivery AND not yet delivered
         ('out for delivery' = ANY(p_status_filter) AND ac.status_details->0->>'name' = 'OutForDelivery' AND ac.event_delivered IS NULL)
       )
  ),
  -- Apply age filter
  age_filtered AS (
    SELECT sf.sid, sf.calc_age, sf.event_labeled
    FROM status_filtered sf
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_age_ranges) r
      WHERE sf.calc_age >= (r->>'min')::NUMERIC
        AND (r->>'max' IS NULL OR sf.calc_age < (r->>'max')::NUMERIC)
    )
  ),
  counted AS (
    SELECT COUNT(*) as cnt FROM age_filtered
  )
  SELECT
    f.sid as shipment_id,
    f.calc_age as age_days,
    c.cnt as total_count
  FROM age_filtered f
  CROSS JOIN counted c
  ORDER BY f.event_labeled DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

-- Add an index to speed up the age filter query
CREATE INDEX IF NOT EXISTS idx_shipments_age_filter
ON shipments (event_labeled DESC, client_id, deleted_at)
WHERE event_labeled IS NOT NULL AND deleted_at IS NULL;

-- Verify the function works without status filter
SELECT 'Test 1: Age filter only (15+ days)' as test;
SELECT * FROM get_shipments_by_age(
  NULL,  -- p_client_id (NULL = all clients for admin)
  '[{"min": 15, "max": null}]'::jsonb,  -- 15+ days
  5,     -- limit
  0,     -- offset
  NULL, NULL, NULL, NULL, NULL, NULL
);

-- Verify the function works WITH status filter (delivered + 15+ days)
SELECT 'Test 2: Delivered + 15+ days' as test;
SELECT * FROM get_shipments_by_age(
  NULL,  -- p_client_id (NULL = all clients for admin)
  '[{"min": 15, "max": null}]'::jsonb,  -- 15+ days
  5,     -- limit
  0,     -- offset
  ARRAY['delivered']::text[],  -- Status filter: delivered only
  NULL, NULL, NULL, NULL, NULL
);
