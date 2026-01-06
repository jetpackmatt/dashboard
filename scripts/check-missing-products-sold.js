#!/usr/bin/env node
/**
 * Check why ~3% of shipments are missing products_sold in preflight
 *
 * The preflight fallback logic:
 * 1. Gets shipment_items for each shipment
 * 2. If hasName but !hasQuantity, falls back to order_items
 * 3. But does NOT handle: no entry in shipment_items at all
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Current week invoices (Dec 8-14 period, invoice_date Dec 15)
  const invoiceIds = [8693044, 8693047, 8693051, 8693054, 8693056]

  // Henson client ID
  const hensonClientId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Checking products_sold situation for Henson client')
  console.log('Invoice IDs:', invoiceIds.join(', '))
  console.log('=' .repeat(70))

  // Get ALL shipping transactions for Henson in these invoices (with pagination)
  let transactions = []
  let offset = 0
  const PAGE_SIZE = 1000
  let hasMore = true

  while (hasMore) {
    const { data: batch, error: txError } = await supabase
      .from('transactions')
      .select('reference_id, client_id')
      .eq('client_id', hensonClientId)
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + PAGE_SIZE - 1)

    if (txError) {
      console.error('Error fetching transactions:', txError)
      return
    }

    if (batch && batch.length > 0) {
      transactions.push(...batch)
      offset += batch.length
      hasMore = batch.length === PAGE_SIZE
    } else {
      hasMore = false
    }
  }

  console.log(`Fetched ${transactions.length} total transactions (paginated)`)

  const shipmentIds = [...new Set(transactions.map(t => t.reference_id))]
  console.log(`\nTotal unique shipments in transactions: ${shipmentIds.length}`)

  // Check shipment_items (batched - .in() has ~500 element limit)
  const BATCH_SIZE = 400
  let shipmentItems = []

  for (let i = 0; i < shipmentIds.length; i += BATCH_SIZE) {
    const batch = shipmentIds.slice(i, i + BATCH_SIZE)
    const { data, error: siError } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .in('shipment_id', batch)

    if (siError) {
      console.error(`Error fetching shipment_items batch ${i/BATCH_SIZE + 1}:`, siError)
      continue
    }
    if (data) shipmentItems.push(...data)
  }
  console.log(`Fetched ${shipmentItems.length} shipment_items entries`)

  // Build the same map preflight uses
  const shipmentItemsMap = new Map()
  for (const item of shipmentItems) {
    const sid = String(item.shipment_id)
    const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
    if (item.name) existing.hasName = true
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    shipmentItemsMap.set(sid, existing)
  }

  console.log(`Shipments with entries in shipment_items: ${shipmentItemsMap.size}`)
  console.log(`Shipments with NO entry in shipment_items: ${shipmentIds.length - shipmentItemsMap.size}`)

  // Categorize
  let hasNameAndQty = 0
  let hasNameNoQty = 0
  let hasQtyNoName = 0
  let hasNeither = 0
  let noEntry = 0

  const missingShipmentIds = []

  for (const sid of shipmentIds) {
    const items = shipmentItemsMap.get(sid)
    if (!items) {
      noEntry++
      missingShipmentIds.push(sid)
    } else if (items.hasName && items.hasQuantity) {
      hasNameAndQty++
    } else if (items.hasName && !items.hasQuantity) {
      hasNameNoQty++
    } else if (!items.hasName && items.hasQuantity) {
      hasQtyNoName++
    } else {
      hasNeither++
    }
  }

  console.log('\n--- Breakdown ---')
  console.log(`✅ Has name AND quantity: ${hasNameAndQty} (${(hasNameAndQty/shipmentIds.length*100).toFixed(1)}%)`)
  console.log(`⚠️ Has name, NO quantity: ${hasNameNoQty} (falls back to order_items)`)
  console.log(`⚠️ Has quantity, NO name: ${hasQtyNoName}`)
  console.log(`❌ Has neither name nor qty: ${hasNeither}`)
  console.log(`❌ NO entry in shipment_items: ${noEntry}`)

  // For missing shipments, check if they have order_items
  if (missingShipmentIds.length > 0) {
    console.log(`\n--- Checking ${missingShipmentIds.slice(0, 10).length} missing shipments for order_items fallback ---`)

    // Get shipments to find their order_ids
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipment_id, order_id')
      .in('shipment_id', missingShipmentIds.slice(0, 50))

    console.log(`Found ${shipments?.length || 0} shipments in shipments table`)

    if (shipments && shipments.length > 0) {
      const orderIds = [...new Set(shipments.map(s => s.order_id).filter(Boolean))]

      // Check order_items for these orders
      const { data: orderItems } = await supabase
        .from('order_items')
        .select('order_id, name, quantity')
        .in('order_id', orderIds)

      console.log(`Found ${orderItems?.length || 0} order_items for ${orderIds.length} orders`)

      // How many have usable order_items?
      const orderItemsMap = new Map()
      for (const oi of (orderItems || [])) {
        const key = oi.order_id
        const existing = orderItemsMap.get(key) || { hasName: false, hasQuantity: false }
        if (oi.name) existing.hasName = true
        if (oi.quantity !== null) existing.hasQuantity = true
        orderItemsMap.set(key, existing)
      }

      let couldRecover = 0
      let cannotRecover = 0
      const ordersWithNoItems = []

      for (const shipment of shipments) {
        const items = orderItemsMap.get(shipment.order_id)
        if (items?.hasName && items?.hasQuantity) {
          couldRecover++
        } else {
          cannotRecover++
          ordersWithNoItems.push({ shipment_id: shipment.shipment_id, order_id: shipment.order_id })
        }
      }

      console.log(`Could recover via order_items: ${couldRecover}`)
      console.log(`Cannot recover (no order_items): ${cannotRecover}`)

      if (ordersWithNoItems.length > 0) {
        console.log(`\nSample orders with no items:`)
        for (const o of ordersWithNoItems.slice(0, 5)) {
          // Check orders table
          const { data: order } = await supabase
            .from('orders')
            .select('id, order_type, channel_name, store_order_id')
            .eq('id', o.order_id)
            .single()

          const isB2B = order?.order_type === 'B2B'
          const isManual = !order?.store_order_id &&
            (!order?.channel_name || order.channel_name === 'ShipBob Default' || order.channel_name === 'N/A')

          console.log(`  shipment: ${o.shipment_id}, order: ${o.order_id}`)
          console.log(`    order_type: ${order?.order_type}, channel: ${order?.channel_name}, store_order_id: ${order?.store_order_id}`)
          console.log(`    isB2B: ${isB2B}, isManual: ${isManual} (these are EXCLUDED from products_sold check)`)
        }
      }
    }
  }

  // Calculate the ~3% that would fail
  const wouldFail = noEntry + hasNeither + hasQtyNoName
  console.log(`\n--- Summary ---`)
  console.log(`Would fail products_sold check (before order_items fallback): ${wouldFail} (${(wouldFail/shipmentIds.length*100).toFixed(1)}%)`)
  console.log(`Note: B2B and manual orders are EXCLUDED from this check`)
}

main().catch(console.error)
