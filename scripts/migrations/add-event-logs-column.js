/**
 * Migration: Add event_logs JSONB column to shipments table
 *
 * Stores the rich activity log from ShipBob's Logs API:
 * GET /order/{orderId}/shipment/{shipmentId}/logs
 *
 * This captures detailed system events with metadata like:
 * - SLA updates with fulfillment_sla timestamp
 * - Address changes with from/to details
 * - Dimension sources (dim_source)
 * - Ship option mapping resolutions
 * - Full activity history beyond operational milestones
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('ADD EVENT_LOGS JSONB COLUMN MIGRATION')
  console.log('='.repeat(70))

  // Check if column exists
  const { error } = await supabase.from('shipments').select('event_logs').limit(1)
  const exists = !error || !error.message.includes('does not exist')

  if (exists) {
    console.log('\nevent_logs column already exists. Nothing to do.')
    return
  }

  console.log('\nevent_logs column needs to be added.')

  // Generate SQL
  console.log('\n' + '='.repeat(70))
  console.log('SQL TO RUN IN SUPABASE DASHBOARD')
  console.log('='.repeat(70))

  const sql = `
-- Add event_logs JSONB column to shipments table
-- Stores rich activity log from ShipBob's /order/{orderId}/shipment/{shipmentId}/logs API

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS event_logs JSONB;

-- Add comment explaining the column
COMMENT ON COLUMN shipments.event_logs IS 'Full activity log from ShipBob Logs API. Array of {log_type_id, log_type_name, log_type_text, timestamp, metadata}';

-- Create GIN index for JSONB queries (optional, for searching within logs)
CREATE INDEX IF NOT EXISTS idx_shipments_event_logs ON shipments USING GIN (event_logs);

-- Verify column was added
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'shipments'
  AND column_name = 'event_logs';
`

  console.log(sql)

  console.log('\n' + '='.repeat(70))
  console.log('INSTRUCTIONS')
  console.log('='.repeat(70))
  console.log('1. Copy the SQL above')
  console.log('2. Go to Supabase Dashboard > SQL Editor')
  console.log('3. Paste and run the SQL')
  console.log('4. After column is added, run the backfill script to populate it')
  console.log('')
  console.log('LOGS API EVENT TYPES (examples):')
  console.log('  log_type_id=19:  Order placed')
  console.log('  log_type_id=20:  Tracking details uploaded')
  console.log('  log_type_id=21:  Resolved ship option mapping')
  console.log('  log_type_id=35:  Shipping label generated')
  console.log('  log_type_id=70:  Label validated')
  console.log('  log_type_id=78:  Order dimensions created (has dim_source metadata)')
  console.log('  log_type_id=98:  Order SLA set (has fulfillment_sla metadata)')
  console.log('  log_type_id=106: Order sorted for carrier, awaiting pickup')
  console.log('  log_type_id=132: Address changed (has from/to metadata)')
  console.log('  log_type_id=135: Order in transit to ShipBob sort center')
}

main().catch(console.error)
