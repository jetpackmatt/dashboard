-- Migration: Create materialized view for carrier options
-- This eliminates the slow DISTINCT carrier query (114ms -> <1ms)
-- Run this in Supabase SQL Editor

-- Create a materialized view for carrier options per client
CREATE MATERIALIZED VIEW IF NOT EXISTS carrier_options_by_client AS
SELECT DISTINCT
    client_id,
    carrier
FROM shipments
WHERE carrier IS NOT NULL
  AND event_labeled IS NOT NULL
  AND deleted_at IS NULL
  AND carrier NOT IN ('DE_KITTING');

-- Create an index for fast lookups by client_id
CREATE INDEX IF NOT EXISTS idx_carrier_options_client
ON carrier_options_by_client (client_id);

-- Also create a view for all carriers (for admin "all clients" view)
CREATE MATERIALIZED VIEW IF NOT EXISTS carrier_options_all AS
SELECT DISTINCT carrier
FROM shipments
WHERE carrier IS NOT NULL
  AND event_labeled IS NOT NULL
  AND deleted_at IS NULL
  AND carrier NOT IN ('DE_KITTING');

-- Grant permissions
GRANT SELECT ON carrier_options_by_client TO authenticated;
GRANT SELECT ON carrier_options_by_client TO service_role;
GRANT SELECT ON carrier_options_all TO authenticated;
GRANT SELECT ON carrier_options_all TO service_role;

-- Create RPC function to refresh the views (called by cron job)
CREATE OR REPLACE FUNCTION refresh_carrier_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW carrier_options_by_client;
  REFRESH MATERIALIZED VIEW carrier_options_all;
END;
$$;

-- Grant execute permission to service_role
GRANT EXECUTE ON FUNCTION refresh_carrier_views() TO service_role;
