-- Migration: Fix billing chart service group filter + Canada country filter
--
-- Fix 1: Billing trend chart must filter by service group to match KPIs
--   - Add ship_option_id to analytics_daily_summaries
--   - Add service_group to analytics_billing_summaries
--   - Update refresh_analytics_summaries to populate both
--   - Add p_service_groups parameter to get_analytics_from_summaries
--
-- Fix 2: Canada CPO shows impossible values ($4.30) because non-shipment
--   transactions (credits, warehousing) are included in EVERY country view.
--   Fix: join to fulfillment_centers for FC-based country attribution.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Helper: map ship_option_id → service group name
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ship_option_service_group(p_id integer)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_id IN (146, 3) THEN 'ground'
    WHEN p_id = 30 THEN '2day'
    WHEN p_id IN (1, 8) THEN 'overnight'
    ELSE 'other'
  END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Schema changes
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE analytics_daily_summaries
  ADD COLUMN IF NOT EXISTS ship_option_id integer;

ALTER TABLE analytics_billing_summaries
  ADD COLUMN IF NOT EXISTS service_group text;

-- Update unique constraint to include service_group
ALTER TABLE analytics_billing_summaries
  DROP CONSTRAINT IF EXISTS analytics_billing_summaries_client_date_fee_country_key;

CREATE INDEX IF NOT EXISTS idx_ads_ship_option_id
  ON analytics_daily_summaries (ship_option_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Backfill ship_option_id in daily summaries (text name → id mapping)
-- ══════════════════════════════════════════════════════════════════════════
UPDATE analytics_daily_summaries ads
SET ship_option_id = sub.ship_option_id
FROM (
  SELECT DISTINCT ON (ship_option_name) ship_option_name, ship_option_id
  FROM shipments
  WHERE ship_option_name IS NOT NULL AND ship_option_id IS NOT NULL
  ORDER BY ship_option_name, id DESC
) sub
WHERE ads.ship_option = sub.ship_option_name
  AND ads.ship_option_id IS NULL;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. Rebuild billing summaries with service_group (only 2K rows)
-- ══════════════════════════════════════════════════════════════════════════
DELETE FROM analytics_billing_summaries;

INSERT INTO analytics_billing_summaries
  (client_id, summary_date, fee_type, country, service_group, transaction_count, total_amount)
SELECT
  t.client_id,
  t.charge_date::date,
  t.fee_type,
  COALESCE(fc.country, 'US'),
  CASE WHEN t.reference_type = 'Shipment' THEN ship_option_service_group(s.ship_option_id) ELSE NULL END,
  COUNT(*)::int,
  ROUND(SUM(COALESCE(t.billed_amount, 0)) * 100)::bigint
FROM transactions t
LEFT JOIN fulfillment_centers fc ON t.fulfillment_center = fc.name
LEFT JOIN shipments s ON t.reference_id = s.shipment_id AND t.reference_type = 'Shipment'
WHERE t.fee_type != 'Shipping'
  AND t.transaction_type IS DISTINCT FROM 'Refund'
  AND (t.is_voided IS NULL OR t.is_voided = false)
  AND t.dispute_status IS NULL
  AND t.client_id IS NOT NULL
  AND t.charge_date IS NOT NULL
GROUP BY t.client_id, t.charge_date::date, t.fee_type, COALESCE(fc.country, 'US'),
  CASE WHEN t.reference_type = 'Shipment' THEN ship_option_service_group(s.ship_option_id) ELSE NULL END;

-- New unique index (includes service_group, with COALESCE for NULL handling)
CREATE UNIQUE INDEX analytics_billing_summaries_unique_key
  ON analytics_billing_summaries (client_id, summary_date, fee_type, country, COALESCE(service_group, ''));

CREATE INDEX IF NOT EXISTS idx_abs_service_group
  ON analytics_billing_summaries (service_group);

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Update refresh_analytics_summaries (add ship_option_id + service_group)
-- ══════════════════════════════════════════════════════════════════════════
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
        s.carrier, s.ship_option_name, s.ship_option_id, s.zone_used,
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
      b.ship_option_id AS dim_ship_option_id,
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
      client_id, summary_date, state, country, origin_country, carrier, ship_option, ship_option_id, zone, fc_name, store_name, order_type,
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
      dim_state, dim_country, dim_origin_country, dim_carrier, dim_ship_option, dim_ship_option_id, dim_zone, dim_fc, dim_store, dim_order_type,
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
    GROUP BY dim_state, dim_country, dim_origin_country, dim_carrier, dim_ship_option, dim_ship_option_id, dim_zone, dim_fc, dim_store, dim_order_type;

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

    -- Billing summaries: non-shipping fees with service_group from shipment join
    INSERT INTO analytics_billing_summaries (
      client_id, summary_date, fee_type, country, service_group, transaction_count, total_amount
    )
    SELECT
      v_entry.client_id, v_entry.summary_date,
      t.fee_type,
      COALESCE(fc.country, 'US') AS country,
      CASE WHEN t.reference_type = 'Shipment' THEN ship_option_service_group(s.ship_option_id) ELSE NULL END,
      COUNT(*)::int,
      ROUND(SUM(COALESCE(t.billed_amount, 0)) * 100)::bigint
    FROM transactions t
    LEFT JOIN fulfillment_centers fc ON t.fulfillment_center = fc.name
    LEFT JOIN shipments s ON t.reference_id = s.shipment_id AND t.reference_type = 'Shipment'
    WHERE t.client_id = v_entry.client_id
      AND t.fee_type != 'Shipping'
      AND t.transaction_type IS DISTINCT FROM 'Refund'
      AND (t.is_voided IS NULL OR t.is_voided = false)
      AND t.dispute_status IS NULL
      AND t.charge_date::date = v_entry.summary_date
    GROUP BY t.fee_type, COALESCE(fc.country, 'US'),
      CASE WHEN t.reference_type = 'Shipment' THEN ship_option_service_group(s.ship_option_id) ELSE NULL END;

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

-- ══════════════════════════════════════════════════════════════════════════
-- 6. Replace get_analytics_from_summaries — add p_service_groups parameter
--    Consolidate to single overload (route.ts always passes all params)
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_analytics_from_summaries(uuid, date, date, date, date, text, date);
DROP FUNCTION IF EXISTS get_analytics_from_summaries(uuid, date, date, date, date, text, date, boolean, boolean);

CREATE OR REPLACE FUNCTION get_analytics_from_summaries(
  p_client_id uuid,
  p_start date,
  p_end date,
  p_prev_start date,
  p_prev_end date,
  p_country text DEFAULT 'US'::text,
  p_trend_start date DEFAULT NULL::date,
  p_domestic_only boolean DEFAULT false,
  p_d2c_only boolean DEFAULT false,
  p_service_groups text[] DEFAULT NULL::text[]
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
  v_filter_sg bool := (p_service_groups IS NOT NULL);
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
        AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
        AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR service_group IS NULL OR service_group = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR ship_option_service_group(ship_option_id) = ANY(p_service_groups))
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
          AND (NOT v_filter_sg OR service_group IS NULL OR service_group = ANY(p_service_groups))
        GROUP BY summary_date, fee_type
      ) sub
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. Fix get_billing_period_summary — country filter for non-shipment txns
--    Both overloads: join fulfillment_centers, filter non-shipment by FC country
-- ══════════════════════════════════════════════════════════════════════════

