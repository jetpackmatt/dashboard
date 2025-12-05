#!/usr/bin/env node
/**
 * Analyze: All records with NULL carrier_service
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function analyze() {
  console.log('=== ANALYZING NULL CARRIER_SERVICE RECORDS ===\n')

  // Get all records with NULL carrier_service
  const { data: nullRecords } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, carrier_service, carrier')
    .eq('client_id', HENSON_ID)
    .is('carrier_service', null)

  const total = nullRecords?.length || 0
  const withShipmentId = nullRecords?.filter(r => r.shipment_id)?.length || 0
  const withoutShipmentId = nullRecords?.filter(r => !r.shipment_id)?.length || 0

  console.log(`Total with NULL carrier_service: ${total}`)
  console.log(`  - With shipment_id (new sync):    ${withShipmentId}`)
  console.log(`  - Without shipment_id (legacy):   ${withoutShipmentId}`)

  // If there are records WITH shipment_id but NULL carrier_service, investigate
  if (withShipmentId > 0) {
    console.log('\n=== RECORDS WITH SHIPMENT_ID BUT NULL CARRIER_SERVICE ===')
    const recordsWithId = nullRecords?.filter(r => r.shipment_id) || []

    // Fetch these from API
    const { data: creds } = await supabase
      .from('client_api_credentials')
      .select('api_token')
      .eq('client_id', HENSON_ID)
      .single()

    for (const record of recordsWithId.slice(0, 5)) {
      // Need to fetch order by shipment - use search
      const response = await fetch(`https://api.shipbob.com/1.0/order?ShipmentIds=${record.shipment_id}&Limit=1`, {
        headers: { 'Authorization': `Bearer ${creds.api_token}` }
      })
      const orders = await response.json()
      const order = orders[0]

      if (order) {
        const shipment = order.shipments?.find(s => s.id.toString() === record.shipment_id)
        console.log(`\nShipment ${record.shipment_id}:`)
        console.log(`  DB carrier_service: ${record.carrier_service || 'NULL'}`)
        console.log(`  API ship_option: ${shipment?.ship_option || 'NULL in API!'}`)
        console.log(`  API status: ${shipment?.status}`)
      }
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===')
  console.log(`Legacy records (no shipment_id): ${withoutShipmentId} - DELETE AND RE-SYNC`)
  console.log(`Records with shipment_id but NULL carrier: ${withShipmentId} - INVESTIGATE`)
}

analyze().catch(console.error)
