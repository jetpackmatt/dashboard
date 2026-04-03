-- Add origin_country to analytics_daily_summaries
-- This replaces the expensive FC subquery pattern:
--   fc_name IN (SELECT name FROM fulfillment_centers WHERE country = p_country)
-- with a simple equality check:
--   origin_country = p_country

-- 1. Add column + backfill + index
ALTER TABLE analytics_daily_summaries
  ADD COLUMN IF NOT EXISTS origin_country text NOT NULL DEFAULT 'US';

UPDATE analytics_daily_summaries ads
SET origin_country = COALESCE(fc.country, 'US')
FROM fulfillment_centers fc
WHERE ads.fc_name = fc.name
  AND ads.fc_name != ''
  AND fc.country IS NOT NULL
  AND fc.country != ads.origin_country;

CREATE INDEX IF NOT EXISTS idx_ads_origin_country
  ON analytics_daily_summaries (origin_country);

-- 2. Update refresh_analytics_summaries to populate origin_country
CREATE OR REPLACE FUNCTION refresh_analytics_summaries(p_batch_size int DEFAULT 50)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed int := 0;
  v_entry record;
BEGIN
  FOR v_entry IN
    SELECT client_id, summary_date
    FROM analytics_refresh_queue
    WHERE processed_at IS NULL
    ORDER BY created_at ASC
    LIMIT p_batch_size
  LOOP
    DELETE FROM analytics_daily_summaries
      WHERE client_id = v_entry.client_id AND summary_date = v_entry.summary_date;
    DELETE FROM analytics_billing_summaries
      WHERE client_id = v_entry.client_id AND summary_date = v_entry.summary_date;
    DELETE FROM analytics_city_summaries
      WHERE client_id = v_entry.client_id AND summary_date = v_entry.summary_date;

    DROP TABLE IF EXISTS _enriched;
    CREATE TEMP TABLE _enriched ON COMMIT DROP AS
    WITH base AS (
      SELECT
        s.shipment_id, s.shipbob_order_id, s.tracking_id,
        s.carrier, s.ship_option_name, s.zone_used,
        s.fc_name, s.actual_weight_oz, s.billable_weight_oz,
        s.destination_country, s.origin_country,
        s.event_labeled, s.event_delivered,
        s.transit_time_days, s.estimated_fulfillment_date_status,
        s.estimated_fulfillment_date,
        s.application_name AS shipment_store,
        s.order_type,
        fc_timezone(s.fc_name) AS tz,
        (s.event_logs::text LIKE '%OrderImportedToException%') AS had_oos_exception,
        (
          s.event_logs::text LIKE '%OrderImportedToException%'
          OR s.event_logs::text LIKE '%OrderMovedToOnHoldWithReason%'
        ) AS had_preship_event_delay,
        (
          s.event_logs::text LIKE '%DeliveryException%'
          OR s.event_logs::text LIKE '%DeliveryAttemptFailed%'
        ) AS had_postship_delay
      FROM shipments s
      WHERE s.client_id = v_entry.client_id
        AND s.deleted_at IS NULL
        AND (s.event_labeled AT TIME ZONE 'UTC')::date = v_entry.summary_date
    ),
    ord AS (
      SELECT DISTINCT ON (o.shipbob_order_id)
        o.shipbob_order_id, o.state, o.city,
        o.order_import_date, o.application_name AS order_store
      FROM orders o
      WHERE o.client_id = v_entry.client_id
        AND o.shipbob_order_id IN (SELECT shipbob_order_id FROM base WHERE shipbob_order_id IS NOT NULL)
      ORDER BY o.shipbob_order_id, o.id DESC
    ),
    tx AS (
      SELECT DISTINCT ON (t.tracking_id)
        t.tracking_id, t.base_charge, t.surcharge,
        t.total_charge, t.billed_amount, t.insurance_charge
      FROM transactions t
      WHERE t.client_id = v_entry.client_id
        AND t.fee_type = 'Shipping'
        AND t.transaction_type IS DISTINCT FROM 'Refund'
        AND (t.is_voided IS NULL OR t.is_voided = false)
        AND t.dispute_status IS NULL
        AND t.tracking_id IS NOT NULL
        AND t.tracking_id IN (SELECT tracking_id FROM base WHERE tracking_id IS NOT NULL)
      ORDER BY t.tracking_id, t.id DESC
    ),
    items AS (
      SELECT si.shipment_id, SUM(COALESCE(si.quantity, 1))::int AS qty
      FROM shipment_items si
      WHERE si.shipment_id IN (SELECT shipment_id FROM base)
      GROUP BY si.shipment_id
    )
    SELECT
      normalize_state_code(COALESCE(o.state, ''), COALESCE(b.destination_country, 'US')) AS dim_state,
      COALESCE(b.destination_country, 'US') AS dim_country,
      COALESCE(b.origin_country, 'US') AS dim_origin_country,
      COALESCE(b.carrier, '') AS dim_carrier,
      COALESCE(b.ship_option_name, '') AS dim_ship_option,
      COALESCE(b.zone_used::text, '') AS dim_zone,
      COALESCE(b.fc_name, '') AS dim_fc,
      COALESCE(o.order_store, b.shipment_store, '') AS dim_store,
      COALESCE(o.city, '') AS dim_city,
      COALESCE(chmap.order_type, b.order_type, 'DTC') AS dim_order_type,
      b.event_delivered,
      b.transit_time_days,
      b.estimated_fulfillment_date_status,
      b.actual_weight_oz,
      b.billable_weight_oz,
      b.had_oos_exception,
      (
        b.had_preship_event_delay
        OR b.estimated_fulfillment_date_status IN ('AwaitingInventoryAllocation', 'Unavailable')
        OR (
          b.estimated_fulfillment_date IS NOT NULL
          AND o.order_import_date IS NOT NULL
          AND EXTRACT(EPOCH FROM (b.estimated_fulfillment_date - o.order_import_date)) / 86400.0 > 6
        )
      ) AS had_preship_delay,
      b.had_postship_delay,
      COALESCE(i.qty, 1) AS item_qty,
      CASE
        WHEN COALESCE(t.base_charge, 0) > 0 THEN t.base_charge
        WHEN COALESCE(t.total_charge, t.billed_amount) IS NOT NULL
          THEN GREATEST(0, COALESCE(t.total_charge, t.billed_amount, 0) - COALESCE(t.surcharge, 0))
        ELSE 0
      END AS base_charge_val,
      CASE
        WHEN COALESCE(t.total_charge, t.billed_amount) IS NOT NULL THEN COALESCE(t.surcharge, 0)
        ELSE 0
      END AS surcharge_val,
      COALESCE(t.total_charge, t.billed_amount, 0) AS total_charge_val,
      COALESCE(t.insurance_charge, 0) AS insurance_val,
      b.event_labeled,
      o.order_import_date,
      b.tz,
      CASE
        WHEN o.order_import_date IS NOT NULL AND b.event_labeled IS NOT NULL
        THEN EXTRACT(EPOCH FROM (b.event_labeled - o.order_import_date)) / 3600.0
        ELSE NULL
      END AS fulfill_hours,
      CASE
        WHEN o.order_import_date IS NOT NULL AND b.event_labeled IS NOT NULL
        THEN business_hours_between(o.order_import_date, b.event_labeled, b.tz)
        ELSE NULL
      END AS fulfill_business_hours,
      CASE
        WHEN b.event_delivered IS NOT NULL AND o.order_import_date IS NOT NULL
        THEN EXTRACT(EPOCH FROM (b.event_delivered - o.order_import_date)) / 86400.0
        ELSE NULL
      END AS delivery_days,
      CASE
        WHEN o.order_import_date IS NOT NULL AND b.event_labeled IS NOT NULL
        THEN sla_deadline_biz(o.order_import_date, b.tz)
        ELSE NULL
      END AS sla_deadline,
      CASE
        WHEN b.carrier IS NOT NULL AND b.zone_used IS NOT NULL AND b.zone_used BETWEEN 1 AND 10 AND b.event_delivered IS NOT NULL THEN
          (SELECT CASE b.zone_used
            WHEN 1 THEN tb.zone_1_avg WHEN 2 THEN tb.zone_2_avg WHEN 3 THEN tb.zone_3_avg
            WHEN 4 THEN tb.zone_4_avg WHEN 5 THEN tb.zone_5_avg WHEN 6 THEN tb.zone_6_avg
            WHEN 7 THEN tb.zone_7_avg WHEN 8 THEN tb.zone_8_avg WHEN 9 THEN tb.zone_9_avg
            WHEN 10 THEN tb.zone_10_avg ELSE NULL END
           FROM transit_benchmarks tb
           WHERE tb.benchmark_type = 'carrier_service'
             AND tb.benchmark_key = b.carrier
             AND tb.benchmark_month = date_trunc('month', b.event_delivered)::date
           LIMIT 1)
        WHEN b.carrier IS NOT NULL AND b.origin_country IS NOT NULL AND b.destination_country IS NOT NULL
             AND b.origin_country != b.destination_country AND b.event_delivered IS NOT NULL THEN
          (SELECT tb.zone_1_avg
           FROM transit_benchmarks tb
           WHERE tb.benchmark_type = 'international_route'
             AND tb.benchmark_key = b.carrier || ':' || b.origin_country || ':' || b.destination_country
             AND tb.benchmark_month = date_trunc('month', b.event_delivered)::date
           LIMIT 1)
        ELSE NULL
      END AS benchmark_transit_days,
      CASE
        WHEN b.carrier IS NOT NULL AND b.zone_used IS NOT NULL AND b.zone_used BETWEEN 1 AND 10 AND b.event_delivered IS NOT NULL THEN
          (SELECT CASE b.zone_used
            WHEN 1 THEN tb.zone_1_p80 WHEN 2 THEN tb.zone_2_p80 WHEN 3 THEN tb.zone_3_p80
            WHEN 4 THEN tb.zone_4_p80 WHEN 5 THEN tb.zone_5_p80 WHEN 6 THEN tb.zone_6_p80
            WHEN 7 THEN tb.zone_7_p80 WHEN 8 THEN tb.zone_8_p80 WHEN 9 THEN tb.zone_9_p80
            WHEN 10 THEN tb.zone_10_p80 ELSE NULL END
           FROM transit_benchmarks tb
           WHERE tb.benchmark_type = 'carrier_service'
             AND tb.benchmark_key = b.carrier
             AND tb.benchmark_month = date_trunc('month', b.event_delivered)::date
           LIMIT 1)
        WHEN b.carrier IS NOT NULL AND b.origin_country IS NOT NULL AND b.destination_country IS NOT NULL
             AND b.origin_country != b.destination_country AND b.event_delivered IS NOT NULL THEN
          (SELECT tb.zone_1_p80
           FROM transit_benchmarks tb
           WHERE tb.benchmark_type = 'international_route'
             AND tb.benchmark_key = b.carrier || ':' || b.origin_country || ':' || b.destination_country
             AND tb.benchmark_month = date_trunc('month', b.event_delivered)::date
           LIMIT 1)
        ELSE NULL
      END AS benchmark_p80_days
    FROM base b
    LEFT JOIN ord o ON b.shipbob_order_id = o.shipbob_order_id
    LEFT JOIN tx t ON b.tracking_id = t.tracking_id
    LEFT JOIN items i ON b.shipment_id = i.shipment_id
    LEFT JOIN channel_order_type_mappings chmap
      ON chmap.client_id = v_entry.client_id
      AND chmap.channel_name = COALESCE(o.order_store, b.shipment_store);

    INSERT INTO analytics_daily_summaries (
      client_id, summary_date, state, country, origin_country, carrier, ship_option, zone, fc_name, store_name, order_type,
      shipment_count, delivered_count, undelivered_count, total_items,
      total_base_charge, total_surcharge, total_charge, total_insurance,
      total_actual_weight_oz, total_billable_weight_oz,
      total_transit_days, transit_count,
      total_fulfill_hours, total_fulfill_business_hours, fulfill_count,
      total_delivery_days, delivery_count,
      on_time_count, breached_count,
      oos_count, fulfilled_late_count,
      oos_exception_count, oos_exception_fulfill_hours, oos_exception_fulfill_biz_hours,
      oos_exception_delivery_days, oos_exception_delivery_count,
      delay_count, delay_fulfill_hours, delay_fulfill_biz_hours,
      delay_delivery_days, delay_delivery_count,
      delay_on_time_count, delay_breached_count,
      delivery_on_time_count, delivery_late_count,
      total_benchmark_transit_days, benchmark_transit_count
    )
    SELECT
      v_entry.client_id,
      v_entry.summary_date,
      dim_state, dim_country, dim_origin_country, dim_carrier, dim_ship_option, dim_zone, dim_fc, dim_store, dim_order_type,
      COUNT(*)::int,
      COUNT(*) FILTER (WHERE event_delivered IS NOT NULL)::int,
      COUNT(*) FILTER (WHERE event_delivered IS NULL)::int,
      SUM(item_qty)::int,
      ROUND(SUM(base_charge_val) * 100)::bigint,
      ROUND(SUM(surcharge_val) * 100)::bigint,
      ROUND(SUM(total_charge_val) * 100)::bigint,
      ROUND(SUM(insurance_val) * 100)::bigint,
      COALESCE(SUM(actual_weight_oz), 0),
      COALESCE(SUM(billable_weight_oz), 0),
      COALESCE(SUM(transit_time_days) FILTER (WHERE transit_time_days > 0 AND event_delivered IS NOT NULL), 0),
      COUNT(*) FILTER (WHERE transit_time_days > 0 AND event_delivered IS NOT NULL)::int,
      COALESCE(SUM(fulfill_hours) FILTER (WHERE fulfill_hours >= 0 AND fulfill_hours < 720), 0),
      COALESCE(SUM(fulfill_business_hours) FILTER (WHERE fulfill_hours >= 0 AND fulfill_hours < 720), 0),
      COUNT(*) FILTER (WHERE fulfill_hours >= 0 AND fulfill_hours < 720)::int,
      COALESCE(SUM(delivery_days) FILTER (WHERE delivery_days >= 0 AND delivery_days < 60), 0),
      COUNT(*) FILTER (WHERE delivery_days >= 0 AND delivery_days < 60)::int,
      COUNT(*) FILTER (WHERE estimated_fulfillment_date_status = 'FulfilledOnTime')::int,
      COUNT(*) FILTER (WHERE estimated_fulfillment_date_status = 'FulfilledLate')::int,
      COUNT(*) FILTER (WHERE estimated_fulfillment_date_status IN ('AwaitingInventoryAllocation', 'Unavailable'))::int,
      COUNT(*) FILTER (WHERE estimated_fulfillment_date_status = 'FulfilledLate')::int,
      COUNT(*) FILTER (WHERE had_oos_exception)::int,
      COALESCE(SUM(fulfill_hours) FILTER (WHERE had_oos_exception AND fulfill_hours >= 0 AND fulfill_hours < 720), 0),
      COALESCE(SUM(fulfill_business_hours) FILTER (WHERE had_oos_exception AND fulfill_hours >= 0 AND fulfill_hours < 720), 0),
      COALESCE(SUM(delivery_days) FILTER (WHERE had_oos_exception AND delivery_days >= 0 AND delivery_days < 60), 0),
      COUNT(*) FILTER (WHERE had_oos_exception AND delivery_days >= 0 AND delivery_days < 60)::int,
      COUNT(*) FILTER (WHERE had_preship_delay)::int,
      COALESCE(SUM(fulfill_hours) FILTER (WHERE had_preship_delay AND fulfill_hours >= 0 AND fulfill_hours < 720), 0),
      COALESCE(SUM(fulfill_business_hours) FILTER (WHERE had_preship_delay AND fulfill_hours >= 0 AND fulfill_hours < 720), 0),
      COALESCE(SUM(delivery_days) FILTER (WHERE had_preship_delay AND delivery_days >= 0 AND delivery_days < 60), 0),
      COUNT(*) FILTER (WHERE had_preship_delay AND delivery_days >= 0 AND delivery_days < 60)::int,
      COUNT(*) FILTER (WHERE had_preship_delay AND estimated_fulfillment_date_status = 'FulfilledOnTime')::int,
      COUNT(*) FILTER (WHERE had_preship_delay AND estimated_fulfillment_date_status = 'FulfilledLate')::int,
      COUNT(*) FILTER (WHERE event_delivered IS NOT NULL AND transit_time_days IS NOT NULL AND benchmark_p80_days IS NOT NULL AND transit_time_days <= benchmark_p80_days)::int,
      COUNT(*) FILTER (WHERE event_delivered IS NOT NULL AND transit_time_days IS NOT NULL AND benchmark_p80_days IS NOT NULL AND transit_time_days > benchmark_p80_days)::int,
      COALESCE(SUM(benchmark_transit_days) FILTER (WHERE event_delivered IS NOT NULL AND transit_time_days IS NOT NULL AND benchmark_transit_days IS NOT NULL), 0),
      COUNT(*) FILTER (WHERE event_delivered IS NOT NULL AND transit_time_days IS NOT NULL AND benchmark_transit_days IS NOT NULL)::int
    FROM _enriched
    GROUP BY dim_state, dim_country, dim_origin_country, dim_carrier, dim_ship_option, dim_zone, dim_fc, dim_store, dim_order_type;

    INSERT INTO analytics_city_summaries (
      client_id, summary_date, city, state, country, shipment_count, delay_count
    )
    SELECT
      v_entry.client_id, v_entry.summary_date,
      dim_city, dim_state, dim_country,
      COUNT(*)::int,
      COUNT(*) FILTER (WHERE had_preship_delay)::int
    FROM _enriched
    WHERE dim_city != ''
    GROUP BY dim_city, dim_state, dim_country;

    DROP TABLE IF EXISTS _enriched;

    INSERT INTO analytics_billing_summaries (
      client_id, summary_date, fee_type, country, transaction_count, total_amount
    )
    SELECT
      v_entry.client_id, v_entry.summary_date,
      t.fee_type,
      COALESCE(fc.country, 'US') AS country,
      COUNT(*)::int,
      ROUND(SUM(COALESCE(t.billed_amount, 0)) * 100)::bigint
    FROM transactions t
    LEFT JOIN fulfillment_centers fc ON t.fulfillment_center = fc.name
    WHERE t.client_id = v_entry.client_id
      AND t.fee_type != 'Shipping'
      AND t.transaction_type IS DISTINCT FROM 'Refund'
      AND (t.is_voided IS NULL OR t.is_voided = false)
      AND t.dispute_status IS NULL
      AND t.charge_date::date = v_entry.summary_date
    GROUP BY t.fee_type, COALESCE(fc.country, 'US');

    UPDATE analytics_refresh_queue
    SET processed_at = now()
    WHERE client_id = v_entry.client_id
      AND summary_date = v_entry.summary_date
      AND processed_at IS NULL;

    v_processed := v_processed + 1;
  END LOOP;

  DELETE FROM analytics_refresh_queue
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - interval '7 days';

  RETURN json_build_object('processed', v_processed);
