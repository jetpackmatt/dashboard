/**
 * Migration: Create get_shipment_ids_by_age function for fast age filtering
 *
 * This function calculates age (in days) at the database level using SQL date arithmetic,
 * avoiding the need to fetch all 70K+ records to JavaScript for filtering.
 *
 * Age = delivered_date - order_import_date (for delivered shipments)
 * Age = NOW() - order_import_date (for in-transit shipments)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('Creating get_shipment_ids_by_age function...')

  // Use Supabase's SQL function execution
  const { data, error } = await supabase.rpc('exec_sql', {
    sql_query: `
      -- Create a function to get shipment IDs filtered by age ranges
      -- Returns shipment IDs where age falls within ANY of the provided ranges
      CREATE OR REPLACE FUNCTION get_shipment_ids_by_age(
        p_client_id UUID,
        p_age_ranges JSONB,  -- Array of {min: number, max: number|null} objects
        p_limit INT DEFAULT 50,
        p_offset INT DEFAULT 0
      )
      RETURNS TABLE(shipment_uuid UUID, age_days NUMERIC, total_count BIGINT)
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $func$
      DECLARE
        range_record JSONB;
        min_val NUMERIC;
        max_val NUMERIC;
      BEGIN
        RETURN QUERY
        WITH age_calc AS (
          SELECT
            s.id as sid,
            EXTRACT(EPOCH FROM (COALESCE(s.delivered_date, NOW()) - o.order_import_date)) / 86400.0 as calc_age
          FROM shipments s
          INNER JOIN orders o ON s.order_id = o.id
          WHERE s.shipped_date IS NOT NULL
            AND (p_client_id IS NULL OR s.client_id = p_client_id)
        ),
        filtered AS (
          SELECT ac.sid, ac.calc_age
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
          f.sid as shipment_uuid,
          f.calc_age as age_days,
          c.cnt as total_count
        FROM filtered f
        CROSS JOIN counted c
        ORDER BY f.calc_age ASC
        LIMIT p_limit
        OFFSET p_offset;
      END;
      $func$;
    `
  })

  if (error) {
    // exec_sql might not exist, try direct approach with postgrest
    console.log('exec_sql not available, will need to run migration via Supabase dashboard or psql')
    console.log('')
    console.log('Run this SQL in Supabase SQL Editor:')
    console.log('=====================================')
    console.log(`
CREATE OR REPLACE FUNCTION get_shipment_ids_by_age(
  p_client_id UUID,
  p_age_ranges JSONB,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(shipment_uuid UUID, age_days NUMERIC, total_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH age_calc AS (
    SELECT
      s.id as sid,
      EXTRACT(EPOCH FROM (COALESCE(s.delivered_date, NOW()) - o.order_import_date)) / 86400.0 as calc_age
    FROM shipments s
    INNER JOIN orders o ON s.order_id = o.id
    WHERE s.shipped_date IS NOT NULL
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ),
  filtered AS (
    SELECT ac.sid, ac.calc_age
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
    f.sid as shipment_uuid,
    f.calc_age as age_days,
    c.cnt as total_count
  FROM filtered f
  CROSS JOIN counted c
  ORDER BY f.calc_age ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
    `)
    return
  }

  console.log('Function created successfully!')
}

migrate().catch(console.error)
