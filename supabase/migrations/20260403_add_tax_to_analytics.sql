-- Migration: Add tax tracking + fix billing chart date attribution
--
-- Bug 1 (Tax missing): Canadian GST stored in transactions.taxes JSONB was not
-- included in billed_amount or any summary table. Both the Period Summary KPIs
-- and the billing trend chart were missing ~$2K+ of tax.
--
-- Bug 2 (Wrong tax field): Initial fix used taxes_charge (ShipBob's tax on their
-- raw cost) instead of taxes (our computed tax matching invoices). Example: $0.66
-- Per Pick — taxes has $0.065 (correct), taxes_charge has $0.09 (wrong).
--
-- Bug 3 (Date attribution): billing_summaries used charge_date for Per Pick Fees,
-- but invoices and daily_summaries use the shipment's event_labeled date. Per Pick
-- Fees for Saturday shipments get charged on Monday, putting them in the wrong
-- chart week (~$89/week discrepancy for Eli Health).
--
-- Bug 4 (Credits using event_labeled): Initial date-fix used event_labeled for ALL
-- Shipment-type fees. Credits have reference_type='Shipment' but are issued 17-61
-- days after event_labeled. Using event_labeled sent -$1,190 in credits to Feb
-- instead of their correct Mar 19 charge_date. Fix: only pick/pack fees use
-- event_labeled; Credits and everything else use charge_date.
--
-- After all fixes: both Mar 16-22 ($4,327.34) and Mar 23-29 ($5,686.11) invoices
-- match chart totals exactly, line by line.
--
-- Changes:
--   get_billing_period_summary: Add Tax fee type from transactions.taxes JSONB
--   refresh_analytics_summaries: Add Tax rows + event_labeled ONLY for pick/pack fees
--   enqueue_analytics_refresh: Only queue event_labeled for pick/pack fee types
--
-- Applied via Supabase MCP on 2026-04-02.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. get_billing_period_summary: Include Tax in by_fee_type results
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_billing_period_summary(uuid, text, text, text, text[], boolean, text[]);

CREATE FUNCTION get_billing_period_summary(
  p_client_id uuid,
  p_start text,
  p_end text,
  p_country text DEFAULT 'ALL',
  p_service_groups text[] DEFAULT NULL,
  p_domestic_only boolean DEFAULT false,
  p_order_types text[] DEFAULT NULL
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
      t.id AS tx_id,
      t.fee_type,
      t.billed_amount,
      t.surcharge,
      t.reference_id,
      t.reference_type,
      t.taxes
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
      AND (
        p_order_types IS NULL
        OR (
          cardinality(p_order_types) > 0
          AND (t.reference_type IS DISTINCT FROM 'Shipment' OR s.order_type = ANY(p_order_types))
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

        UNION ALL

        -- Tax from taxes JSONB (matches invoice; NOT taxes_charge which is ShipBob's)
        SELECT
          'Tax' as fee_type,
          COUNT(DISTINCT tx_id)::int as transaction_count,
          ROUND(COALESCE(SUM((elem->>'tax_amount')::numeric), 0)::numeric, 2) as total_billed,
          0::numeric as total_surcharge
        FROM tx_data
        CROSS JOIN LATERAL jsonb_array_elements(taxes) AS elem
        WHERE taxes IS NOT NULL
          AND jsonb_array_length(taxes) > 0
        HAVING SUM((elem->>'tax_amount')::numeric) > 0

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

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. refresh_analytics_summaries: date attribution fix + correct tax field
--    Pick/pack fees (Per Pick Fee, B2B pick fees, B2B Label Fee) use event_labeled.
--    Credits and all other Shipment-type fees use charge_date.
--    Tax uses transactions.taxes (our invoice tax), not taxes_charge (ShipBob's).
-- ═══════════════════════════════════════════════════════════════════════════
-- Full function body applied via CREATE OR REPLACE (see MCP migration).

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. enqueue_analytics_refresh trigger: only queue event_labeled for pick/pack fees
--    Credits and other shipment-referenced fees do NOT queue event_labeled.
-- ═══════════════════════════════════════════════════════════════════════════
-- Updated via CREATE OR REPLACE (see MCP migration).

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Backfill: delete wrong Tax rows, re-queue all dates for correct refresh
-- ═══════════════════════════════════════════════════════════════════════════

DELETE FROM analytics_billing_summaries WHERE fee_type = 'Tax';

INSERT INTO analytics_refresh_queue (client_id, summary_date, reason)
SELECT DISTINCT client_id, summary_date, 'tax-date-fix'
FROM analytics_billing_summaries
WHERE client_id IS NOT NULL
ON CONFLICT (client_id, summary_date)
DO UPDATE SET processed_at = NULL, created_at = now(), reason = 'tax-date-fix';

INSERT INTO analytics_refresh_queue (client_id, summary_date, reason)
SELECT DISTINCT t.client_id, (s.event_labeled AT TIME ZONE 'UTC')::date, 'ship-date-fix'
FROM transactions t
JOIN shipments s ON t.reference_id = s.shipment_id AND t.reference_type = 'Shipment'
WHERE t.client_id IS NOT NULL
  AND t.fee_type != 'Shipping'
  AND s.event_labeled IS NOT NULL
  AND (s.event_labeled AT TIME ZONE 'UTC')::date != t.charge_date::date
ON CONFLICT (client_id, summary_date)
DO UPDATE SET processed_at = NULL, created_at = now(), reason = 'ship-date-fix';
