/**
 * Migration: Add timeline event columns to shipments table
 *
 * These columns store timestamps from the ShipBob shipment timeline API:
 * GET /shipment/{id}/timeline
 *
 * Column naming: event_{log_type_name} (lowercase)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('ADD SHIPMENT TIMELINE COLUMNS MIGRATION')
  console.log('='.repeat(70))

  // Check which columns already exist
  const newColumns = [
    'event_created',               // 601: Shipment Created
    'event_picked',                // 602: Picked
    'event_packed',                // 603: Packaged
    'event_labeled',               // 604: Label Created (replaces label_generation_date)
    'event_labelvalidated',        // 605: Label Validated
    'event_intransit',             // 607: In Transit (replaces shipped_date - TRUE carrier handoff)
    'event_outfordelivery',        // 608: Out For Delivery
    'event_delivered',             // 609: Delivered (already have delivered_date, but for completeness)
    'event_deliveryattemptfailed', // 611: Delivery attempt failed
  ]

  // Columns to drop (replaced by event columns)
  const dropColumns = [
    'shipped_date',           // replaced by event_intransit
    'label_generation_date',  // replaced by event_labeled
  ]

  console.log('\nChecking existing columns...')
  const existingCols = []
  const missingCols = []

  for (const col of newColumns) {
    const { error } = await supabase.from('shipments').select(col).limit(1)
    const exists = !error || !error.message.includes('does not exist')
    if (exists) {
      existingCols.push(col)
    } else {
      missingCols.push(col)
    }
  }

  console.log('Already exist:', existingCols.length > 0 ? existingCols.join(', ') : '(none)')
  console.log('Need to add:', missingCols.length > 0 ? missingCols.join(', ') : '(none)')

  if (missingCols.length === 0) {
    console.log('\nAll columns already exist. Nothing to do.')
    return
  }

  // Generate SQL
  console.log('\n' + '='.repeat(70))
  console.log('SQL TO RUN IN SUPABASE DASHBOARD')
  console.log('='.repeat(70))

  const alterStatements = missingCols.map(col =>
    `ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ${col} timestamptz;`
  ).join('\n')

  const sql = `
-- Add timeline event columns to shipments table
-- These store timestamps from ShipBob's /shipment/{id}/timeline API

${alterStatements}

-- Add comment explaining the mapping
COMMENT ON COLUMN shipments.event_created IS 'Timeline: Shipment Created (log_type_id=601)';
COMMENT ON COLUMN shipments.event_picked IS 'Timeline: Picked (log_type_id=602)';
COMMENT ON COLUMN shipments.event_packed IS 'Timeline: Packaged (log_type_id=603)';
COMMENT ON COLUMN shipments.event_labeled IS 'Timeline: Label Created (log_type_id=604)';
COMMENT ON COLUMN shipments.event_labelvalidated IS 'Timeline: Label Validated (log_type_id=605)';
COMMENT ON COLUMN shipments.event_intransit IS 'Timeline: In Transit (log_type_id=607) - TRUE shipped date';
COMMENT ON COLUMN shipments.event_outfordelivery IS 'Timeline: Out For Delivery (log_type_id=608)';
COMMENT ON COLUMN shipments.event_delivered IS 'Timeline: Delivered (log_type_id=609)';
COMMENT ON COLUMN shipments.event_deliveryattemptfailed IS 'Timeline: Delivery attempt failed (log_type_id=611)';

-- Drop legacy columns (replaced by event columns above)
ALTER TABLE shipments DROP COLUMN IF EXISTS shipped_date;
ALTER TABLE shipments DROP COLUMN IF EXISTS label_generation_date;

-- Create index on event_intransit for analytics queries
CREATE INDEX IF NOT EXISTS idx_shipments_event_intransit ON shipments(event_intransit);

-- Verify columns were added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'shipments'
  AND column_name LIKE 'event_%'
ORDER BY column_name;
`

  console.log(sql)

  console.log('\n' + '='.repeat(70))
  console.log('INSTRUCTIONS')
  console.log('='.repeat(70))
  console.log('1. Copy the SQL above')
  console.log('2. Go to Supabase Dashboard > SQL Editor')
  console.log('3. Paste and run the SQL')
  console.log('4. After columns are added, run the backfill script to populate them')
  console.log('')
  console.log('NOTE: event_intransit is the TRUE shipped_date (carrier pickup timestamp)')
  console.log('      shipped_date column currently uses label_generation_date as fallback')
}

main().catch(console.error)
