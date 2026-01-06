#!/usr/bin/env node
/**
 * Backfill script to test reshipment SFTP matching fix
 *
 * Processes the Dec 23 and Dec 27 SFTP files to update the reshipment
 * transactions for shipment 330867617
 */

const { createClient } = require('@supabase/supabase-js')
const {
  fetchDailyShippingBreakdown,
  updateTransactionsWithDailyBreakdown
} = require('../lib/billing/sftp-client')

require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const shipmentId = '330867617'

  console.log(`\n=== Backfill Reshipment SFTP Data ===\n`)
  console.log(`Testing shipment: ${shipmentId}`)
  console.log(`Expected SFTP files: 2025-12-23 (for Dec 22 charge) and 2025-12-27 (for Dec 26 charge)\n`)

  // Show current state
  console.log('--- Current State ---')
  const { data: before } = await supabase
    .from('transactions')
    .select('transaction_id, charge_date, tracking_id, cost, base_cost, surcharge')
    .eq('reference_id', shipmentId)
    .eq('fee_type', 'Shipping')
    .order('charge_date')

  for (const tx of before || []) {
    console.log(`${tx.charge_date}: cost=$${tx.cost}, base_cost=${tx.base_cost ?? 'NULL'}, surcharge=${tx.surcharge ?? 'NULL'}`)
  }

  // Process Dec 23 file (for Dec 22 charges)
  console.log('\n--- Processing Dec 23 SFTP file ---')
  // Use local date constructor to avoid UTC timezone issues
  const dec23 = new Date(2025, 11, 23) // Month is 0-indexed, so 11 = December
  const result23 = await fetchDailyShippingBreakdown(dec23)

  if (!result23.success) {
    console.log(`Dec 23 file not found: ${result23.error}`)
  } else {
    console.log(`Found ${result23.rows.length} shipments in Dec 23 file`)

    // Check if our shipment is there
    const target23 = result23.rows.find(r => r.shipment_id === shipmentId)
    if (target23) {
      console.log(`  ✓ Shipment ${shipmentId} found: base_cost=$${target23.base_cost}, surcharge=$${target23.surcharge}`)
    } else {
      console.log(`  ✗ Shipment ${shipmentId} NOT in Dec 23 file`)
    }

    // Run update with date-based matching
    const update23 = await updateTransactionsWithDailyBreakdown(supabase, result23.rows, dec23)
    console.log(`  Updated: ${update23.updated}, NotFound: ${update23.notFound}`)
  }

  // Process Dec 27 file (for Dec 26 charges)
  console.log('\n--- Processing Dec 27 SFTP file ---')
  // Use local date constructor to avoid UTC timezone issues
  const dec27 = new Date(2025, 11, 27) // Month is 0-indexed, so 11 = December
  const result27 = await fetchDailyShippingBreakdown(dec27)

  if (!result27.success) {
    console.log(`Dec 27 file not found: ${result27.error}`)
  } else {
    console.log(`Found ${result27.rows.length} shipments in Dec 27 file`)

    // Check if our shipment is there
    const target27 = result27.rows.find(r => r.shipment_id === shipmentId)
    if (target27) {
      console.log(`  ✓ Shipment ${shipmentId} found: base_cost=$${target27.base_cost}, surcharge=$${target27.surcharge}`)
    } else {
      console.log(`  ✗ Shipment ${shipmentId} NOT in Dec 27 file`)
    }

    // Run update with date-based matching
    const update27 = await updateTransactionsWithDailyBreakdown(supabase, result27.rows, dec27)
    console.log(`  Updated: ${update27.updated}, NotFound: ${update27.notFound}`)
  }

  // Show final state
  console.log('\n--- Final State ---')
  const { data: after } = await supabase
    .from('transactions')
    .select('transaction_id, charge_date, tracking_id, cost, base_cost, surcharge')
    .eq('reference_id', shipmentId)
    .eq('fee_type', 'Shipping')
    .order('charge_date')

  let allPopulated = true
  for (const tx of after || []) {
    const status = tx.base_cost !== null ? '✓' : '✗'
    console.log(`${status} ${tx.charge_date}: cost=$${tx.cost}, base_cost=${tx.base_cost ?? 'NULL'}, surcharge=${tx.surcharge ?? 'NULL'}`)
    if (tx.base_cost === null) allPopulated = false
  }

  console.log()
  if (allPopulated) {
    console.log('✅ SUCCESS: Both reshipment transactions now have SFTP data!')
  } else {
    console.log('❌ FAILED: Some transactions still missing SFTP data')
  }
}

main().catch(console.error)
