/**
 * Create the get_shipment_ids_by_age PostgreSQL function
 * Using postgres npm package for raw SQL execution
 */

require('dotenv').config({ path: '.env.local' })
const postgres = require('postgres')

// Parse Supabase URL to get connection details
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const dbPassword = 'oKLIfG6AwS472LPn' // Database password from previous connection

// Supabase connection pooler format
const sql = postgres({
  host: 'aws-0-us-west-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  username: 'postgres.xhehiuanvcowiktcsmjr',
  password: dbPassword,
  ssl: 'require'
})

async function createFunction() {
  console.log('Creating get_shipment_ids_by_age function...')

  try {
    await sql`
      CREATE OR REPLACE FUNCTION get_shipment_ids_by_age(
        p_client_id UUID,
        p_age_ranges JSONB,
        p_limit INT DEFAULT 50,
        p_offset INT DEFAULT 0
      )
      RETURNS TABLE(shipment_uuid UUID, age_days NUMERIC, total_count BIGINT)
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $func$
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
      $func$
    `

    console.log('Function created successfully!')

    // Test it
    console.log('Testing function...')
    const result = await sql`
      SELECT * FROM get_shipment_ids_by_age(
        '6b94c274-0446-4167-9d02-b998f8be59ad'::UUID,
        '[{"min": 7, "max": null}]'::JSONB,
        5,
        0
      )
    `
    console.log('Test result (7+ days, first 5):', result)

  } catch (err) {
    console.error('Error:', err)
  } finally {
    await sql.end()
  }
}

createFunction()
