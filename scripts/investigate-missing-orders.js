#!/usr/bin/env node
/**
 * Investigate the 400 orders that have NO order_items
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

  console.log('Investigating orders with NO order_items...\n')

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

  // Get order_ids for these shipments
  let orderIds = []
  for (let i = 0; i < noItemsIds.length; i += 400) {
    const batch = noItemsIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, order_id')
      .in('shipment_id', batch)
    if (data) orderIds.push(...data.filter(s => s.order_id))
  }

  const shipmentOrderMap = new Map(orderIds.map(s => [s.shipment_id, s.order_id]))
  const uniqueOrderIds = [...new Set(orderIds.map(s => s.order_id))]
  console.log(`Unique order_ids: ${uniqueOrderIds.length}`)

  // Check which have order_items
  let ordersWithItems = new Set()
  for (let i = 0; i < uniqueOrderIds.length; i += 400) {
    const batch = uniqueOrderIds.slice(i, i + 400)
    const { data } = await supabase
      .from('order_items')
      .select('order_id')
      .in('order_id', batch)
    if (data) data.forEach(oi => ordersWithItems.add(oi.order_id))
  }

  const ordersWithoutItems = uniqueOrderIds.filter(oid => !ordersWithItems.has(oid))
  console.log(`Orders WITH order_items: ${ordersWithItems.size}`)
  console.log(`Orders WITHOUT order_items: ${ordersWithoutItems.length}`)

  // Get details for orders without items
  console.log('\n=== Sampling orders WITHOUT order_items ===')
  const sampleOrderIds = ordersWithoutItems.slice(0, 20)
  const { data: sampleOrders } = await supabase
    .from('orders')
    .select('id, shipbob_order_id, order_type, channel_name, status, created_date, synced_at')
    .in('id', sampleOrderIds)

  for (const o of sampleOrders || []) {
    console.log(`\nOrder ${o.shipbob_order_id}:`)
    console.log(`  order_type: ${o.order_type}`)
    console.log(`  channel: ${o.channel_name}`)
    console.log(`  status: ${o.status}`)
    console.log(`  created: ${o.created_date?.split('T')[0]}`)
    console.log(`  synced_at: ${o.synced_at?.split('T')[0]}`)
  }

  // Breakdown by order_type
  console.log('\n=== Orders WITHOUT order_items by order_type ===')
  const { data: allOrders } = await supabase
    .from('orders')
    .select('order_type, channel_name')
    .in('id', ordersWithoutItems)

  const byType = {}
  const byChannel = {}
  for (const o of allOrders || []) {
    byType[o.order_type || 'null'] = (byType[o.order_type || 'null'] || 0) + 1
    byChannel[o.channel_name || 'null'] = (byChannel[o.channel_name || 'null'] || 0) + 1
  }
  console.log('\nBy order_type:')
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`))
  console.log('\nBy channel_name:')
  Object.entries(byChannel).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`))

  // Check synced_at distribution
  console.log('\n=== Synced_at distribution (orders without items) ===')
  const { data: syncDates } = await supabase
    .from('orders')
    .select('synced_at')
    .in('id', ordersWithoutItems)

  const bySyncDate = {}
  for (const o of syncDates || []) {
    const date = o.synced_at?.split('T')[0] || 'null'
    bySyncDate[date] = (bySyncDate[date] || 0) + 1
  }
  Object.entries(bySyncDate).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10).forEach(([d, c]) => console.log(`  ${d}: ${c}`))

  // Check if ShipBob API returns products for these orders
  // (We can't call API directly, but let's check if the orders seem valid)
  console.log('\n=== Sample shipbob_order_ids (for manual API check) ===')
  const { data: sampleSB } = await supabase
    .from('orders')
    .select('shipbob_order_id')
    .in('id', ordersWithoutItems.slice(0, 10))

  for (const o of sampleSB || []) {
    console.log(`  ${o.shipbob_order_id}`)
  }
}

main().catch(console.error)
