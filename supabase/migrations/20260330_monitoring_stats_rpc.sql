-- Consolidates 13 individual count queries + misfit pre-fetch into a single function.
-- Misfit exclusion (credits not linked to care tickets) is handled via LEFT JOIN
-- instead of a massive NOT IN (...) clause that kills query planning.

CREATE OR REPLACE FUNCTION get_monitoring_stats(
  p_client_id uuid DEFAULT NULL,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH misfit_shipments AS (
    SELECT DISTINCT reference_id
    FROM transactions
    WHERE fee_type = 'Credit'
      AND care_ticket_id IS NULL
      AND is_voided = false
      AND dispute_status IS NULL
      AND reference_type = 'Shipment'
      AND reference_id IS NOT NULL
  ),
  filtered AS (
    SELECT
      l.claim_eligibility_status,
      l.watch_reason,
      l.ai_status_badge,
      l.ai_reshipment_urgency,
      l.ai_customer_anxiety,
      l.shipment_id,
      l.last_scan_date,
      (m.reference_id IS NOT NULL) AS is_misfit
    FROM lost_in_transit_checks l
    LEFT JOIN misfit_shipments m ON m.reference_id = l.shipment_id
    WHERE (p_client_id IS NULL OR l.client_id = p_client_id)
      AND (p_start_date IS NULL OR l.first_checked_at >= p_start_date)
      AND (p_end_date IS NULL OR l.first_checked_at <= p_end_date)
  ),
  counts AS (
    SELECT
      -- Core status counts (misfit-excluded where relevant)
      COUNT(*) FILTER (WHERE claim_eligibility_status = 'at_risk' AND NOT is_misfit) AS at_risk_all,
      COUNT(*) FILTER (WHERE claim_eligibility_status = 'at_risk' AND watch_reason = 'NEEDS ACTION' AND NOT is_misfit) AS needs_action,
      COUNT(*) FILTER (WHERE claim_eligibility_status = 'eligible' AND NOT is_misfit) AS eligible,
      COUNT(*) FILTER (WHERE claim_eligibility_status = 'claim_filed') AS claim_filed,
      COUNT(*) FILTER (WHERE claim_eligibility_status = 'returned_to_sender') AS returned_to_sender,
      COUNT(*) FILTER (WHERE claim_eligibility_status IN ('at_risk', 'eligible', 'claim_filed')) AS total,
      COUNT(*) FILTER (WHERE claim_eligibility_status IN ('approved', 'denied', 'missed_window')) AS archived,
      -- AI-driven counts (misfit-excluded)
      COUNT(*) FILTER (WHERE ai_reshipment_urgency >= 80 AND NOT is_misfit) AS reship_now,
      COUNT(*) FILTER (WHERE ai_reshipment_urgency >= 60 AND ai_reshipment_urgency < 80 AND NOT is_misfit) AS consider_reship,
      COUNT(*) FILTER (WHERE ai_customer_anxiety >= 70 AND NOT is_misfit) AS customer_anxious,
      COUNT(*) FILTER (WHERE ai_status_badge IN ('STUCK', 'STALLED') AND NOT is_misfit) AS stuck,
      COUNT(*) FILTER (WHERE ai_status_badge = 'RETURNING' AND NOT is_misfit) AS returning,
      COUNT(*) FILTER (WHERE ai_status_badge = 'LOST' AND NOT is_misfit) AS lost
    FROM filtered
  ),
  -- Watch reason breakdown for at-risk (misfit-excluded)
  watch_breakdown AS (
    SELECT
      COALESCE(watch_reason, 'STALLED') AS reason,
      COUNT(*) AS count
    FROM filtered
    WHERE claim_eligibility_status = 'at_risk' AND NOT is_misfit
    GROUP BY COALESCE(watch_reason, 'STALLED')
    ORDER BY count DESC
  ),
  -- Days-silent histogram for at-risk (misfit-excluded)
  silent_data AS (
    SELECT
      LEAST(
        GREATEST(0, EXTRACT(DAY FROM (now() - last_scan_date))::int),
        15
      ) AS bucket
    FROM filtered
    WHERE claim_eligibility_status = 'at_risk'
      AND NOT is_misfit
      AND last_scan_date IS NOT NULL
  ),
  silent_hist AS (
    SELECT bucket, COUNT(*) AS count
    FROM silent_data
    GROUP BY bucket
    ORDER BY bucket
  ),
  silent_avg AS (
    SELECT COALESCE(AVG(EXTRACT(DAY FROM (now() - last_scan_date))), 0) AS avg_days
    FROM filtered
    WHERE claim_eligibility_status = 'at_risk'
      AND NOT is_misfit
      AND last_scan_date IS NOT NULL
  )
  SELECT jsonb_build_object(
    'counts', (SELECT row_to_json(counts)::jsonb FROM counts),
    'watch_breakdown', COALESCE((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', count)) FROM watch_breakdown), '[]'::jsonb),
    'days_silent_avg', (SELECT avg_days FROM silent_avg),
    'days_silent_histogram', COALESCE((SELECT jsonb_agg(jsonb_build_object('day', CASE WHEN bucket < 15 THEN bucket::text ELSE '15+' END, 'count', count)) FROM silent_hist), '[]'::jsonb)
  )
$$;
