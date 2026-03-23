-- Holiday-aware business hours + SLA improvements:
-- 1. business_hours_between() now skips US/CA holidays + NYE early close (8am-noon)
-- 2. SLA metric switched from custom sla_deadline_biz() to ShipBob's own
--    FulfilledOnTime/FulfilledLate status (estimated_fulfillment_date_status field)
-- 3. Inventory-delayed orders excluded from SLA metrics via delay_on_time/breached_count
-- 4. Helper functions: easter_date(), get_holidays(), fc_country(), sla_deadline_biz()
-- 5. US holidays: New Year's, Memorial Day, Labor Day, Thanksgiving, Christmas
-- 6. CA holidays: New Year's, Family Day, Good Friday, Victoria Day, Canada Day,
--    Civic Day, Labour Day, Thanksgiving, Christmas

-- ── Step 1: Easter date calculator (Computus algorithm) ──────────────────
CREATE OR REPLACE FUNCTION easter_date(p_year int)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  a int; b int; c int; d int; e int;
  f int; g int; h int; i int; k int;
  l int; m int; v_month int; v_day int;
BEGIN
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  v_month := (h + l - 7 * m + 114) / 31;
  v_day := ((h + l - 7 * m + 114) % 31) + 1;
  RETURN make_date(p_year, v_month, v_day);
END;
$$;

-- ── Step 2: Holiday list for a given year + country ──────────────────────
CREATE OR REPLACE FUNCTION get_holidays(p_year int, p_country text)
RETURNS date[]
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  holidays date[] := ARRAY[]::date[];
  v_d date;
BEGIN
  -- Shared: New Year's Day + Christmas
  holidays := holidays || make_date(p_year, 1, 1);
  holidays := holidays || make_date(p_year, 12, 25);

  IF p_country = 'US' THEN
    -- Memorial Day: last Monday of May
    v_d := make_date(p_year, 5, 31);
    v_d := v_d - ((EXTRACT(ISODOW FROM v_d)::int - 1) % 7);
    holidays := holidays || v_d;

    -- Labor Day: first Monday of September
    v_d := make_date(p_year, 9, 1);
    v_d := v_d + ((8 - EXTRACT(ISODOW FROM v_d)::int) % 7);
    holidays := holidays || v_d;

    -- Thanksgiving: fourth Thursday of November
    v_d := make_date(p_year, 11, 1);
    v_d := v_d + ((4 - EXTRACT(ISODOW FROM v_d)::int + 7) % 7);  -- first Thursday
    v_d := v_d + 21;  -- fourth Thursday
    holidays := holidays || v_d;

  ELSIF p_country = 'CA' THEN
    -- Ontario Family Day: third Monday of February
    v_d := make_date(p_year, 2, 1);
    v_d := v_d + ((8 - EXTRACT(ISODOW FROM v_d)::int) % 7);  -- first Monday
    v_d := v_d + 14;  -- third Monday
    holidays := holidays || v_d;

    -- Good Friday: Easter - 2
    holidays := holidays || (easter_date(p_year) - 2);

    -- Victoria Day: Monday on or before May 24
    v_d := make_date(p_year, 5, 24);
    v_d := v_d - ((EXTRACT(ISODOW FROM v_d)::int - 1) % 7);
    holidays := holidays || v_d;

    -- Canada Day: July 1
    holidays := holidays || make_date(p_year, 7, 1);

    -- Civic Day: first Monday of August
    v_d := make_date(p_year, 8, 1);
    v_d := v_d + ((8 - EXTRACT(ISODOW FROM v_d)::int) % 7);
    holidays := holidays || v_d;

    -- Labour Day: first Monday of September
    v_d := make_date(p_year, 9, 1);
    v_d := v_d + ((8 - EXTRACT(ISODOW FROM v_d)::int) % 7);
    holidays := holidays || v_d;

    -- Thanksgiving: second Monday of October
    v_d := make_date(p_year, 10, 1);
    v_d := v_d + ((8 - EXTRACT(ISODOW FROM v_d)::int) % 7);  -- first Monday
    v_d := v_d + 7;  -- second Monday
    holidays := holidays || v_d;
  END IF;

  RETURN holidays;
END;
$$;

