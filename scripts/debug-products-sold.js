#!/usr/bin/env node
/**
 * Debug why preflight shows 17% missing products_sold
 * Traces through the exact same logic as preflight-validation.ts
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
const CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad' // Henson

async function debug() {
  console.log('='.repeat(70))
  console.log('DEBUG: Products Sold Mismatch')
  console.log('='.repeat(70))

  // Step 1: Get shipping transactions (same as preflight)
  const shippingTransactions = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('id, reference_id, base_cost, surcharge, tracking_id')
      .eq('client_id', CLIENT_ID)
      .eq('transaction_fee', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', INVOICE_IDS)
      .range(offset, offset + 999)

    if (batch && batch.length > 0) {
      shippingTransactions.push(...batch)
      offset += batch.length
      hasMore = batch.length === 1000
    } else {
      hasMore = false
    }
  }

  console.log(`\n1. Shipping transactions: ${shippingTransactions.length}`)

  // Step 2: Extract shipment IDs
  const shipmentIds = shippingTransactions
    .filter(tx => tx.reference_id)
    .map(tx => tx.reference_id)

  console.log(`2. Shipment IDs from transactions: ${shipmentIds.length}`)
  console.log(`   Sample IDs: ${shipmentIds.slice(0, 5).join(', ')}`)

  // Step 3: Get shipments data (same as preflight)
  let shipmentsData = []
  if (shipmentIds.length > 0) {
    for (let i = 0; i < shipmentIds.length; i += 500) {
      const { data, error } = await supabase
        .from('shipments')
        .select(`
          shipment_id, tracking_id, carrier, carrier_service, ship_option_id,
          zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
          length, width, height, event_labeled, fc_name, order_id
        `)
        .eq('client_id', CLIENT_ID)
        .in('shipment_id', shipmentIds.slice(i, i + 500))

      if (error) {
        console.log(`   Error fetching shipments: ${error.message}`)
      }
      if (data) shipmentsData.push(...data)
    }
  }

  console.log(`3. Shipments data from shipments table: ${shipmentsData.length}`)

  // Step 4: Get shipment_items (FIXED - smaller batches + higher limit)
  let shipmentItemsData = []
  if (shipmentIds.length > 0) {
    for (let i = 0; i < shipmentIds.length; i += 200) {
      const { data, error } = await supabase
        .from('shipment_items')
        .select('shipment_id, name, quantity')
        .eq('client_id', CLIENT_ID)
        .in('shipment_id', shipmentIds.slice(i, i + 200))
        .limit(2000) // Override default 1000 limit

      if (error) {
        console.log(`   Error fetching items: ${error.message}`)
      }
      if (data) shipmentItemsData.push(...data)
    }
  }

  console.log(`4. Shipment items records: ${shipmentItemsData.length}`)

  // Step 5: Build the map (same as preflight)
  const shipmentItemsMap = new Map()
  for (const item of shipmentItemsData) {
    const sid = String(item.shipment_id)
    const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
    if (item.name) existing.hasName = true
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    shipmentItemsMap.set(sid, existing)
  }

  console.log(`5. Unique shipment IDs in items map: ${shipmentItemsMap.size}`)

  // Step 6: Count withProductsSold (same as preflight)
  const withProductsSold = [...shipmentItemsMap.values()].filter(v => v.hasName && v.hasQuantity).length

  console.log(`6. With products_sold (hasName AND hasQuantity): ${withProductsSold}`)

  // Step 7: The comparison
  console.log('\n' + '─'.repeat(70))
  console.log('COMPARISON (what preflight does):')
  console.log(`   total (shipmentsData.length): ${shipmentsData.length}`)
  console.log(`   withProductsSold: ${withProductsSold}`)
  console.log(`   MISSING: ${shipmentsData.length - withProductsSold} (${Math.round((1 - withProductsSold/shipmentsData.length)*100)}%)`)

  // Debug: Find shipments that are in shipmentsData but NOT in shipmentItemsMap
  const shipmentsWithoutItems = shipmentsData.filter(s => !shipmentItemsMap.has(String(s.shipment_id)))
  console.log(`\n   Shipments WITHOUT any items: ${shipmentsWithoutItems.length}`)
  if (shipmentsWithoutItems.length > 0) {
    console.log(`   Sample missing: ${shipmentsWithoutItems.slice(0, 5).map(s => s.shipment_id).join(', ')}`)
  }

  // Check: are there items with hasName but not hasQuantity?
  const hasNameNoQty = [...shipmentItemsMap.values()].filter(v => v.hasName && !v.hasQuantity).length
  const hasQtyNoName = [...shipmentItemsMap.values()].filter(v => !v.hasName && v.hasQuantity).length
  const hasBoth = [...shipmentItemsMap.values()].filter(v => v.hasName && v.hasQuantity).length
  const hasNeither = [...shipmentItemsMap.values()].filter(v => !v.hasName && !v.hasQuantity).length

  console.log(`\n   Items breakdown:`)
  console.log(`     hasName AND hasQuantity: ${hasBoth}`)
  console.log(`     hasName but NO quantity: ${hasNameNoQty}`)
  console.log(`     hasQuantity but NO name: ${hasQtyNoName}`)
  console.log(`     neither: ${hasNeither}`)

  // Double check: query DB directly for shipments missing items
  console.log('\n' + '─'.repeat(70))
  console.log('DIRECT DB CHECK:')

  // Get count of shipments with items
  const { data: withItemsCheck } = await supabase
    .from('shipment_items')
    .select('shipment_id')
    .eq('client_id', CLIENT_ID)
    .in('shipment_id', shipmentIds)

  const uniqueShipmentIdsWithItems = new Set(withItemsCheck?.map(i => i.shipment_id) || [])
  console.log(`   Shipments with at least one item record: ${uniqueShipmentIdsWithItems.size}`)

  // Find shipment IDs that are in shipmentsData but not in items
  const missingIds = shipmentsData
    .map(s => s.shipment_id)
    .filter(id => !uniqueShipmentIdsWithItems.has(id))

  console.log(`   Shipment IDs with NO items at all: ${missingIds.length}`)
  if (missingIds.length > 0) {
    console.log(`   Sample: ${missingIds.slice(0, 10).join(', ')}`)

    // Query these specific IDs to see if they really have no items
    const { data: checkMissing, error } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .in('shipment_id', missingIds.slice(0, 10))

    console.log(`   Double-check query result: ${checkMissing?.length || 0} items found`)
    if (checkMissing && checkMissing.length > 0) {
      console.log(`   Items found: ${JSON.stringify(checkMissing.slice(0, 3))}`)
    }
  }
}

debug().catch(console.error)
