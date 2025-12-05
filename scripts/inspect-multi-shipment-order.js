#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function inspect() {
  console.log('=== INSPECTING MULTI-SHIPMENT ORDERS ===\n')

  // Find orders with multiple shipments
  const { data: multiOrders } = await supabase
    .from('orders')
    .select('id, shipbob_order_id, store_order_id, customer_name, order_date, total_shipments')
    .eq('client_id', HENSON_ID)
    .gt('total_shipments', 1)

  console.log(`Found ${multiOrders?.length || 0} orders with multiple shipments\n`)

  for (const order of multiOrders || []) {
    console.log(`ORDER: ${order.store_order_id} (ShipBob: ${order.shipbob_order_id})`)
    console.log(`  Customer: ${order.customer_name}`)
    console.log(`  Order Date: ${order.order_date}`)
    console.log(`  Total Shipments: ${order.total_shipments}`)

    // Get all shipments for this order
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipment_id, status, label_generation_date, carrier, carrier_service, fc_name, tracking_id')
      .eq('order_id', order.id)
      .order('label_generation_date', { ascending: true })

    console.log('\n  SHIPMENTS:')
    for (const s of shipments || []) {
      console.log(`    Shipment ${s.shipment_id}:`)
      console.log(`      Status: ${s.status}`)
      console.log(`      Label Date: ${s.label_generation_date}`)
      console.log(`      FC: ${s.fc_name}`)
      console.log(`      Carrier: ${s.carrier} - ${s.carrier_service}`)
      console.log(`      Tracking: ${s.tracking_id}`)
      console.log('')
    }

    // Fetch from API to see more details
    const { data: creds } = await supabase
      .from('client_api_credentials')
      .select('api_token')
      .eq('client_id', HENSON_ID)
      .single()

    const response = await fetch(`https://api.shipbob.com/1.0/order/${order.shipbob_order_id}`, {
      headers: { 'Authorization': `Bearer ${creds.api_token}` }
    })
    const apiOrder = await response.json()

    console.log('  API ORDER DETAILS:')
    console.log(`    Status: ${apiOrder.status}`)
    console.log(`    Products ordered: ${apiOrder.products?.length || 0}`)

    if (apiOrder.products) {
      console.log('    Products:')
      for (const p of apiOrder.products) {
        console.log(`      - ${p.name} (qty: ${p.quantity})`)
      }
    }

    console.log('\n  API SHIPMENTS:')
    for (const s of apiOrder.shipments || []) {
      console.log(`    Shipment ${s.id}:`)
      console.log(`      Status: ${s.status}`)
      console.log(`      Created: ${s.created_date}`)
      console.log(`      Fulfilled: ${s.actual_fulfillment_date}`)
      console.log(`      Products in shipment: ${s.products?.length || 'N/A'}`)
      if (s.products) {
        for (const p of s.products) {
          console.log(`        - ${p.name} (qty: ${p.quantity})`)
        }
      }
    }

    console.log('\n' + '='.repeat(60) + '\n')
  }

  // Analysis
  console.log('=== ANALYSIS ===')
  console.log('To distinguish multi-shipment types:')
  console.log('1. SPLIT SHIPMENT: Same date, different FCs or items')
  console.log('2. PARTIAL FULFILLMENT: Different dates, sequential')
  console.log('3. RE-SHIPMENT: Later date, likely same items, original may be cancelled/lost')
}

inspect().catch(console.error)