-- Overload 1: 5 params (no domestic_only)
CREATE OR REPLACE FUNCTION get_billing_period_summary(
  p_client_id uuid,
  p_start text,
  p_end text,
  p_country text DEFAULT 'ALL'::text,
  p_service_groups text[] DEFAULT NULL::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH tx_data AS (
    SELECT
      t.fee_type,
      t.billed_amount,
      t.surcharge,
      t.reference_id,
      t.reference_type
    FROM transactions t
    LEFT JOIN shipments s
      ON t.reference_id = s.shipment_id
      AND t.reference_type = 'Shipment'
    LEFT JOIN fulfillment_centers fc
      ON t.fulfillment_center = fc.name
    WHERE t.client_id = p_client_id
      AND t.charge_date >= p_start::date
      AND t.charge_date <= p_end::date
      AND COALESCE(t.is_voided, false) = false
      AND t.billed_amount IS NOT NULL
      AND t.dispute_status IS NULL
      AND t.transaction_type IS DISTINCT FROM 'Refund'
      AND (
        p_country = 'ALL'
        OR (t.reference_type = 'Shipment' AND COALESCE(s.origin_country, 'US') = p_country)
        OR (t.reference_type IS DISTINCT FROM 'Shipment' AND COALESCE(fc.country, 'US') = p_country)
      )
      AND (
        p_service_groups IS NULL
        OR t.fee_type NOT IN ('Shipping', 'Per Pick Fee')
        OR (
          t.reference_type = 'Shipment'
          AND (
            CASE
              WHEN s.ship_option_id IN (146, 3) THEN 'ground'
              WHEN s.ship_option_id = 30 THEN '2day'
              WHEN s.ship_option_id IN (1, 8) THEN 'overnight'
              ELSE 'other'
            END
          ) = ANY(p_service_groups)
        )
      )
  )
  SELECT jsonb_build_object(
    'by_fee_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fee_type', sub.fee_type,
        'transaction_count', sub.transaction_count,
        'total_billed', sub.total_billed,
        'total_surcharge', sub.total_surcharge
      ))
      FROM (
        SELECT
          fee_type,
          COUNT(*)::int as transaction_count,
          ROUND(COALESCE(SUM(billed_amount), 0)::numeric, 2) as total_billed,
          ROUND(COALESCE(SUM(CASE WHEN fee_type = 'Shipping' THEN surcharge ELSE 0 END), 0)::numeric, 2) as total_surcharge
        FROM tx_data
        GROUP BY fee_type
        ORDER BY fee_type
      ) sub
    ), '[]'::jsonb),
    'shipment_count', COALESCE((
      SELECT COUNT(DISTINCT reference_id)::int
      FROM tx_data
      WHERE fee_type = 'Shipping'
    ), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- Overload 2: 6 params (with domestic_only)
CREATE OR REPLACE FUNCTION get_billing_period_summary(
  p_client_id uuid,
  p_start text,
  p_end text,
  p_country text DEFAULT 'ALL'::text,
  p_service_groups text[] DEFAULT NULL::text[],
  p_domestic_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH tx_data AS (
    SELECT
      t.fee_type,
      t.billed_amount,
      t.surcharge,
      t.reference_id,
      t.reference_type
    FROM transactions t
    LEFT JOIN shipments s
      ON t.reference_id = s.shipment_id
      AND t.reference_type = 'Shipment'
    LEFT JOIN fulfillment_centers fc
      ON t.fulfillment_center = fc.name
    WHERE t.client_id = p_client_id
      AND t.charge_date >= p_start::date
      AND t.charge_date <= p_end::date
      AND COALESCE(t.is_voided, false) = false
      AND t.billed_amount IS NOT NULL
      AND t.dispute_status IS NULL
      AND t.transaction_type IS DISTINCT FROM 'Refund'
      AND (
        p_country = 'ALL'
        OR (t.reference_type = 'Shipment' AND COALESCE(s.origin_country, 'US') = p_country)
        OR (t.reference_type IS DISTINCT FROM 'Shipment' AND COALESCE(fc.country, 'US') = p_country)
      )
      AND (
        p_service_groups IS NULL
        OR t.fee_type NOT IN ('Shipping', 'Per Pick Fee')
        OR (
          t.reference_type = 'Shipment'
          AND (
            CASE
              WHEN s.ship_option_id IN (146, 3) THEN 'ground'
              WHEN s.ship_option_id = 30 THEN '2day'
              WHEN s.ship_option_id IN (1, 8) THEN 'overnight'
              ELSE 'other'
            END
          ) = ANY(p_service_groups)
        )
      )
      AND (
        NOT p_domestic_only
        OR t.reference_type IS DISTINCT FROM 'Shipment'
        OR s.destination_country = COALESCE(s.origin_country, 'US')
      )
  )
  SELECT jsonb_build_object(
    'by_fee_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'fee_type', sub.fee_type,
        'transaction_count', sub.transaction_count,
        'total_billed', sub.total_billed,
        'total_surcharge', sub.total_surcharge
      ))
      FROM (
        SELECT
          fee_type,
          COUNT(*)::int as transaction_count,
          ROUND(COALESCE(SUM(billed_amount), 0)::numeric, 2) as total_billed,
          ROUND(COALESCE(SUM(CASE WHEN fee_type = 'Shipping' THEN surcharge ELSE 0 END), 0)::numeric, 2) as total_surcharge
        FROM tx_data
        GROUP BY fee_type
        ORDER BY fee_type
      ) sub
    ), '[]'::jsonb),
    'shipment_count', COALESCE((
      SELECT COUNT(DISTINCT reference_id)::int
      FROM tx_data
      WHERE fee_type = 'Shipping'
    ), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
