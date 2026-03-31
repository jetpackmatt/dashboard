-- Add order_type column to analytics_daily_summaries
-- Allows distinguishing DTC vs B2B (wholesale) orders in analytics aggregations

ALTER TABLE analytics_daily_summaries
  ADD COLUMN order_type text NOT NULL DEFAULT 'DTC';

-- Drop the existing unique constraint that doesn't include order_type
ALTER TABLE analytics_daily_summaries
  DROP CONSTRAINT analytics_daily_summaries_client_id_summary_date_state_coun_key;

-- Recreate unique constraint including order_type
CREATE UNIQUE INDEX analytics_daily_summaries_client_id_summary_date_state_coun_key
  ON analytics_daily_summaries (client_id, summary_date, state, country, carrier, ship_option, zone, fc_name, store_name, order_type);

-- Note: refresh_analytics_summaries and get_analytics_from_summaries functions
-- were also updated to populate/filter by order_type and support p_d2c_only param.
-- Full function bodies applied via execute_sql (too large for migration file).
