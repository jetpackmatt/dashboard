#!/usr/bin/env node
/**
 * Test the preflight fallback logic for products_sold
 * Tests that orders with order_items but no shipment_items get correctly handled
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

  console.log('Testing preflight fallback logic for Dec 8-14 invoices...\n')

  // Get all shipping transactions
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

  const shipmentIds = [...new Set(allTx.map(t => t.reference_id))]
  console.log(`Total shipments in transactions: ${shipmentIds.length}`)

  // Get shipments data with order_ids
  let shipmentsData = []
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batch = shipmentIds.slice(i, i + 500)
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, order_id')
      .eq('client_id', hensonClientId)
      .in('shipment_id', batch)
    if (data) shipmentsData.push(...data)
  }
  console.log(`Shipments in shipments table: ${shipmentsData.length}`)

  // Get shipment_items
  let shipmentItemsData = []
  for (let i = 0; i < shipmentIds.length; i += 200) {
    const batch = shipmentIds.slice(i, i + 200)
    const { data } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .eq('client_id', hensonClientId)
      .in('shipment_id', batch)
      .limit(2000)
    if (data) shipmentItemsData.push(...data)
  }

  // Build shipment_items lookup
  const shipmentItemsMap = new Map()
  for (const item of shipmentItemsData) {
    const sid = String(item.shipment_id)
    const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
    if (item.name) existing.hasName = true
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    shipmentItemsMap.set(sid, existing)
  }

  console.log(`Shipments with shipment_items: ${shipmentItemsMap.size}`)

  // Find shipments with NO shipment_items
  const shipmentToOrderMap = new Map(shipmentsData.map(s => [String(s.shipment_id), String(s.order_id)]))
  const shipmentsWithNoItems = shipmentsData
    .map(s => String(s.shipment_id))
    .filter(sid => !shipmentItemsMap.has(sid))

  console.log(`Shipments with NO shipment_items: ${shipmentsWithNoItems.length}`)

  // Get order_ids for shipments with no items
  const orderIdsForFallback = [...new Set(
    shipmentsWithNoItems.map(sid => shipmentToOrderMap.get(sid)).filter(Boolean)
  )]
  console.log(`Unique orders for fallback: ${orderIdsForFallback.length}`)

  // Fetch order_items for these orders
  // Note: order_items has sku (not name), so we use sku as fallback for product name
  let orderItemsData = []
  for (let i = 0; i < orderIdsForFallback.length; i += 50) {
    const { data } = await supabase
      .from('order_items')
      .select('order_id, sku, quantity')
      .in('order_id', orderIdsForFallback.slice(i, i + 50))
      .limit(1000)
    if (data) orderItemsData.push(...data)
  }

  // Build order_items lookup (use sku as proxy for name)
  const orderItemsMap = new Map()
  for (const item of orderItemsData) {
    const oid = String(item.order_id)
    const existing = orderItemsMap.get(oid) || { hasName: false, hasQuantity: false }
    if (item.sku) existing.hasName = true  // SKU serves as product identifier
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    orderItemsMap.set(oid, existing)
  }

  console.log(`Orders with order_items: ${orderItemsMap.size}`)

  // Simulate the fallback
  let fallbackSuccessCount = 0
  let fallbackFailCount = 0

  for (const sid of shipmentsWithNoItems) {
    const orderId = shipmentToOrderMap.get(sid)
    if (orderId) {
      const orderItems = orderItemsMap.get(orderId)
      if (orderItems && orderItems.hasName && orderItems.hasQuantity) {
        fallbackSuccessCount++
      } else {
        fallbackFailCount++
      }
    } else {
      fallbackFailCount++
    }
  }

  console.log('\n=== FALLBACK RESULTS ===')
  console.log(`Shipments that would get products_sold from order_items: ${fallbackSuccessCount}`)
  console.log(`Shipments that would still be missing products_sold: ${fallbackFailCount}`)

  // Calculate final products_sold count
  const shipmentsWithProductsSold = shipmentItemsMap.size + fallbackSuccessCount
  const totalShipments = shipmentsData.length
  const pct = Math.round((shipmentsWithProductsSold / totalShipments) * 100)

  console.log('\n=== FINAL PREFLIGHT SUMMARY ===')
  console.log(`Total shipments: ${totalShipments}`)
  console.log(`With products_sold: ${shipmentsWithProductsSold} (${pct}%)`)
  console.log(`Missing products_sold: ${totalShipments - shipmentsWithProductsSold} (${100 - pct}%)`)

  // Analyze the failures
  console.log('\n=== ANALYZING FAILURES ===')
  const failureSample = shipmentsWithNoItems.filter(sid => {
    const orderId = shipmentToOrderMap.get(sid)
    if (!orderId) return true
    const orderItems = orderItemsMap.get(orderId)
    return !orderItems || !orderItems.hasName || !orderItems.hasQuantity
  }).slice(0, 5)

  for (const sid of failureSample) {
    const orderId = shipmentToOrderMap.get(sid)
    console.log(`\nShipment ${sid}:`)
    console.log(`  order_id: ${orderId}`)

    if (orderId) {
      // Check if order exists
      const { data: order } = await supabase
        .from('orders')
        .select('id, shipbob_order_id')
        .eq('id', orderId)
        .single()

      if (order) {
        console.log(`  order exists: yes (shipbob_order_id: ${order.shipbob_order_id})`)
        // Check order_items
        const { count } = await supabase
          .from('order_items')
          .select('*', { count: 'exact', head: true })
          .eq('order_id', orderId)
        console.log(`  order_items count: ${count}`)
      } else {
        console.log(`  order exists: NO - ORDER NEVER SYNCED`)
      }
    }
  }
}

main().catch(console.error)
