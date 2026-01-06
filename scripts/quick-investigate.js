#!/usr/bin/env node
/**
 * Quick investigation of missing items - output to console
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

  // Get 20 sample shipment IDs that have no items
  console.log('Getting sample shipments without items...\n')

  // First get all tx shipment IDs
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

  // Find which have items
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
  console.log(`Total shipments: ${txShipmentIds.length}`)
  console.log(`With items: ${hasItems.size}`)
  console.log(`Missing items: ${noItemsIds.length}\n`)

  // Get sample 10 shipments without items
  const sampleIds = noItemsIds.slice(0, 10)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, status, created_date')
    .in('shipment_id', sampleIds)

  console.log('=== Sample shipments missing items ===')
  for (const s of shipments || []) {
    console.log(`\nShipment ${s.shipment_id}:`)
    console.log(`  status: ${s.status}`)
    console.log(`  created: ${s.created_date?.split('T')[0]}`)

    // Check order
    if (s.order_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('shipbob_order_id, order_type, channel_name, status')
        .eq('id', s.order_id)
        .single()

      if (order) {
        console.log(`  order_type: ${order.order_type}`)
        console.log(`  channel: ${order.channel_name}`)
        console.log(`  order_status: ${order.status}`)
      }

      // Check order_items
      const { count } = await supabase
        .from('order_items')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', s.order_id)

      console.log(`  order_items count: ${count || 0}`)
    }
  }

  // Group by order_type
  console.log('\n\n=== All missing items - by order_type ===')
  const orderIds = []
  for (let i = 0; i < noItemsIds.length; i += 400) {
    const batch = noItemsIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipments')
      .select('order_id')
      .in('shipment_id', batch)
    if (data) orderIds.push(...data.map(s => s.order_id).filter(Boolean))
  }

  const { data: orders } = await supabase
    .from('orders')
    .select('order_type')
    .in('id', [...new Set(orderIds)])

  const byType = {}
  for (const o of orders || []) {
    byType[o.order_type || 'null'] = (byType[o.order_type || 'null'] || 0) + 1
  }
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`)
  })

  // Check if orders have order_items
  console.log('\n=== Do these orders have order_items? ===')
  const uniqueOrderIds = [...new Set(orderIds)]
  let ordersWithItems = 0
  let ordersWithoutItems = 0
  for (let i = 0; i < uniqueOrderIds.length; i += 400) {
    const batch = uniqueOrderIds.slice(i, i + 400)
    const { data } = await supabase
      .from('order_items')
      .select('order_id')
      .in('order_id', batch)
    const withItems = new Set((data || []).map(oi => oi.order_id))
    for (const oid of batch) {
      if (withItems.has(oid)) ordersWithItems++
      else ordersWithoutItems++
    }
  }
  console.log(`  Orders WITH order_items: ${ordersWithItems}`)
  console.log(`  Orders WITHOUT order_items: ${ordersWithoutItems}`)
}

main().catch(console.error)
