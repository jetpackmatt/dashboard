#!/usr/bin/env node
/**
 * Find the exact shipments missing products_sold/quantity
 * Matching the preflight validation logic exactly
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhehiuanvcowiktcsmjr.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Client IDs
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const METHYL_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'  // Corrected ID

// Dec 8 invoice IDs
const invoiceIds = [8661966, 8661967, 8661968, 8661969]

async function checkClient(clientId, clientName) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`CHECKING ${clientName}`)
  console.log('='.repeat(80))

  // 1. Get all shipping transactions (paginated)
  const shippingTransactions = []
  let offset = 0
  const PAGE_SIZE = 1000

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('id, reference_id, base_cost, surcharge, tracking_id')
      .eq('client_id', clientId)
      .eq('fee_type', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + PAGE_SIZE - 1)

    if (!batch || batch.length === 0) break
    shippingTransactions.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  const shipmentIds = shippingTransactions.filter(tx => tx.reference_id).map(tx => tx.reference_id)
  console.log(`\nTotal shipping transactions: ${shippingTransactions.length}`)
  console.log(`Unique shipment IDs: ${shipmentIds.length}`)

  // Check base_cost
  const missingBaseCost = shippingTransactions.filter(tx => tx.base_cost === null)
  console.log(`\nMissing base_cost: ${missingBaseCost.length}`)
  if (missingBaseCost.length > 0) {
    console.log('  Sample shipments missing base_cost:')
    missingBaseCost.slice(0, 5).forEach(tx =>
      console.log(`    - Shipment ${tx.reference_id} (tx ${tx.id})`)
    )
  }

  // 2. Get shipments table data
  let shipmentsData = []
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, tracking_id, carrier, carrier_service, order_id')
      .eq('client_id', clientId)
      .in('shipment_id', shipmentIds.slice(i, i + 500))

    if (data) shipmentsData.push(...data)
  }
  console.log(`\nShipments in shipments table: ${shipmentsData.length}`)

  // 3. Get shipment_items
  let shipmentItemsData = []
  for (let i = 0; i < shipmentIds.length; i += 200) {
    const { data } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .eq('client_id', clientId)
      .in('shipment_id', shipmentIds.slice(i, i + 200))
      .limit(2000)

    if (data) shipmentItemsData.push(...data)
  }

  // Build shipmentItemsMap (same as preflight)
  const shipmentItemsMap = new Map()
  for (const item of shipmentItemsData) {
    const sid = String(item.shipment_id)
    const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
    if (item.name) existing.hasName = true
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    shipmentItemsMap.set(sid, existing)
  }

  console.log(`\nShipments with ANY shipment_items: ${shipmentItemsMap.size}`)
  console.log(`Shipments with NO shipment_items at all: ${shipmentsData.length - shipmentItemsMap.size}`)

  // 4. Get orders for order_items fallback
  const orderIds = [...new Set(shipmentsData.map(s => s.order_id).filter(Boolean))]
  let ordersData = []
  for (let i = 0; i < orderIds.length; i += 50) {
    const { data } = await supabase
      .from('orders')
      .select('id, store_order_id, channel_name')
      .in('id', orderIds.slice(i, i + 50))

    if (data) ordersData.push(...data)
  }
  const orderDataMap = new Map(ordersData.map(o => [String(o.id), o]))

  // Build shipment to order mapping
  const shipmentToOrderMap = new Map(shipmentsData.map(s => [String(s.shipment_id), String(s.order_id)]))

  // 5. EXACT preflight logic for fallback (line 237-278)
  // Only considers shipments WITH items that have name but no quantity
  const shipmentsMissingQty = [...shipmentItemsMap.entries()]
    .filter(([, v]) => v.hasName && !v.hasQuantity)
    .map(([sid]) => sid)

  console.log(`\nShipments with items needing qty fallback: ${shipmentsMissingQty.length}`)

  if (shipmentsMissingQty.length > 0) {
    const orderIdsForFallback = [...new Set(
      shipmentsMissingQty.map(sid => shipmentToOrderMap.get(sid)).filter(Boolean)
    )]

    let orderItemsData = []
    for (let i = 0; i < orderIdsForFallback.length; i += 50) {
      const { data } = await supabase
        .from('order_items')
        .select('order_id, name, quantity')
        .in('order_id', orderIdsForFallback.slice(i, i + 50))
        .limit(1000)

      if (data) orderItemsData.push(...data)
    }

    const orderItemsMap = new Map()
    for (const item of orderItemsData) {
      if (item.quantity !== null && item.quantity !== undefined) {
        orderItemsMap.set(String(item.order_id), true)
      }
    }

    // Update shipmentItemsMap with fallback
    for (const sid of shipmentsMissingQty) {
      const orderId = shipmentToOrderMap.get(sid)
      if (orderId && orderItemsMap.get(orderId)) {
        const existing = shipmentItemsMap.get(sid)
        if (existing) {
          existing.hasQuantity = true
          shipmentItemsMap.set(sid, existing)
        }
      }
    }
  }

  // 6. Now count EXACTLY as preflight does (line 440)
  const withProductsSold = [...shipmentItemsMap.values()].filter(v => v.hasName && v.hasQuantity).length
  const totalShipments = shipmentsData.length
  const missingProductsSold = totalShipments - withProductsSold

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`PREFLIGHT COMPARISON:`)
  console.log(`  Total shipments: ${totalShipments}`)
  console.log(`  withProductsSold: ${withProductsSold}`)
  console.log(`  MISSING products_sold: ${missingProductsSold}`)

  // 7. Find the EXACT shipments missing products_sold
  // These are shipments where EITHER:
  //   - They have no entry in shipmentItemsMap (no shipment_items at all)
  //   - OR they have an entry but !hasName || !hasQuantity

  const missingShipments = shipmentsData.filter(s => {
    const sid = String(s.shipment_id)
    const info = shipmentItemsMap.get(sid)
    // Missing if: no items at all, OR missing name, OR missing quantity
    if (!info) return true
    return !info.hasName || !info.hasQuantity
  })

  console.log(`\nShipments missing products_sold (detail):`)
  for (const s of missingShipments.slice(0, 10)) {
    const sid = String(s.shipment_id)
    const info = shipmentItemsMap.get(sid)
    const orderId = s.order_id
    const orderData = orderDataMap.get(String(orderId))

    if (!info) {
      console.log(`  - Shipment ${sid}: NO items in shipment_items table`)
      console.log(`    order_id: ${orderId}, channel: ${orderData?.channel_name || 'N/A'}`)
    } else {
      console.log(`  - Shipment ${sid}: hasName=${info.hasName}, hasQuantity=${info.hasQuantity}`)
      console.log(`    order_id: ${orderId}, channel: ${orderData?.channel_name || 'N/A'}`)
    }

    // Check if order_items has data for this order
    if (orderId) {
      const { data: oi } = await supabase
        .from('order_items')
        .select('name, quantity')
        .eq('order_id', orderId)
        .limit(5)

      console.log(`    order_items: ${oi?.length || 0} items, sample: ${JSON.stringify(oi?.[0] || {})}`)
    }
  }

  // 8. Also check store_order_id
  const missingStoreOrderId = shipmentsData.filter(s => {
    const order = orderDataMap.get(String(s.order_id))
    if (!order) return true
    // ShipBob Default is expected to not have store_order_id
    if (order.channel_name === 'ShipBob Default') return false
    return !order.store_order_id
  })

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`STORE_ORDER_ID CHECK:`)
  console.log(`  Missing store_order_id (non-ShipBob Default): ${missingStoreOrderId.length}`)
  if (missingStoreOrderId.length > 0) {
    console.log('  Sample:')
    for (const s of missingStoreOrderId.slice(0, 5)) {
      const order = orderDataMap.get(String(s.order_id))
      console.log(`    - Shipment ${s.shipment_id}, order ${s.order_id}, channel: ${order?.channel_name || 'N/A'}`)
    }
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('FINDING EXACT SHIPMENTS MISSING PRODUCTS_SOLD')
  console.log('Invoice IDs:', invoiceIds.join(', '))
  console.log('='.repeat(80))

  await checkClient(HENSON_ID, 'HENSON SHAVING')
  await checkClient(METHYL_ID, 'METHYL-LIFE')

  console.log('\n' + '='.repeat(80))
  console.log('ANALYSIS COMPLETE')
  console.log('='.repeat(80))
}

main().catch(console.error)
