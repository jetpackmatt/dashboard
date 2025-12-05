#!/usr/bin/env node
/**
 * Inspect: Shipments where API returns NULL ship_option
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function inspect() {
  console.log('=== INSPECTING SHIPMENTS WITH NULL SHIP_OPTION IN API ===\n')

  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Shipment IDs that have NULL carrier_service but HAVE shipment_id
  const testShipmentIds = ['317601417', '317600780', '317598468']

  for (const shipmentId of testShipmentIds) {
    console.log(`=== Shipment ${shipmentId} ===\n`)

    // Fetch order by shipment ID
    const response = await fetch(`https://api.shipbob.com/1.0/order?ShipmentIds=${shipmentId}&Limit=1`, {
      headers: { 'Authorization': `Bearer ${creds.api_token}` }
    })
    const orders = await response.json()

    if (orders.length === 0) {
      console.log('No order found for this shipment ID!')
      console.log('This shipment may have been deleted or is not accessible.')
      console.log('')
      continue
    }

    const order = orders[0]
    console.log(`Order ID: ${order.id}`)
    console.log(`Order Number: ${order.order_number}`)
    console.log(`Order Status: ${order.status}`)
    console.log(`Created: ${order.created_date}`)
    console.log('')

    // Find the shipment
    const shipment = order.shipments?.find(s => s.id.toString() === shipmentId)

    if (shipment) {
      console.log('Shipment details:')
      console.log(`  id: ${shipment.id}`)
      console.log(`  status: ${shipment.status}`)
      console.log(`  ship_option: ${shipment.ship_option === null ? 'NULL' : `"${shipment.ship_option}"`}`)
      console.log(`  location: ${shipment.location?.name || 'NULL'}`)
      console.log(`  tracking: ${shipment.tracking?.tracking_number || 'NULL'}`)
      console.log(`  carrier: ${shipment.tracking?.carrier || 'NULL'}`)
      console.log(`  zone: ${shipment.zone?.id || 'NULL'}`)
      console.log('')
      console.log('Full shipment object:')
      console.log(JSON.stringify(shipment, null, 2))
    } else {
      console.log(`Shipment ${shipmentId} not found in order.shipments!`)
      console.log('Order shipments:')
      for (const s of order.shipments || []) {
        console.log(`  - ${s.id}`)
      }
    }
    console.log('\n---\n')
  }

  // Check the DB records for these
  console.log('=== DATABASE RECORDS FOR THESE SHIPMENTS ===\n')
  const { data: dbRecords } = await supabase
    .from('shipments')
    .select('*')
    .in('shipment_id', testShipmentIds)

  for (const r of dbRecords || []) {
    console.log(`Shipment ${r.shipment_id}:`)
    console.log(`  order_date: ${r.order_date}`)
    console.log(`  customer_name: ${r.customer_name}`)
    console.log(`  carrier_service: ${r.carrier_service || 'NULL'}`)
    console.log(`  fc_name: ${r.fc_name || 'NULL'}`)
    console.log('')
  }
}

inspect().catch(console.error)
