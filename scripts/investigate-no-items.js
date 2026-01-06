#!/usr/bin/env node
/**
 * Investigate why ~10% of shipments have no shipment_items or order_items
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

  console.log('Investigating shipments with NO items for Dec 8-14 (Henson)...\n')

  // Step 1: Get all shipment IDs from transactions
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
  console.log(`Total shipments: ${txShipmentIds.length}`)

  // Step 2: Find shipments with NO items
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
  console.log(`Shipments with items: ${hasItems.size}`)
  console.log(`Shipments with NO items: ${noItemsIds.length}`)

  if (noItemsIds.length === 0) return

  // Step 3: Get details for shipments without items
  console.log('\n--- Investigating sample of shipments with no items ---')

  const sampleIds = noItemsIds.slice(0, 20)
  const { data: sampleShipments } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, status, created_date, synced_at')
    .in('shipment_id', sampleIds)

  if (!sampleShipments) return

  // Group by order_id to check orders
  const orderIds = [...new Set(sampleShipments.map(s => s.order_id).filter(Boolean))]
  console.log(`Sample shipments: ${sampleShipments.length}`)
  console.log(`Unique orders: ${orderIds.length}`)

  // Get order details
  const { data: orders } = await supabase
    .from('orders')
    .select('id, shipbob_order_id, order_type, channel_name, status, created_date')
    .in('id', orderIds)

  const ordersMap = new Map(orders?.map(o => [o.id, o]) || [])

  // Check order_items
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('order_id')
    .in('order_id', orderIds)

  const ordersWithItems = new Set(orderItems?.map(oi => oi.order_id) || [])

  console.log('\n--- Sample shipments ---')
  for (const ship of sampleShipments.slice(0, 10)) {
    const order = ordersMap.get(ship.order_id)
    const hasOrderItems = ordersWithItems.has(ship.order_id)

    console.log(`\nShipment ${ship.shipment_id}:`)
    console.log(`  status: ${ship.status}`)
    console.log(`  created: ${ship.created_date?.split('T')[0]}`)
    console.log(`  synced_at: ${ship.synced_at}`)
    if (order) {
      console.log(`  Order ${order.shipbob_order_id}:`)
      console.log(`    type: ${order.order_type}`)
      console.log(`    channel: ${order.channel_name}`)
      console.log(`    status: ${order.status}`)
      console.log(`    has order_items: ${hasOrderItems}`)
    }
  }

  // Step 4: Check created_date distribution
  console.log('\n--- Created date distribution ---')

  // Get all shipments without items
  let allNoItems = []
  for (let i = 0; i < noItemsIds.length; i += 400) {
    const batch = noItemsIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipments')
      .select('created_date, synced_at')
      .in('shipment_id', batch)
    if (data) allNoItems.push(...data)
  }

  const byDate = {}
  const bySyncedDate = {}
  for (const s of allNoItems) {
    const created = s.created_date?.split('T')[0] || 'unknown'
    const synced = s.synced_at?.split('T')[0] || 'unknown'
    byDate[created] = (byDate[created] || 0) + 1
    bySyncedDate[synced] = (bySyncedDate[synced] || 0) + 1
  }

  console.log('By created_date:')
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`))

  console.log('\nBy synced_at:')
  Object.entries(bySyncedDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`))
}

main().catch(console.error)
