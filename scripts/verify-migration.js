#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verify() {
  console.log('=== MIGRATION VERIFICATION ===\n')

  // Count tables
  const { count: ordersCount } = await supabase.from('orders').select('*', { count: 'exact', head: true })
  const { count: shipmentsCount } = await supabase.from('shipments').select('*', { count: 'exact', head: true })
  const { count: shipmentsOldCount } = await supabase.from('shipments_old').select('*', { count: 'exact', head: true })

  console.log('TABLE COUNTS:')
  console.log(`  orders:        ${ordersCount}`)
  console.log(`  shipments:     ${shipmentsCount}`)
  console.log(`  shipments_old: ${shipmentsOldCount}`)

  // Multi-shipment orders
  const { data: multiShipment } = await supabase
    .from('orders')
    .select('total_shipments')
    .gt('total_shipments', 1)

  console.log(`\nMULTI-SHIPMENT ORDERS: ${multiShipment?.length || 0}`)

  // Sample order with shipments
  const { data: sampleOrder } = await supabase
    .from('orders')
    .select('shipbob_order_id, store_order_id, customer_name, total_shipments')
    .gt('total_shipments', 0)
    .limit(1)
    .single()

  if (sampleOrder) {
    console.log('\nSAMPLE ORDER:')
    console.log(`  ShipBob Order: ${sampleOrder.shipbob_order_id}`)
    console.log(`  Store Order:   ${sampleOrder.store_order_id}`)
    console.log(`  Customer:      ${sampleOrder.customer_name}`)
    console.log(`  Shipments:     ${sampleOrder.total_shipments}`)

    // Get shipments for this order
    const { data: orderShipments } = await supabase
      .from('shipments')
      .select('shipment_id, carrier_service, status')
      .eq('shipbob_order_id', sampleOrder.shipbob_order_id)

    if (orderShipments) {
      console.log('  Shipment details:')
      for (const s of orderShipments) {
        console.log(`    - ${s.shipment_id}: ${s.carrier_service} (${s.status})`)
      }
    }
  }

  console.log('\n=== MIGRATION VERIFIED ===')
}

verify().catch(console.error)