END;
$$;

-- 3. Replace both overloads of get_analytics_from_summaries to use origin_country
--    instead of fc_name IN (SELECT name FROM fulfillment_centers WHERE country = p_country)

-- Drop existing overloads first (need exact signatures)
DROP FUNCTION IF EXISTS get_analytics_from_summaries(uuid, date, date, date, date, text, date);
DROP FUNCTION IF EXISTS get_analytics_from_summaries(uuid, date, date, date, date, text, date, boolean, boolean);

-- Overload 1: 7-parameter version (original)
CREATE OR REPLACE FUNCTION get_analytics_from_summaries(
  p_client_id uuid,
  p_start date,
  p_end date,
  p_prev_start date,
  p_prev_end date,
  p_country text DEFAULT 'ALL'::text,
  p_trend_start date DEFAULT NULL::date
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
  v_filter_country bool := (p_country != 'ALL');
  v_trend_start date := COALESCE(p_trend_start, p_start);
BEGIN
  SELECT json_build_object(
    'current', (
      SELECT json_build_object(
        'shipment_count', COALESCE(SUM(shipment_count), 0),
        'delivered_count', COALESCE(SUM(delivered_count), 0),
        'undelivered_count', COALESCE(SUM(undelivered_count), 0),
        'total_items', COALESCE(SUM(total_items), 0),
        'total_base_charge', COALESCE(SUM(total_base_charge), 0),
        'total_surcharge', COALESCE(SUM(total_surcharge), 0),
        'total_charge', COALESCE(SUM(total_charge), 0),
        'total_insurance', COALESCE(SUM(total_insurance), 0),
        'total_actual_weight_oz', COALESCE(SUM(total_actual_weight_oz), 0),
        'total_billable_weight_oz', COALESCE(SUM(total_billable_weight_oz), 0),
        'total_transit_days', COALESCE(SUM(total_transit_days), 0),
        'transit_count', COALESCE(SUM(transit_count), 0),
        'total_fulfill_hours', COALESCE(SUM(total_fulfill_hours), 0),
        'total_fulfill_business_hours', COALESCE(SUM(total_fulfill_business_hours), 0),
        'fulfill_count', COALESCE(SUM(fulfill_count), 0),
        'total_delivery_days', COALESCE(SUM(total_delivery_days), 0),
        'delivery_count', COALESCE(SUM(delivery_count), 0),
        'on_time_count', COALESCE(SUM(on_time_count), 0),
        'breached_count', COALESCE(SUM(breached_count), 0),
        'delay_on_time_count', COALESCE(SUM(delay_on_time_count), 0),
        'delay_breached_count', COALESCE(SUM(delay_breached_count), 0),
        'oos_count', COALESCE(SUM(oos_count), 0),
        'fulfilled_late_count', COALESCE(SUM(fulfilled_late_count), 0),
        'delay_count', COALESCE(SUM(delay_count), 0),
        'delay_fulfill_hours', COALESCE(SUM(delay_fulfill_hours), 0),
        'delay_fulfill_biz_hours', COALESCE(SUM(delay_fulfill_biz_hours), 0),
        'delay_delivery_days', COALESCE(SUM(delay_delivery_days), 0),
        'delay_delivery_count', COALESCE(SUM(delay_delivery_count), 0),
        'delivery_on_time_count', COALESCE(SUM(delivery_on_time_count), 0),
        'delivery_late_count', COALESCE(SUM(delivery_late_count), 0),
        'total_benchmark_transit_days', COALESCE(SUM(total_benchmark_transit_days), 0),
        'benchmark_transit_count', COALESCE(SUM(benchmark_transit_count), 0)
      )
      FROM analytics_daily_summaries
      WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end
        AND (NOT v_filter_country OR origin_country = p_country)
    ),

    'previous', (
      SELECT json_build_object(
        'shipment_count', COALESCE(SUM(shipment_count), 0),
        'delivered_count', COALESCE(SUM(delivered_count), 0),
        'undelivered_count', COALESCE(SUM(undelivered_count), 0),
        'total_charge', COALESCE(SUM(total_charge), 0),
        'total_transit_days', COALESCE(SUM(total_transit_days), 0),
        'transit_count', COALESCE(SUM(transit_count), 0),
        'on_time_count', COALESCE(SUM(on_time_count), 0),
        'breached_count', COALESCE(SUM(breached_count), 0),
        'delay_on_time_count', COALESCE(SUM(delay_on_time_count), 0),
        'delay_breached_count', COALESCE(SUM(delay_breached_count), 0),
        'delivery_on_time_count', COALESCE(SUM(delivery_on_time_count), 0),
        'delivery_late_count', COALESCE(SUM(delivery_late_count), 0),
        'total_benchmark_transit_days', COALESCE(SUM(total_benchmark_transit_days), 0),
        'benchmark_transit_count', COALESCE(SUM(benchmark_transit_count), 0)
      )
      FROM analytics_daily_summaries
      WHERE client_id = p_client_id AND summary_date BETWEEN p_prev_start AND p_prev_end
        AND (NOT v_filter_country OR origin_country = p_country)
    ),

    'by_state', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT state,
          SUM(shipment_count)::int AS shipment_count,
          SUM(delivered_count)::int AS delivered_count,
          SUM(total_fulfill_hours)::float AS total_fulfill_hours,
          SUM(total_fulfill_business_hours)::float AS total_fulfill_business_hours,
          SUM(fulfill_count)::int AS fulfill_count,
          SUM(total_delivery_days)::float AS total_delivery_days,
          SUM(delivery_count)::int AS delivery_count,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(delay_count)::int AS delay_count,
          SUM(delay_fulfill_biz_hours)::float AS delay_fulfill_biz_hours,
          SUM(delay_delivery_days)::float AS delay_delivery_days,
          SUM(delay_delivery_count)::int AS delay_delivery_count,
          SUM(delivery_on_time_count)::int AS delivery_on_time_count,
          SUM(delivery_late_count)::int AS delivery_late_count,
          SUM(total_benchmark_transit_days)::float AS total_benchmark_transit_days,
          SUM(benchmark_transit_count)::int AS benchmark_transit_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end
          AND state != ''
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY state
      ) sub
    ),

    'by_date', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.summary_date), '[]'::json)
      FROM (
        SELECT summary_date::text AS summary_date,
          SUM(shipment_count)::int AS shipment_count,
          SUM(delivered_count)::int AS delivered_count,
          SUM(total_items)::int AS total_items,
          SUM(total_base_charge)::bigint AS total_base_charge,
          SUM(total_surcharge)::bigint AS total_surcharge,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count,
          SUM(total_fulfill_hours)::float AS total_fulfill_hours,
          SUM(total_fulfill_business_hours)::float AS total_fulfill_business_hours,
          SUM(fulfill_count)::int AS fulfill_count,
          SUM(total_delivery_days)::float AS total_delivery_days,
          SUM(delivery_count)::int AS delivery_count,
          SUM(on_time_count)::int AS on_time_count,
          SUM(breached_count)::int AS breached_count,
          SUM(delay_on_time_count)::int AS delay_on_time_count,
          SUM(delay_breached_count)::int AS delay_breached_count,
          SUM(delay_count)::int AS delay_count,
          SUM(delay_fulfill_biz_hours)::float AS delay_fulfill_biz_hours,
          SUM(delay_delivery_days)::float AS delay_delivery_days,
          SUM(delay_delivery_count)::int AS delay_delivery_count,
          SUM(delivery_on_time_count)::int AS delivery_on_time_count,
          SUM(delivery_late_count)::int AS delivery_late_count,
          SUM(total_benchmark_transit_days)::float AS total_benchmark_transit_days,
          SUM(benchmark_transit_count)::int AS benchmark_transit_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN v_trend_start AND p_end
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY summary_date
      ) sub
    ),

    'by_carrier', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT carrier,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count,
          SUM(on_time_count)::int AS on_time_count,
          SUM(breached_count)::int AS breached_count,
          SUM(delay_on_time_count)::int AS delay_on_time_count,
          SUM(delay_breached_count)::int AS delay_breached_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end AND carrier != ''
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY carrier
      ) sub
    ),

    'by_ship_option', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT ship_option,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end AND ship_option != ''
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY ship_option
      ) sub
    ),

    'by_zone', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.zone), '[]'::json)
      FROM (
        SELECT zone,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end AND zone != ''
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY zone
      ) sub
    ),

    'by_fc', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT fc_name,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_fulfill_hours)::float AS total_fulfill_hours,
          SUM(total_fulfill_business_hours)::float AS total_fulfill_business_hours,
          SUM(fulfill_count)::int AS fulfill_count,
          SUM(on_time_count)::int AS on_time_count,
          SUM(breached_count)::int AS breached_count,
          SUM(delay_on_time_count)::int AS delay_on_time_count,
          SUM(delay_breached_count)::int AS delay_breached_count,
          SUM(delay_fulfill_biz_hours)::float AS delay_fulfill_biz_hours,
          SUM(delay_count)::int AS delay_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end AND fc_name != ''
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY fc_name
      ) sub
    ),

    'by_store', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT store_name,
          SUM(shipment_count)::int AS shipment_count
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end AND store_name != ''
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY store_name
      ) sub
    ),

    'by_city', (
      SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
      FROM (
        SELECT city, state,
          SUM(shipment_count)::int AS shipment_count,
          SUM(delay_count)::int AS delay_count
        FROM analytics_city_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end
          AND city != ''
          AND (NOT v_filter_country OR country = p_country)
        GROUP BY city, state
        ORDER BY SUM(shipment_count) DESC
        LIMIT 500
      ) sub
    ),

    'billing', (
      SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
      FROM (
        SELECT fee_type,
          SUM(transaction_count)::int AS transaction_count,
          SUM(total_amount)::bigint AS total_amount
        FROM analytics_billing_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end
          AND (NOT v_filter_country OR country = p_country)
        GROUP BY fee_type
        ORDER BY SUM(total_amount) DESC
      ) sub
    ),

    'by_date_billing', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.summary_date), '[]'::json)
      FROM (
        SELECT summary_date::text AS summary_date,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_items)::int AS total_items,
          SUM(total_charge)::bigint AS total_charge
        FROM analytics_daily_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN p_start AND p_end
          AND (NOT v_filter_country OR origin_country = p_country)
        GROUP BY summary_date
      ) sub
    ),

    'by_date_fee_type', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.summary_date), '[]'::json)
      FROM (
        SELECT summary_date::text AS summary_date,
          fee_type,
          SUM(transaction_count)::int AS transaction_count,
          SUM(total_amount)::bigint AS total_amount
        FROM analytics_billing_summaries
        WHERE client_id = p_client_id AND summary_date BETWEEN v_trend_start AND p_end
          AND (NOT v_filter_country OR country = p_country)
        GROUP BY summary_date, fee_type
      ) sub
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Overload 2: 9-parameter version (with domestic_only, d2c_only, all-clients support)
CREATE OR REPLACE FUNCTION get_analytics_from_summaries(
  p_client_id uuid,
  p_start date,
  p_end date,
  p_prev_start date,
  p_prev_end date,
  p_country text DEFAULT 'US'::text,
  p_trend_start date DEFAULT NULL::date,
  p_domestic_only boolean DEFAULT false,
  p_d2c_only boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
  v_filter_country bool := (p_country != 'ALL');
  v_trend_start date := COALESCE(p_trend_start, p_start);
  v_all_clients bool := (p_client_id IS NULL);
BEGIN
  SELECT json_build_object(
    'current', (
      SELECT json_build_object(
        'shipment_count', COALESCE(SUM(shipment_count), 0),
        'delivered_count', COALESCE(SUM(delivered_count), 0),
        'undelivered_count', COALESCE(SUM(undelivered_count), 0),
        'total_items', COALESCE(SUM(total_items), 0),
        'total_base_charge', COALESCE(SUM(total_base_charge), 0),
        'total_surcharge', COALESCE(SUM(total_surcharge), 0),
        'total_charge', COALESCE(SUM(total_charge), 0),
        'total_insurance', COALESCE(SUM(total_insurance), 0),
        'total_actual_weight_oz', COALESCE(SUM(total_actual_weight_oz), 0),
        'total_billable_weight_oz', COALESCE(SUM(total_billable_weight_oz), 0),
        'total_transit_days', COALESCE(SUM(total_transit_days), 0),
        'transit_count', COALESCE(SUM(transit_count), 0),
        'total_fulfill_hours', COALESCE(SUM(total_fulfill_hours), 0),
        'total_fulfill_business_hours', COALESCE(SUM(total_fulfill_business_hours), 0),
        'fulfill_count', COALESCE(SUM(fulfill_count), 0),
        'total_delivery_days', COALESCE(SUM(total_delivery_days), 0),
        'delivery_count', COALESCE(SUM(delivery_count), 0),
        'on_time_count', COALESCE(SUM(on_time_count), 0),
        'breached_count', COALESCE(SUM(breached_count), 0),
        'delay_on_time_count', COALESCE(SUM(delay_on_time_count), 0),
        'delay_breached_count', COALESCE(SUM(delay_breached_count), 0),
        'oos_count', COALESCE(SUM(oos_count), 0),
        'fulfilled_late_count', COALESCE(SUM(fulfilled_late_count), 0),
        'delay_count', COALESCE(SUM(delay_count), 0),
        'delay_fulfill_hours', COALESCE(SUM(delay_fulfill_hours), 0),
        'delay_fulfill_biz_hours', COALESCE(SUM(delay_fulfill_biz_hours), 0),
        'delay_delivery_days', COALESCE(SUM(delay_delivery_days), 0),
        'delay_delivery_count', COALESCE(SUM(delay_delivery_count), 0),
        'delivery_on_time_count', COALESCE(SUM(delivery_on_time_count), 0),
        'delivery_late_count', COALESCE(SUM(delivery_late_count), 0),
        'total_benchmark_transit_days', COALESCE(SUM(total_benchmark_transit_days), 0),
        'benchmark_transit_count', COALESCE(SUM(benchmark_transit_count), 0)
      )
      FROM analytics_daily_summaries
      WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end
        AND (NOT v_filter_country OR origin_country = p_country)
        AND (NOT p_domestic_only OR country = p_country)
        AND (NOT p_d2c_only OR order_type = 'DTC')
    ),

    'previous', (
      SELECT json_build_object(
        'shipment_count', COALESCE(SUM(shipment_count), 0),
        'delivered_count', COALESCE(SUM(delivered_count), 0),
        'undelivered_count', COALESCE(SUM(undelivered_count), 0),
        'total_charge', COALESCE(SUM(total_charge), 0),
        'total_transit_days', COALESCE(SUM(total_transit_days), 0),
        'transit_count', COALESCE(SUM(transit_count), 0),
        'on_time_count', COALESCE(SUM(on_time_count), 0),
        'breached_count', COALESCE(SUM(breached_count), 0),
        'delay_on_time_count', COALESCE(SUM(delay_on_time_count), 0),
        'delay_breached_count', COALESCE(SUM(delay_breached_count), 0),
        'delivery_on_time_count', COALESCE(SUM(delivery_on_time_count), 0),
        'delivery_late_count', COALESCE(SUM(delivery_late_count), 0),
        'total_benchmark_transit_days', COALESCE(SUM(total_benchmark_transit_days), 0),
        'benchmark_transit_count', COALESCE(SUM(benchmark_transit_count), 0)
      )
      FROM analytics_daily_summaries
      WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_prev_start AND p_prev_end
        AND (NOT v_filter_country OR origin_country = p_country)
        AND (NOT p_domestic_only OR country = p_country)
        AND (NOT p_d2c_only OR order_type = 'DTC')
    ),

    'by_state', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT state,
          SUM(shipment_count)::int AS shipment_count,
          SUM(delivered_count)::int AS delivered_count,
          SUM(total_fulfill_hours)::float AS total_fulfill_hours,
          SUM(total_fulfill_business_hours)::float AS total_fulfill_business_hours,
          SUM(fulfill_count)::int AS fulfill_count,
          SUM(total_delivery_days)::float AS total_delivery_days,
          SUM(delivery_count)::int AS delivery_count,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(delay_count)::int AS delay_count,
          SUM(delay_fulfill_biz_hours)::float AS delay_fulfill_biz_hours,
          SUM(delay_delivery_days)::float AS delay_delivery_days,
          SUM(delay_delivery_count)::int AS delay_delivery_count,
          SUM(delivery_on_time_count)::int AS delivery_on_time_count,
          SUM(delivery_late_count)::int AS delivery_late_count,
          SUM(total_benchmark_transit_days)::float AS total_benchmark_transit_days,
          SUM(benchmark_transit_count)::int AS benchmark_transit_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end
          AND state != ''
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY state
      ) sub
    ),

    'by_date', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.summary_date), '[]'::json)
      FROM (
        SELECT summary_date::text AS summary_date,
          SUM(shipment_count)::int AS shipment_count,
          SUM(delivered_count)::int AS delivered_count,
          SUM(total_items)::int AS total_items,
          SUM(total_base_charge)::bigint AS total_base_charge,
          SUM(total_surcharge)::bigint AS total_surcharge,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count,
          SUM(total_fulfill_hours)::float AS total_fulfill_hours,
          SUM(total_fulfill_business_hours)::float AS total_fulfill_business_hours,
          SUM(fulfill_count)::int AS fulfill_count,
          SUM(total_delivery_days)::float AS total_delivery_days,
          SUM(delivery_count)::int AS delivery_count,
          SUM(on_time_count)::int AS on_time_count,
          SUM(breached_count)::int AS breached_count,
          SUM(delay_on_time_count)::int AS delay_on_time_count,
          SUM(delay_breached_count)::int AS delay_breached_count,
          SUM(delay_count)::int AS delay_count,
          SUM(delay_fulfill_biz_hours)::float AS delay_fulfill_biz_hours,
          SUM(delay_delivery_days)::float AS delay_delivery_days,
          SUM(delay_delivery_count)::int AS delay_delivery_count,
          SUM(delivery_on_time_count)::int AS delivery_on_time_count,
          SUM(delivery_late_count)::int AS delivery_late_count,
          SUM(total_benchmark_transit_days)::float AS total_benchmark_transit_days,
          SUM(benchmark_transit_count)::int AS benchmark_transit_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN v_trend_start AND p_end
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY summary_date
      ) sub
    ),

    'by_carrier', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT carrier,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count,
          SUM(on_time_count)::int AS on_time_count,
          SUM(breached_count)::int AS breached_count,
          SUM(delay_on_time_count)::int AS delay_on_time_count,
          SUM(delay_breached_count)::int AS delay_breached_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end AND carrier != ''
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY carrier
      ) sub
    ),

    'by_ship_option', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT ship_option,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end AND ship_option != ''
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY ship_option
      ) sub
    ),

    'by_zone', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.zone), '[]'::json)
      FROM (
        SELECT zone,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_charge)::bigint AS total_charge,
          SUM(total_transit_days)::float AS total_transit_days,
          SUM(transit_count)::int AS transit_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end AND zone != ''
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY zone
      ) sub
    ),

    'by_fc', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT fc_name,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_fulfill_hours)::float AS total_fulfill_hours,
          SUM(total_fulfill_business_hours)::float AS total_fulfill_business_hours,
          SUM(fulfill_count)::int AS fulfill_count,
          SUM(on_time_count)::int AS on_time_count,
          SUM(breached_count)::int AS breached_count,
          SUM(delay_on_time_count)::int AS delay_on_time_count,
          SUM(delay_breached_count)::int AS delay_breached_count,
          SUM(delay_fulfill_biz_hours)::float AS delay_fulfill_biz_hours,
          SUM(delay_count)::int AS delay_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end AND fc_name != ''
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY fc_name
      ) sub
    ),

    'by_store', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.shipment_count DESC), '[]'::json)
      FROM (
        SELECT store_name,
          SUM(shipment_count)::int AS shipment_count
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end AND store_name != ''
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY store_name
      ) sub
    ),

    'by_city', (
      SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
      FROM (
        SELECT city, state,
          SUM(shipment_count)::int AS shipment_count,
          SUM(delay_count)::int AS delay_count
        FROM analytics_city_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end
          AND city != ''
          AND (NOT v_filter_country OR country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
        GROUP BY city, state
        ORDER BY SUM(shipment_count) DESC
        LIMIT 500
      ) sub
    ),

    'billing', (
      SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
      FROM (
        SELECT fee_type,
          SUM(transaction_count)::int AS transaction_count,
          SUM(total_amount)::bigint AS total_amount
        FROM analytics_billing_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end
          AND (NOT v_filter_country OR country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
        GROUP BY fee_type
        ORDER BY SUM(total_amount) DESC
      ) sub
    ),

    'by_date_billing', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.summary_date), '[]'::json)
      FROM (
        SELECT summary_date::text AS summary_date,
          SUM(shipment_count)::int AS shipment_count,
          SUM(total_items)::int AS total_items,
          SUM(total_charge)::bigint AS total_charge
        FROM analytics_daily_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN p_start AND p_end
          AND (NOT v_filter_country OR origin_country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
          AND (NOT p_d2c_only OR order_type = 'DTC')
        GROUP BY summary_date
      ) sub
    ),

    'by_date_fee_type', (
      SELECT COALESCE(json_agg(row_to_json(sub) ORDER BY sub.summary_date), '[]'::json)
      FROM (
        SELECT summary_date::text AS summary_date,
          fee_type,
          SUM(transaction_count)::int AS transaction_count,
          SUM(total_amount)::bigint AS total_amount
        FROM analytics_billing_summaries
        WHERE (v_all_clients OR client_id = p_client_id) AND summary_date BETWEEN v_trend_start AND p_end
          AND (NOT v_filter_country OR country = p_country)
          AND (NOT p_domestic_only OR country = p_country)
        GROUP BY summary_date, fee_type
      ) sub
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 4. Update get_otd_percentiles_by_state (both overloads) to use origin_country
-- Drop existing overloads
DROP FUNCTION IF EXISTS get_otd_percentiles_by_state(uuid, text, text, text);
DROP FUNCTION IF EXISTS get_otd_percentiles_by_state(uuid, text, text, text, boolean);

-- Overload 1: without p_include_delayed
CREATE OR REPLACE FUNCTION get_otd_percentiles_by_state(
  p_client_id uuid,
  p_start_date text,
  p_end_date text,
  p_country text DEFAULT 'ALL'
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH delivered AS (
    SELECT
      normalize_state_code(COALESCE(o.state, ''), COALESCE(s.destination_country, 'US')) AS norm_state,
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
      AND (p_country = 'ALL' OR s.origin_country = p_country)
      AND o.order_import_date IS NOT NULL
      AND EXTRACT(EPOCH FROM (s.event_delivered - o.order_import_date)) / 86400.0 BETWEEN 0 AND 60
      AND EXTRACT(EPOCH FROM (s.event_labeled - o.order_import_date)) / 3600.0 BETWEEN 0 AND 720
  ),
  national AS (
    SELECT
      round((percentile_cont(0.05) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p5,
      round((percentile_cont(0.20) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p20,
      round((percentile_cont(0.50) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p50,
      round((percentile_cont(0.80) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p80,
      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p95,
      round(avg(delivery_days)::numeric, 1) AS otd_mean,
      count(*)::int AS sample_count
    FROM delivered
  ),
  by_state AS (
    SELECT
      norm_state AS state,
      round((percentile_cont(0.05) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p5,
      round((percentile_cont(0.20) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p20,
      round((percentile_cont(0.50) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p50,
      round((percentile_cont(0.80) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p80,
      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p95,
      round(avg(delivery_days)::numeric, 1) AS otd_mean,
      count(*)::int AS sample_count
    FROM delivered
    WHERE norm_state IS NOT NULL AND norm_state != ''
    GROUP BY norm_state
    HAVING count(*) >= 5
  )
  SELECT json_build_object(
    'national', (SELECT row_to_json(national.*) FROM national),
    'by_state', (SELECT json_agg(row_to_json(by_state.*)) FROM by_state)
  );
$$;

-- Overload 2: with p_include_delayed
CREATE OR REPLACE FUNCTION get_otd_percentiles_by_state(
  p_client_id uuid,
  p_start_date text,
  p_end_date text,
  p_country text DEFAULT 'ALL',
  p_include_delayed boolean DEFAULT true
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH delivered AS (
    SELECT
      normalize_state_code(COALESCE(o.state, ''), COALESCE(s.destination_country, 'US')) AS norm_state,
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
      AND (p_country = 'ALL' OR s.origin_country = p_country)
      AND o.order_import_date IS NOT NULL
      AND EXTRACT(EPOCH FROM (s.event_delivered - o.order_import_date)) / 86400.0 BETWEEN 0 AND 60
      AND EXTRACT(EPOCH FROM (s.event_labeled - o.order_import_date)) / 3600.0 BETWEEN 0 AND 720
      AND (p_include_delayed OR business_hours_between(o.order_import_date, s.event_labeled, fc_timezone(s.fc_name)) < 24)
  ),
  national AS (
    SELECT
      round((percentile_cont(0.05) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p5,
      round((percentile_cont(0.20) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p20,
      round((percentile_cont(0.50) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p50,
      round((percentile_cont(0.80) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p80,
      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p95,
      round(avg(delivery_days)::numeric, 1) AS otd_mean,
      count(*)::int AS sample_count
    FROM delivered
  ),
  by_state AS (
    SELECT
      norm_state AS state,
      round((percentile_cont(0.05) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p5,
      round((percentile_cont(0.20) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p20,
      round((percentile_cont(0.50) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p50,
      round((percentile_cont(0.80) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p80,
      round((percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery_days))::numeric, 1) AS otd_p95,
      round(avg(delivery_days)::numeric, 1) AS otd_mean,
      count(*)::int AS sample_count
    FROM delivered
    WHERE norm_state IS NOT NULL AND norm_state != ''
    GROUP BY norm_state
    HAVING count(*) >= 5
  )
  SELECT json_build_object(
    'national', (SELECT row_to_json(national.*) FROM national),
    'by_state', (SELECT json_agg(row_to_json(by_state.*)) FROM by_state)
  );
$$;

-- 5. Update get_cost_by_sku to use origin_country
CREATE OR REPLACE FUNCTION get_cost_by_sku(
  p_client_id uuid,
  p_start text,
  p_end text,
  p_country text DEFAULT 'ALL',
  p_limit int DEFAULT 20
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
        AND (p_country = 'ALL' OR s.origin_country = p_country)
      GROUP BY si.sku
      ORDER BY COUNT(DISTINCT s.shipment_id) DESC
      LIMIT p_limit
    ) r
  );
END;
$$;

-- 6. Update get_cost_by_weight to use origin_country
CREATE OR REPLACE FUNCTION get_cost_by_weight(
  p_client_id uuid,
  p_start text,
  p_end text,
  p_country text DEFAULT 'ALL'
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT json_agg(row_to_json(r))
    FROM (
      SELECT
        bucket.sort_order,
        bucket.label,
        COUNT(*) AS order_count,
        ROUND(COALESCE(SUM(sub.billed), 0), 2) AS total_cost,
        CASE
          WHEN COUNT(*) > 0
          THEN ROUND(COALESCE(SUM(sub.billed), 0) / COUNT(*), 2)
          ELSE 0
        END AS avg_cost_per_order
      FROM (
        SELECT
          s.shipment_id,
          s.actual_weight_oz,
          t.billed_amount::numeric AS billed
        FROM shipments s
        JOIN transactions t ON t.reference_id = s.shipment_id
          AND t.client_id = s.client_id
          AND t.fee_type = 'Shipping'
          AND t.is_voided IS NOT TRUE
        WHERE s.client_id = p_client_id
          AND s.deleted_at IS NULL
          AND s.actual_weight_oz IS NOT NULL
          AND s.event_labeled >= p_start::date
          AND s.event_labeled < (p_end::date + interval '1 day')
          AND (p_country = 'ALL' OR s.origin_country = p_country)
      ) sub
      JOIN LATERAL (
        SELECT
          CASE
            WHEN sub.actual_weight_oz <= 1 THEN 1
            WHEN sub.actual_weight_oz <= 2 THEN 2
            WHEN sub.actual_weight_oz <= 3 THEN 3
            WHEN sub.actual_weight_oz <= 4 THEN 4
            WHEN sub.actual_weight_oz <= 5 THEN 5
            WHEN sub.actual_weight_oz <= 6 THEN 6
            WHEN sub.actual_weight_oz <= 7 THEN 7
            WHEN sub.actual_weight_oz <= 8 THEN 8
            WHEN sub.actual_weight_oz <= 9 THEN 9
            WHEN sub.actual_weight_oz <= 10 THEN 10
            WHEN sub.actual_weight_oz <= 11 THEN 11
            WHEN sub.actual_weight_oz <= 12 THEN 12
            WHEN sub.actual_weight_oz <= 13 THEN 13
            WHEN sub.actual_weight_oz <= 14 THEN 14
            WHEN sub.actual_weight_oz <= 15 THEN 15
            WHEN sub.actual_weight_oz <= 16 THEN 16
            WHEN sub.actual_weight_oz <= 20 THEN 17
            WHEN sub.actual_weight_oz <= 24 THEN 18
            WHEN sub.actual_weight_oz <= 28 THEN 19
            WHEN sub.actual_weight_oz <= 32 THEN 20
            WHEN sub.actual_weight_oz <= 48 THEN 21
            WHEN sub.actual_weight_oz <= 64 THEN 22
            WHEN sub.actual_weight_oz <= 80 THEN 23
            WHEN sub.actual_weight_oz <= 96 THEN 24
            WHEN sub.actual_weight_oz <= 112 THEN 25
            WHEN sub.actual_weight_oz <= 128 THEN 26
            WHEN sub.actual_weight_oz <= 144 THEN 27
            WHEN sub.actual_weight_oz <= 160 THEN 28
            WHEN sub.actual_weight_oz <= 176 THEN 29
            WHEN sub.actual_weight_oz <= 192 THEN 30
            WHEN sub.actual_weight_oz <= 208 THEN 31
            WHEN sub.actual_weight_oz <= 224 THEN 32
            WHEN sub.actual_weight_oz <= 240 THEN 33
            WHEN sub.actual_weight_oz <= 256 THEN 34
            WHEN sub.actual_weight_oz <= 272 THEN 35
            WHEN sub.actual_weight_oz <= 288 THEN 36
            WHEN sub.actual_weight_oz <= 304 THEN 37
            ELSE 38
          END AS sort_order,
          CASE
            WHEN sub.actual_weight_oz <= 1 THEN '1oz'
            WHEN sub.actual_weight_oz <= 2 THEN '2oz'
            WHEN sub.actual_weight_oz <= 3 THEN '3oz'
            WHEN sub.actual_weight_oz <= 4 THEN '4oz'
            WHEN sub.actual_weight_oz <= 5 THEN '5oz'
            WHEN sub.actual_weight_oz <= 6 THEN '6oz'
            WHEN sub.actual_weight_oz <= 7 THEN '7oz'
            WHEN sub.actual_weight_oz <= 8 THEN '8oz'
            WHEN sub.actual_weight_oz <= 9 THEN '9oz'
            WHEN sub.actual_weight_oz <= 10 THEN '10oz'
            WHEN sub.actual_weight_oz <= 11 THEN '11oz'
            WHEN sub.actual_weight_oz <= 12 THEN '12oz'
            WHEN sub.actual_weight_oz <= 13 THEN '13oz'
            WHEN sub.actual_weight_oz <= 14 THEN '14oz'
            WHEN sub.actual_weight_oz <= 15 THEN '15oz'
            WHEN sub.actual_weight_oz <= 16 THEN '16oz'
            WHEN sub.actual_weight_oz <= 20 THEN '20oz'
            WHEN sub.actual_weight_oz <= 24 THEN '24oz'
            WHEN sub.actual_weight_oz <= 28 THEN '28oz'
            WHEN sub.actual_weight_oz <= 32 THEN '2lb'
            WHEN sub.actual_weight_oz <= 48 THEN '3lb'
            WHEN sub.actual_weight_oz <= 64 THEN '4lb'
            WHEN sub.actual_weight_oz <= 80 THEN '5lb'
            WHEN sub.actual_weight_oz <= 96 THEN '6lb'
            WHEN sub.actual_weight_oz <= 112 THEN '7lb'
            WHEN sub.actual_weight_oz <= 128 THEN '8lb'
            WHEN sub.actual_weight_oz <= 144 THEN '9lb'
            WHEN sub.actual_weight_oz <= 160 THEN '10lb'
            WHEN sub.actual_weight_oz <= 176 THEN '11lb'
            WHEN sub.actual_weight_oz <= 192 THEN '12lb'
            WHEN sub.actual_weight_oz <= 208 THEN '13lb'
            WHEN sub.actual_weight_oz <= 224 THEN '14lb'
            WHEN sub.actual_weight_oz <= 240 THEN '15lb'
            WHEN sub.actual_weight_oz <= 256 THEN '16lb'
            WHEN sub.actual_weight_oz <= 272 THEN '17lb'
            WHEN sub.actual_weight_oz <= 288 THEN '18lb'
            WHEN sub.actual_weight_oz <= 304 THEN '19lb'
            ELSE '20lb+'
          END AS label
      ) bucket ON true
      GROUP BY bucket.sort_order, bucket.label
      ORDER BY bucket.sort_order
    ) r
  );
END;
$$;
