#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(80))
  console.log('COMPLETE TRANSACTION LINKAGE VERIFICATION')
  console.log('='.repeat(80))

  // Get transaction counts by fee type and client
  console.log('\n--- Transaction counts by reference_type ---')
  const { data: txSummary } = await supabase
    .from('transactions')
    .select('reference_type, client_id')

  const byRefType = {}
  for (const tx of (txSummary || [])) {
    byRefType[tx.reference_type] = (byRefType[tx.reference_type] || 0) + 1
  }
  for (const [type, count] of Object.entries(byRefType).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + type + ': ' + count)
  }

  // Get sample transactions of each reference_type
  console.log('\n--- Sample transactions by reference_type ---')
  const refTypes = Object.keys(byRefType)

  for (const refType of refTypes) {
    console.log('\n' + refType + ':')
    const { data: samples } = await supabase
      .from('transactions')
      .select('transaction_id, transaction_fee, reference_id, client_id, amount')
      .eq('reference_type', refType)
      .limit(2)

    for (const tx of (samples || [])) {
      console.log('  fee: ' + tx.transaction_fee)
      console.log('  reference_id: ' + tx.reference_id)
      console.log('  client_id: ' + tx.client_id)
      console.log('  amount: $' + tx.amount)

      // For Shipment type, verify JOIN to shipments works
      if (refType === 'Shipment') {
        const { data: ship } = await supabase
          .from('shipments')
          .select('carrier, carrier_service, zone_used')
          .eq('shipment_id', tx.reference_id)
          .single()

        if (ship) {
          console.log('  → Shipment found: ' + ship.carrier + ' ' + ship.carrier_service + ' Zone ' + ship.zone_used)
        } else {
          console.log('  → Shipment NOT found')
        }
      }
      console.log()
    }
  }

  // Summary
  console.log('='.repeat(80))
  console.log('LINKAGE STRATEGY VERIFICATION')
  console.log('='.repeat(80))

  const totalTxs = txSummary?.length || 0
  const txWithClient = txSummary?.filter(t => t.client_id).length || 0

  console.log('\nTotal transactions: ' + totalTxs)
  console.log('With client_id: ' + txWithClient)
  console.log('Coverage: ' + (totalTxs > 0 ? (100 * txWithClient / totalTxs).toFixed(1) : 0) + '%')

  if (txWithClient === totalTxs) {
    console.log('\n✅ ALL transactions have client_id - direct filtering works!')
  } else {
    console.log('\n⚠️  Some transactions missing client_id - need linkage via reference_id')
  }
}

main()