-- ── Step 3: FC country from FC name ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fc_country(p_fc_name text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_fc_name ILIKE 'Ontario%' OR p_fc_name ILIKE '%Brampton%'
      THEN 'CA'
    ELSE 'US'
  END;
$$;

-- ── Step 4: Holiday-aware SLA deadline ───────────────────────────────────
CREATE OR REPLACE FUNCTION sla_deadline_biz(
  p_order_import timestamptz,
  p_timezone text DEFAULT 'America/New_York'
) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_local timestamp;
  v_hour int;
  v_dow int;
  v_deadline_day date;
  v_country text;
  v_holidays date[];
  v_cutoff int;
  v_year int;
BEGIN
  IF p_order_import IS NULL THEN RETURN NULL; END IF;

  v_country := CASE WHEN p_timezone = 'America/Toronto' THEN 'CA' ELSE 'US' END;
  v_local := p_order_import AT TIME ZONE p_timezone;
  v_hour  := EXTRACT(HOUR FROM v_local);
  v_dow   := EXTRACT(DOW FROM v_local);
  v_deadline_day := v_local::date;
  v_year  := EXTRACT(YEAR FROM v_deadline_day)::int;

  -- Load holidays for this year and next (handles Dec→Jan boundary)
  v_holidays := get_holidays(v_year, v_country) || get_holidays(v_year + 1, v_country);

  -- NYE closes early at noon; all other days cutoff is 2pm
  v_cutoff := CASE
    WHEN EXTRACT(MONTH FROM v_local) = 12 AND EXTRACT(DAY FROM v_local) = 31 THEN 12
    ELSE 14
  END;

  -- Determine if we need to push to next day
  IF v_dow IN (0, 6) OR v_deadline_day = ANY(v_holidays) THEN
    v_deadline_day := v_deadline_day + 1;
  ELSIF v_hour >= v_cutoff THEN
    v_deadline_day := v_deadline_day + 1;
  END IF;

  -- Advance past any weekends and holidays
  LOOP
    v_dow := EXTRACT(DOW FROM v_deadline_day);
    EXIT WHEN v_dow NOT IN (0, 6) AND NOT (v_deadline_day = ANY(v_holidays));
    v_deadline_day := v_deadline_day + 1;
  END LOOP;

  RETURN (v_deadline_day::text || ' 23:59:59')::timestamp AT TIME ZONE p_timezone;
END;
$$;

-- ── Step 5: Holiday-aware business hours (with NYE short hours) ──────────
CREATE OR REPLACE FUNCTION business_hours_between(
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text DEFAULT 'America/New_York'
) RETURNS numeric
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_hours numeric := 0;
  v_day date;
  v_biz_start timestamptz;
  v_biz_end timestamptz;
  v_overlap_start timestamptz;
  v_overlap_end timestamptz;
  v_country text;
  v_holidays date[];
  v_end_hour int;
  v_start_year int;
  v_end_year int;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_start >= p_end THEN
    RETURN 0;
  END IF;

  v_country := CASE WHEN p_timezone = 'America/Toronto' THEN 'CA' ELSE 'US' END;
  v_start_year := EXTRACT(YEAR FROM (p_start AT TIME ZONE p_timezone))::int;
  v_end_year   := EXTRACT(YEAR FROM (p_end   AT TIME ZONE p_timezone))::int;

  v_holidays := ARRAY[]::date[];
  FOR y IN v_start_year .. v_end_year LOOP
    v_holidays := v_holidays || get_holidays(y, v_country);
  END LOOP;

  v_day := (p_start AT TIME ZONE p_timezone)::date;

  WHILE v_day <= (p_end AT TIME ZONE p_timezone)::date LOOP
    -- Skip weekends AND holidays
    IF EXTRACT(DOW FROM v_day) BETWEEN 1 AND 5
       AND NOT (v_day = ANY(v_holidays)) THEN

      -- NYE: business hours 8am–noon; all other days 8am–6pm
      IF EXTRACT(MONTH FROM v_day) = 12 AND EXTRACT(DAY FROM v_day) = 31 THEN
        v_end_hour := 12;
      ELSE
        v_end_hour := 18;
      END IF;

      v_biz_start := (v_day::text || ' 08:00:00')::timestamp AT TIME ZONE p_timezone;
      v_biz_end   := (v_day::text || ' ' || LPAD(v_end_hour::text, 2, '0') || ':00:00')::timestamp AT TIME ZONE p_timezone;

      v_overlap_start := GREATEST(p_start, v_biz_start);
      v_overlap_end   := LEAST(p_end, v_biz_end);

      IF v_overlap_start < v_overlap_end THEN
        v_hours := v_hours + EXTRACT(EPOCH FROM (v_overlap_end - v_overlap_start)) / 3600.0;
      END IF;
    END IF;

    v_day := v_day + 1;
  END LOOP;

  RETURN v_hours;
END;
$$;

-- 2-param overload delegates to 3-param
CREATE OR REPLACE FUNCTION business_hours_between(
  p_start timestamptz,
  p_end timestamptz
) RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT business_hours_between(p_start, p_end, 'America/New_York');
$$;

-- ── Step 6: get_sla_detail_records using ShipBob FulfilledOnTime/Late + delay exclusion ──
CREATE OR REPLACE FUNCTION get_sla_detail_records(
  p_client_id uuid,
  p_start_date text,
  p_end_date text
) RETURNS json
LANGUAGE plpgsql STABLE
SET search_path = public
SET statement_timeout = '30s'
AS $$
BEGIN
  RETURN json_build_object(
    'breached', (
      SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
      FROM (
        SELECT
          s.shipbob_order_id AS order_id,
          s.tracking_id,
          COALESCE(s.recipient_name, '') AS customer_name,
          o.order_import_date AS order_insert_timestamp,
          s.event_labeled AS label_generation_timestamp,
          s.event_delivered AS delivered_date,
          ROUND((EXTRACT(EPOCH FROM (s.event_labeled - o.order_import_date)) / 3600.0)::numeric, 2) AS time_to_ship_hours,
          s.transit_time_days,
          s.carrier
        FROM shipments s
        JOIN orders o ON s.shipbob_order_id = o.shipbob_order_id AND o.client_id = p_client_id
        WHERE s.client_id = p_client_id
          AND s.deleted_at IS NULL
          AND s.event_labeled >= p_start_date::timestamptz
          AND s.event_labeled <= (p_end_date || 'T23:59:59.999Z')::timestamptz
          AND s.estimated_fulfillment_date_status = 'FulfilledLate'
          AND EXISTS (SELECT 1 FROM fulfillment_centers fc WHERE fc.name = s.fc_name AND fc.country = s.destination_country)
          -- Exclude inventory-delayed orders
          AND NOT (
            s.event_logs IS NOT NULL AND (
              s.event_logs::text LIKE '%OrderImportedToException%'
              OR s.event_logs::text LIKE '%OrderMovedToOnHoldWithReason%'
            )
          )
          AND NOT (
            s.estimated_fulfillment_date IS NOT NULL
            AND o.order_import_date IS NOT NULL
            AND EXTRACT(EPOCH FROM (s.estimated_fulfillment_date - o.order_import_date)) / 86400.0 > 6
          )
        ORDER BY s.event_labeled DESC
        LIMIT 2000
      ) sub
    ),
    'on_time', (
      SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
      FROM (
        SELECT
          s.shipbob_order_id AS order_id,
          s.tracking_id,
          COALESCE(s.recipient_name, '') AS customer_name,
          o.order_import_date AS order_insert_timestamp,
          s.event_labeled AS label_generation_timestamp,
          s.event_delivered AS delivered_date,
          ROUND((EXTRACT(EPOCH FROM (s.event_labeled - o.order_import_date)) / 3600.0)::numeric, 2) AS time_to_ship_hours,
          s.transit_time_days,
          s.carrier
        FROM shipments s
        JOIN orders o ON s.shipbob_order_id = o.shipbob_order_id AND o.client_id = p_client_id
        WHERE s.client_id = p_client_id
          AND s.deleted_at IS NULL
          AND s.event_labeled >= p_start_date::timestamptz
          AND s.event_labeled <= (p_end_date || 'T23:59:59.999Z')::timestamptz
          AND s.estimated_fulfillment_date_status = 'FulfilledOnTime'
          AND EXISTS (SELECT 1 FROM fulfillment_centers fc WHERE fc.name = s.fc_name AND fc.country = s.destination_country)
          -- Exclude inventory-delayed orders
          AND NOT (
            s.event_logs IS NOT NULL AND (
              s.event_logs::text LIKE '%OrderImportedToException%'
              OR s.event_logs::text LIKE '%OrderMovedToOnHoldWithReason%'
            )
          )
          AND NOT (
            s.estimated_fulfillment_date IS NOT NULL
            AND o.order_import_date IS NOT NULL
            AND EXTRACT(EPOCH FROM (s.estimated_fulfillment_date - o.order_import_date)) / 86400.0 > 6
          )
        ORDER BY s.event_labeled DESC
        LIMIT 2000
      ) sub
    )
  );
END;
$$;

-- ── Step 7: Add delay columns + re-queue ─────────────────────────────────
ALTER TABLE analytics_daily_summaries
  ADD COLUMN IF NOT EXISTS delay_on_time_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delay_breached_count int DEFAULT 0;

INSERT INTO analytics_refresh_queue (client_id, summary_date)
SELECT DISTINCT client_id, summary_date
FROM analytics_daily_summaries
WHERE on_time_count > 0 OR breached_count > 0 OR fulfill_count > 0
ON CONFLICT (client_id, summary_date) DO UPDATE SET processed_at = NULL;
