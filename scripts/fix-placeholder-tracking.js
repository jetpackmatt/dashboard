/**
 * Fix Placeholder Tracking IDs
 *
 * Updates transactions that have ShipBob placeholder tracking IDs (SBAAA...)
 * to use the actual carrier tracking ID from the shipments table.
 *
 * This is not an error condition - ShipBob creates transactions with placeholder
 * tracking before the actual carrier label is generated. The shipment's tracking_id
 * gets updated when the real label is created, but the transaction doesn't.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('=== Fix Placeholder Tracking IDs ===\n')

  // Find all transactions with placeholder tracking that don't match shipment tracking
  const { data: mismatches, error } = await supabase
    .from('transactions')
    .select(`
      transaction_id,
      reference_id,
      tracking_id,
      client_id,
      fee_type
    `)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .like('tracking_id', 'SBAAA%')

  if (error) {
    console.error('Error fetching transactions:', error.message)
    return
  }

  console.log(`Found ${mismatches?.length || 0} transactions with SBAAA placeholder tracking\n`)

  if (!mismatches || mismatches.length === 0) {
    console.log('No placeholder tracking IDs to fix')
    return
  }

  // Get the shipment tracking for each
  const shipmentIds = [...new Set(mismatches.map(t => t.reference_id))]
  const { data: shipments, error: shipErr } = await supabase
    .from('shipments')
    .select('shipment_id, tracking_id')
    .in('shipment_id', shipmentIds)
    .not('tracking_id', 'like', 'SBAAA%')

  if (shipErr) {
    console.error('Error fetching shipments:', shipErr.message)
    return
  }

  // Build lookup map
  const shipmentTrackingMap = new Map(
    (shipments || []).map(s => [s.shipment_id, s.tracking_id])
  )

  console.log(`Found ${shipments?.length || 0} shipments with real tracking IDs\n`)

  // Update each transaction
  let updated = 0
  let skipped = 0
  for (const tx of mismatches) {
    const realTracking = shipmentTrackingMap.get(tx.reference_id)
    if (!realTracking) {
      console.log(`  Skipping ${tx.transaction_id}: shipment ${tx.reference_id} has no real tracking yet`)
      skipped++
      continue
    }

    const { error: updateErr } = await supabase
      .from('transactions')
      .update({ tracking_id: realTracking })
      .eq('transaction_id', tx.transaction_id)

    if (updateErr) {
      console.error(`  Error updating ${tx.transaction_id}:`, updateErr.message)
    } else {
      console.log(`  Updated ${tx.transaction_id}: ${tx.tracking_id} -> ${realTracking}`)
      updated++
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped: ${skipped}`)
}

main().catch(console.error)
