#!/usr/bin/env node
/**
 * Debug preflight validation to find the exact failing shipment
 * This replicates the exact logic from lib/billing/preflight-validation.ts
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  console.log('='.repeat(80))
  console.log('DEBUG PREFLIGHT VALIDATION FOR HENSON')
  console.log('='.repeat(80))

  // Step 1: Get unprocessed invoices (exactly like preflight API)
  const { data: unprocessedInvoices } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_date')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  const invoiceIds = unprocessedInvoices
    ?.map(inv => parseInt(inv.shipbob_invoice_id, 10))
    .filter(id => !isNaN(id)) || []

  console.log('\n1. UNPROCESSED INVOICES:')
  console.log(`   Count: ${invoiceIds.length}`)
  console.log(`   IDs: ${invoiceIds.join(', ')}`)
  console.log(`   Dates: ${unprocessedInvoices?.map(i => i.invoice_date).join(', ')}`)

  // Step 2: Get shipping transactions for Henson (exactly like preflight-validation.ts)
  console.log('\n2. SHIPPING TRANSACTIONS:')
  const shippingTransactions = []
  let shippingOffset = 0
  let hasMoreShipping = true

  while (hasMoreShipping) {
    const { data: batch, error } = await supabase
      .from('transactions')
      .select('id, reference_id, base_cost, surcharge, tracking_id')
      .eq('client_id', HENSON_ID)
      .eq('fee_type', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', invoiceIds)
      .range(shippingOffset, shippingOffset + 999)

    if (error) {
      console.log(`   ERROR: ${error.message}`)
      break
    }

    if (batch && batch.length > 0) {
      shippingTransactions.push(...batch)
      shippingOffset += batch.length
      hasMoreShipping = batch.length === 1000
    } else {
      hasMoreShipping = false
    }
  }

  console.log(`   Found: ${shippingTransactions.length} shipping transactions`)

  const shipmentIds = shippingTransactions
    .filter(tx => tx.reference_id)
    .map(tx => tx.reference_id)

  console.log(`   Unique shipment IDs: ${shipmentIds.length}`)

  if (shipmentIds.length === 0) {
    console.log('\n   No shipments found! Checking transactions table structure...')

    // Debug: Check what columns exist
    const { data: sample } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', HENSON_ID)
      .eq('fee_type', 'Shipping')
      .limit(1)

    if (sample?.[0]) {
      console.log('   Sample transaction columns:', Object.keys(sample[0]).join(', '))
      console.log('   Sample invoice_id_sb:', sample[0].invoice_id_sb)
    }

    // Check if any transactions exist for these invoices
    const { data: anyTx, count: txCount } = await supabase
      .from('transactions')
      .select('invoice_id_sb, fee_type', { count: 'exact' })
      .eq('client_id', HENSON_ID)
      .in('invoice_id_sb', invoiceIds)
      .limit(5)

    console.log(`   Transactions for these invoices: ${txCount}`)
    if (anyTx?.length) {
      for (const tx of anyTx) {
        console.log(`     - invoice_id_sb: ${tx.invoice_id_sb}, fee_type: ${tx.fee_type}`)
      }
    }

    // Check what invoice_id_sb values exist for Henson
    const { data: invoiceSample } = await supabase
      .from('transactions')
      .select('invoice_id_sb')
      .eq('client_id', HENSON_ID)
      .not('invoice_id_sb', 'is', null)
      .limit(10)

    console.log('   Sample invoice_id_sb values for Henson:')
    if (invoiceSample?.length) {
      const uniqueIds = [...new Set(invoiceSample.map(t => t.invoice_id_sb))]
      console.log(`     ${uniqueIds.join(', ')}`)
    }
    return
  }

  // Step 3: Get shipments data
  console.log('\n3. SHIPMENTS DATA:')
  let shipmentsData = []
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const { data } = await supabase
      .from('shipments')
      .select(`
        shipment_id, tracking_id, carrier, carrier_service,
        zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
        length, width, height, event_labeled, event_created, fc_name, order_id
      `)
      .eq('client_id', HENSON_ID)
      .in('shipment_id', shipmentIds.slice(i, i + 500))

    if (data) shipmentsData.push(...data)
  }
  console.log(`   Found: ${shipmentsData.length} shipments`)

  // Step 4: Get shipment_items
  console.log('\n4. SHIPMENT_ITEMS:')
  let shipmentItemsData = []
  for (let i = 0; i < shipmentIds.length; i += 200) {
    const { data } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .eq('client_id', HENSON_ID)
      .in('shipment_id', shipmentIds.slice(i, i + 200))
      .limit(2000)

    if (data) shipmentItemsData.push(...data)
  }
  console.log(`   Found: ${shipmentItemsData.length} items`)

  // Build shipment_items lookup
  const shipmentItemsMap = new Map()
  for (const item of shipmentItemsData) {
    const sid = String(item.shipment_id)
    const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
    if (item.name) existing.hasName = true
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    shipmentItemsMap.set(sid, existing)
  }

  // Step 5: Get orders data
  console.log('\n5. ORDERS DATA:')
  const orderIds = [...new Set(shipmentsData.map(s => s.order_id).filter(Boolean))]
  let ordersData = []
  for (let i = 0; i < orderIds.length; i += 50) {
    const { data } = await supabase
      .from('orders')
      .select('id, customer_name, zip_code, city, state, country, store_order_id, channel_name, order_type')
      .in('id', orderIds.slice(i, i + 50))

    if (data) ordersData.push(...data)
  }
  console.log(`   Found: ${ordersData.length} orders`)
  const orderDataMap = new Map(ordersData.map(o => [String(o.id), o]))

  // Step 6: Get order_items fallback
  console.log('\n6. ORDER_ITEMS FALLBACK:')
  const shipmentToOrderMap = new Map(shipmentsData.map(s => [String(s.shipment_id), String(s.order_id)]))
  const shipmentsMissingQty = [...shipmentItemsMap.entries()]
    .filter(([, v]) => v.hasName && !v.hasQuantity)
    .map(([sid]) => sid)

  console.log(`   Shipments missing quantity (but have name): ${shipmentsMissingQty.length}`)

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

    // Update with fallback
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
    console.log(`   Applied fallback from order_items`)
  }

  // Step 7: Calculate withProductsSold (THE KEY CHECK)
  console.log('\n7. PRODUCTS_SOLD VALIDATION:')
  const failingShipments = []

  for (const s of shipmentsData) {
    const sid = String(s.shipment_id)
    const items = shipmentItemsMap.get(sid)
    const order = orderDataMap.get(String(s.order_id))

    // B2B orders - skip
    if (order?.order_type === 'B2B') continue

    // Manual orders - skip
    const isManualOrder = !order?.store_order_id &&
      (!order?.channel_name || order.channel_name === 'ShipBob Default' || order.channel_name === 'N/A')
    if (isManualOrder) continue

    // Normal order: require both name and quantity
    if (!items?.hasName || !items?.hasQuantity) {
      failingShipments.push({
        shipment_id: s.shipment_id,
        order_id: s.order_id,
        hasName: items?.hasName || false,
        hasQuantity: items?.hasQuantity || false,
        order_type: order?.order_type,
        channel_name: order?.channel_name,
        store_order_id: order?.store_order_id
      })
    }
  }

  const passingCount = shipmentsData.length - failingShipments.length
  console.log(`   Total shipments: ${shipmentsData.length}`)
  console.log(`   Passing: ${passingCount}`)
  console.log(`   FAILING: ${failingShipments.length}`)

  if (failingShipments.length > 0) {
    console.log('\n' + '='.repeat(80))
    console.log('FAILING SHIPMENTS:')
    console.log('='.repeat(80))

    for (const f of failingShipments.slice(0, 20)) {
      console.log(`\n  Shipment: ${f.shipment_id}`)
      console.log(`    Order ID: ${f.order_id}`)
      console.log(`    Order Type: ${f.order_type || 'NULL'}`)
      console.log(`    Channel: ${f.channel_name || 'NULL'}`)
      console.log(`    Store Order ID: ${f.store_order_id || 'NULL'}`)
      console.log(`    Has Name: ${f.hasName}`)
      console.log(`    Has Quantity: ${f.hasQuantity}`)

      // Get actual items for this shipment
      const { data: items } = await supabase
        .from('shipment_items')
        .select('name, quantity, sku, shipbob_product_id')
        .eq('shipment_id', f.shipment_id)

      console.log(`    Items (${items?.length || 0}):`)
      for (const item of items || []) {
        console.log(`      - "${item.name}" qty=${item.quantity ?? 'NULL'} sku=${item.sku}`)
      }
    }

    if (failingShipments.length > 20) {
      console.log(`\n  ... and ${failingShipments.length - 20} more`)
    }
  }
}

main().catch(console.error)
