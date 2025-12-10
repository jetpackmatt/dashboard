#!/usr/bin/env node
/**
 * Test preflight validation locally
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runPreflight() {
  const startDate = '2025-12-01'
  const endDate = '2025-12-07'

  console.log(`Running preflight for ${startDate} to ${endDate}...\n`)

  // Get clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('is_internal', false)

  const results = []

  for (const client of clients || []) {
    console.log(`\n=== ${client.company_name} ===`)

    // Get shipments count
    const { count: shipmentCount } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('event_labeled', startDate)
      .lt('event_labeled', endDate + 'T23:59:59')

    // Get shipping transactions
    const { count: shippingTxCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('transaction_fee', 'Shipping')
      .gte('charge_date', startDate)
      .lt('charge_date', endDate + 'T23:59:59')

    // Get additional services transactions
    const { count: additionalTxCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('transaction_fee', 'AdditionalService')
      .gte('charge_date', startDate)
      .lt('charge_date', endDate + 'T23:59:59')

    // Get storage transactions
    const { count: storageTxCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('transaction_fee', 'Storage')
      .gte('charge_date', startDate)
      .lt('charge_date', endDate + 'T23:59:59')

    // Get receiving transactions
    const { count: receivingTxCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('transaction_fee', 'WarehouseInboundFee')
      .gte('charge_date', startDate)
      .lt('charge_date', endDate + 'T23:59:59')

    // Get credits
    const { count: creditCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('transaction_type', 'Credit')
      .gte('charge_date', startDate)
      .lt('charge_date', endDate + 'T23:59:59')

    // Check for missing fields in shipments
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, carrier, carrier_service, billable_weight_oz, event_labeled, event_created')
      .eq('client_id', client.id)
      .gte('event_labeled', startDate)
      .lt('event_labeled', endDate + 'T23:59:59')

    const missingCarrier = shipments?.filter(s => !s.carrier).length || 0
    const missingService = shipments?.filter(s => !s.carrier_service).length || 0
    const missingWeight = shipments?.filter(s => !s.billable_weight_oz).length || 0
    const missingEventLabeled = shipments?.filter(s => !s.event_labeled).length || 0
    const missingEventCreated = shipments?.filter(s => !s.event_created).length || 0

    console.log(`Shipments: ${shipmentCount}`)
    console.log(`  - Missing carrier: ${missingCarrier}`)
    console.log(`  - Missing carrier_service: ${missingService}`)
    console.log(`  - Missing weight: ${missingWeight}`)
    console.log(`  - Missing event_labeled: ${missingEventLabeled}`)
    console.log(`  - Missing event_created: ${missingEventCreated}`)
    console.log(`Transactions:`)
    console.log(`  - Shipping: ${shippingTxCount}`)
    console.log(`  - Additional Services: ${additionalTxCount}`)
    console.log(`  - Storage: ${storageTxCount}`)
    console.log(`  - Receiving: ${receivingTxCount}`)
    console.log(`  - Credits: ${creditCount}`)

    results.push({
      client: client.company_name,
      shipments: shipmentCount,
      shipping: shippingTxCount,
      additionalServices: additionalTxCount,
      storage: storageTxCount,
      receiving: receivingTxCount,
      credits: creditCount,
      missingCarrier,
      missingService,
      missingWeight,
      missingEventLabeled,
      missingEventCreated
    })
  }

  // Summary
  console.log('\n========================================')
  console.log('PREFLIGHT SUMMARY')
  console.log('========================================')

  const totals = {
    shipments: 0,
    shipping: 0,
    additionalServices: 0,
    storage: 0,
    receiving: 0,
    credits: 0,
    missingFields: 0
  }

  for (const r of results) {
    totals.shipments += r.shipments || 0
    totals.shipping += r.shipping || 0
    totals.additionalServices += r.additionalServices || 0
    totals.storage += r.storage || 0
    totals.receiving += r.receiving || 0
    totals.credits += r.credits || 0
    totals.missingFields += (r.missingCarrier + r.missingService + r.missingWeight + r.missingEventLabeled + r.missingEventCreated)
  }

  console.log(`Total Shipments: ${totals.shipments}`)
  console.log(`Total Shipping Transactions: ${totals.shipping}`)
  console.log(`Total Additional Services: ${totals.additionalServices}`)
  console.log(`Total Storage: ${totals.storage}`)
  console.log(`Total Receiving: ${totals.receiving}`)
  console.log(`Total Credits: ${totals.credits}`)
  console.log(`Total Missing Fields: ${totals.missingFields}`)

  const allGood = totals.missingFields === 0
  console.log(`\n${allGood ? '✅ PREFLIGHT PASSED' : '⚠️ PREFLIGHT HAS ISSUES'}`)
}

runPreflight().catch(console.error)
