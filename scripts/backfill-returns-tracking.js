/**
 * Backfill shipment_tracking_number in returns table
 *
 * This script looks up the original shipment's tracking_id for each return
 * and populates shipment_tracking_number (which should be the original shipment's tracking)
 *
 * tracking_number = the return shipment's tracking (RMA tracking)
 * shipment_tracking_number = the original outbound shipment's tracking
 *
 * Usage: node scripts/backfill-returns-tracking.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(60))
  console.log('BACKFILL: Returns shipment_tracking_number')
  console.log('='.repeat(60))

  // Step 1: Get all returns with original_shipment_id that need backfill
  console.log('\n1. Finding returns that need backfill...')

  const { data: returns, error: returnsError } = await supabase
    .from('returns')
    .select('id, shipbob_return_id, original_shipment_id, shipment_tracking_number, tracking_number')
    .not('original_shipment_id', 'is', null)

  if (returnsError) {
    console.error('Error fetching returns:', returnsError.message)
    process.exit(1)
  }

  console.log(`   Total returns with original_shipment_id: ${returns.length}`)

  // Step 2: Find returns where shipment_tracking_number is null or same as tracking_number
  // (same as tracking_number suggests it was incorrectly synced)
  const needsBackfill = returns.filter(r => {
    // Null - definitely needs backfill
    if (!r.shipment_tracking_number) return true
    // Same as tracking_number and tracking_number exists - likely incorrect
    if (r.tracking_number && r.shipment_tracking_number === r.tracking_number) return true
    return false
  })

  console.log(`   Returns needing backfill: ${needsBackfill.length}`)

  if (needsBackfill.length === 0) {
    console.log('\nNo returns need backfill!')
    return
  }

  // Step 3: Get unique original_shipment_ids
  const originalShipmentIds = [...new Set(needsBackfill.map(r => r.original_shipment_id))]
  console.log(`\n2. Looking up ${originalShipmentIds.length} original shipments...`)

  // Step 4: Fetch tracking_id from shipments table in batches
  const shipmentTrackingMap = new Map()

  for (let i = 0; i < originalShipmentIds.length; i += 500) {
    const batch = originalShipmentIds.slice(i, i + 500)
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('shipment_id, tracking_id')
      .in('shipment_id', batch)

    if (error) {
      console.error(`Error fetching shipments batch ${i}: ${error.message}`)
      continue
    }

    for (const s of shipments || []) {
      if (s.tracking_id) {
        shipmentTrackingMap.set(String(s.shipment_id), s.tracking_id)
      }
    }
  }

  console.log(`   Found tracking for ${shipmentTrackingMap.size} shipments`)

  // Step 5: Update returns with correct shipment_tracking_number
  console.log('\n3. Updating returns...')

  let updated = 0
  let notFound = 0
  let errors = 0

  for (const ret of needsBackfill) {
    const originalTracking = shipmentTrackingMap.get(String(ret.original_shipment_id))

    if (!originalTracking) {
      notFound++
      continue
    }

    // Skip if already correct
    if (ret.shipment_tracking_number === originalTracking) {
      continue
    }

    const { error } = await supabase
      .from('returns')
      .update({ shipment_tracking_number: originalTracking })
      .eq('id', ret.id)

    if (error) {
      errors++
      console.error(`   Error updating return ${ret.shipbob_return_id}: ${error.message}`)
    } else {
      updated++
    }

    // Progress every 100
    if ((updated + notFound + errors) % 100 === 0) {
      process.stdout.write(`\r   Progress: ${updated + notFound + errors}/${needsBackfill.length}`)
    }
  }

  console.log(`\n\n${'='.repeat(60)}`)
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log(`Updated: ${updated}`)
  console.log(`Original shipment not found: ${notFound}`)
  console.log(`Errors: ${errors}`)
}

main().catch(console.error)
