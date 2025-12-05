#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function check() {
  console.log('=== WEIGHT COLUMN ANALYSIS ===\n')

  // Check what weight columns we have and their values
  const { data: sample } = await supabase
    .from('shipments')
    .select('shipment_id, actual_weight_oz, billable_weight_oz, dim_weight_oz, length, width, height')
    .eq('client_id', HENSON_ID)
    .not('actual_weight_oz', 'is', null)
    .limit(10)

  console.log('Sample records with actual_weight_oz populated:')
  for (const r of sample || []) {
    console.log(`  Shipment ${r.shipment_id}:`)
    console.log(`    actual_weight_oz:   ${r.actual_weight_oz}`)
    console.log(`    billable_weight_oz: ${r.billable_weight_oz}`)
    console.log(`    dim_weight_oz:      ${r.dim_weight_oz}`)
    console.log(`    dimensions:         ${r.length} x ${r.width} x ${r.height}`)
    console.log('')
  }

  // Count nulls
  const { count: totalCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: actualWeightCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .not('actual_weight_oz', 'is', null)

  const { count: billableWeightCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .not('billable_weight_oz', 'is', null)

  const { count: dimWeightCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .not('dim_weight_oz', 'is', null)

  console.log('=== COLUMN COVERAGE ===')
  console.log(`Total shipments:      ${totalCount}`)
  console.log(`actual_weight_oz:     ${actualWeightCount} (${Math.round(actualWeightCount/totalCount*100)}%)`)
  console.log(`billable_weight_oz:   ${billableWeightCount} (${Math.round(billableWeightCount/totalCount*100)}%)`)
  console.log(`dim_weight_oz:        ${dimWeightCount} (${Math.round(dimWeightCount/totalCount*100)}%)`)

  // Now check what the API actually returns for weights
  console.log('\n=== CHECKING API RESPONSE FOR WEIGHTS ===\n')

  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Get a shipped order
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  const params = new URLSearchParams({
    StartDate: startDate.toISOString(),
    EndDate: endDate.toISOString(),
    Limit: '5',
    Page: '1',
    HasTracking: 'true'  // Only shipped orders
  })

  const response = await fetch(`https://api.shipbob.com/1.0/order?${params}`, {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const orders = await response.json()

  console.log('API shipment.measurements structure:')
  for (const order of orders.slice(0, 2)) {
    if (order.shipments?.[0]) {
      const s = order.shipments[0]
      console.log(`\nOrder ${order.id}, Shipment ${s.id}:`)
      console.log('  measurements:', JSON.stringify(s.measurements, null, 2))
    }
  }
}

check().catch(console.error)
