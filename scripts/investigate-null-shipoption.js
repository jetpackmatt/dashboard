#!/usr/bin/env node
/**
 * Investigate: Why do 49 shipments have NULL carrier_service?
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function investigate() {
  console.log('=== INVESTIGATING NULL CARRIER_SERVICE RECORDS ===\n')

  // Get records with NULL carrier_service
  const { data: nullRecords, error } = await supabase
    .from('shipments')
    .select('*')
    .eq('client_id', HENSON_ID)
    .is('carrier_service', null)
    .order('order_date', { ascending: false })
    .limit(20)

  if (error) {
    console.log('Error:', error.message)
    return
  }

  console.log(`Found ${nullRecords.length} records with NULL carrier_service\n`)

  // Analyze what's populated vs null
  console.log('=== SAMPLE RECORDS ===\n')
  for (const record of nullRecords.slice(0, 5)) {
    console.log('---')
    console.log(`  shipment_id:     ${record.shipment_id || 'NULL'}`)
    console.log(`  shipbob_order_id: ${record.shipbob_order_id || 'NULL'}`)
    console.log(`  store_order_id:   ${record.store_order_id || 'NULL'}`)
    console.log(`  order_date:       ${record.order_date || 'NULL'}`)
    console.log(`  customer_name:    ${record.customer_name || 'NULL'}`)
    console.log(`  city/state:       ${record.city || 'NULL'}, ${record.state || 'NULL'}`)
    console.log(`  carrier_service:  ${record.carrier_service || 'NULL'}`)
    console.log(`  carrier:          ${record.carrier || 'NULL'}`)
    console.log(`  fc_name:          ${record.fc_name || 'NULL'}`)
    console.log(`  zone_used:        ${record.zone_used || 'NULL'}`)
    console.log(`  tracking_id:      ${record.tracking_id || 'NULL'}`)
    console.log(`  actual_weight_oz: ${record.actual_weight_oz || 'NULL'}`)
  }

  // Count patterns
  console.log('\n=== PATTERN ANALYSIS ===\n')
  let withShipmentId = 0
  let withoutShipmentId = 0
  let withTrackingId = 0
  let withFcName = 0
  let withCarrier = 0
  let withZone = 0

  for (const record of nullRecords) {
    if (record.shipment_id) withShipmentId++
    else withoutShipmentId++
    if (record.tracking_id) withTrackingId++
    if (record.fc_name) withFcName++
    if (record.carrier) withCarrier++
    if (record.zone_used) withZone++
  }

  console.log(`Total with NULL carrier_service: ${nullRecords.length}`)
  console.log(`  With shipment_id:    ${withShipmentId}`)
  console.log(`  Without shipment_id: ${withoutShipmentId}`)
  console.log(`  With tracking_id:    ${withTrackingId}`)
  console.log(`  With fc_name:        ${withFcName}`)
  console.log(`  With carrier:        ${withCarrier}`)
  console.log(`  With zone_used:      ${withZone}`)

  // Now fetch a sample order from API to see its actual structure
  if (nullRecords.length > 0 && nullRecords[0].shipbob_order_id) {
    console.log('\n=== FETCHING ORDER FROM API ===\n')
    const orderId = nullRecords[0].shipbob_order_id

    const { data: creds } = await supabase
      .from('client_api_credentials')
      .select('api_token')
      .eq('client_id', HENSON_ID)
      .single()

    if (creds) {
      const response = await fetch(`https://api.shipbob.com/1.0/order/${orderId}`, {
        headers: { 'Authorization': `Bearer ${creds.api_token}` }
      })
      const order = await response.json()

      console.log(`Order ID: ${order.id}`)
      console.log(`Order Number: ${order.order_number}`)
      console.log(`Status: ${order.status}`)
      console.log(`Created: ${order.created_date}`)
      console.log(`Shipments count: ${order.shipments?.length || 0}`)

      if (order.shipments && order.shipments.length > 0) {
        console.log('\nShipments in API:')
        for (const s of order.shipments) {
          console.log(`  Shipment ID: ${s.id}`)
          console.log(`    status: ${s.status}`)
          console.log(`    ship_option: ${s.ship_option}`)
          console.log(`    location: ${s.location?.name || 'null'}`)
          console.log(`    tracking: ${s.tracking?.tracking_number || 'null'}`)
          console.log(`    carrier: ${s.tracking?.carrier || 'null'}`)
        }
      } else {
        console.log('\n>>> ORDER HAS NO SHIPMENTS ARRAY <<<')
        console.log('Full order object:')
        console.log(JSON.stringify(order, null, 2))
      }
    }
  }
}

investigate().catch(console.error)
