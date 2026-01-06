#!/usr/bin/env node
/**
 * Check if the orders for missing-item shipments exist in the orders table
 */
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceIds = [8693044, 8693047, 8693051, 8693054, 8693056]
  const hensonClientId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Checking if shipments have order_id and if those orders exist...\n')

  // Get shipments with no shipment_items
  let allTx = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('reference_id')
      .eq('client_id', hensonClientId)
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += 1000
  }

  const txShipmentIds = [...new Set(allTx.map(t => t.reference_id))]

  // Find which have shipment_items
  let hasItems = new Set()
  for (let i = 0; i < txShipmentIds.length; i += 400) {
    const batch = txShipmentIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipment_items')
      .select('shipment_id')
      .in('shipment_id', batch)
    if (data) data.forEach(si => hasItems.add(String(si.shipment_id)))
  }

  const noItemsIds = txShipmentIds.filter(sid => !hasItems.has(sid))
  console.log(`Shipments missing shipment_items: ${noItemsIds.length}`)

  // Get shipment details
  let shipments = []
  for (let i = 0; i < noItemsIds.length; i += 400) {
    const batch = noItemsIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, order_id')
      .in('shipment_id', batch)
    if (data) shipments.push(...data)
  }

  console.log(`Shipments found in shipments table: ${shipments.length}`)

  const withOrderId = shipments.filter(s => s.order_id)
  const withoutOrderId = shipments.filter(s => !s.order_id)
  console.log(`  - with order_id: ${withOrderId.length}`)
  console.log(`  - without order_id (null): ${withoutOrderId.length}`)

  // Check if orders exist
  const orderIds = [...new Set(withOrderId.map(s => s.order_id))]
  console.log(`\nUnique order_ids: ${orderIds.length}`)

  let existingOrders = []
  for (let i = 0; i < orderIds.length; i += 400) {
    const batch = orderIds.slice(i, i + 400)
    const { data } = await supabase
      .from('orders')
      .select('id, shipbob_order_id, order_type, channel_name, status')
      .in('id', batch)
    if (data) existingOrders.push(...data)
  }

  console.log(`Orders that EXIST in orders table: ${existingOrders.length}`)
  const missingOrderCount = orderIds.length - existingOrders.length
  console.log(`Orders MISSING from orders table: ${missingOrderCount}`)

  if (existingOrders.length > 0) {
    // Analyze existing orders
    const byType = {}
    const byChannel = {}
    const byStatus = {}
    for (const o of existingOrders) {
      byType[o.order_type || 'null'] = (byType[o.order_type || 'null'] || 0) + 1
      byChannel[o.channel_name || 'null'] = (byChannel[o.channel_name || 'null'] || 0) + 1
      byStatus[o.status || 'null'] = (byStatus[o.status || 'null'] || 0) + 1
    }

    console.log('\n=== Existing orders by order_type ===')
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`))

    console.log('\n=== Existing orders by channel_name ===')
    Object.entries(byChannel).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`))

    console.log('\n=== Existing orders by status ===')
    Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`))

    // Sample of orders
    console.log('\n=== Sample existing orders (first 5) ===')
    for (const o of existingOrders.slice(0, 5)) {
      console.log(`  ${o.shipbob_order_id}: type=${o.order_type}, channel=${o.channel_name}, status=${o.status}`)
    }
  }

  // Find the actual missing orders
  const existingOrderIds = new Set(existingOrders.map(o => o.id))
  const missingOrderIds = orderIds.filter(id => !existingOrderIds.has(id))

  if (missingOrderIds.length > 0) {
    console.log('\n=== Sample MISSING order_ids (shipment.order_id not in orders table) ===')
    // Get shipments for these missing orders
    const { data: missingSample } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, created_date, status, synced_at')
      .in('order_id', missingOrderIds.slice(0, 10))
      .limit(10)

    for (const s of missingSample || []) {
      console.log(`  shipment=${s.shipment_id}, order_id=${s.order_id}, status=${s.status}, synced=${s.synced_at?.split('T')[0]}`)
    }
  }
}

main().catch(console.error)
