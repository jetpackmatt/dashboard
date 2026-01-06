#!/usr/bin/env node
/**
 * Investigate why 485 shipments are missing shipment_items
 * Dec 8-14 period for Henson
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

  console.log('Investigating 485 shipments missing from shipment_items...\n')

  // Step 1: Get all shipment IDs from transactions
  let allTxShipments = []
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
    allTxShipments.push(...data)
    offset += 1000
  }

  const txShipmentIds = [...new Set(allTxShipments.map(t => t.reference_id))]
  console.log(`Total shipments in transactions: ${txShipmentIds.length}`)

  // Step 2: Get shipment_items
  let allItems = []
  for (let i = 0; i < txShipmentIds.length; i += 400) {
    const batch = txShipmentIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipment_items')
      .select('shipment_id')
      .in('shipment_id', batch)
    if (data) allItems.push(...data)
  }

  const shipmentsWithItems = new Set(allItems.map(i => String(i.shipment_id)))
  const missingFromItems = txShipmentIds.filter(sid => !shipmentsWithItems.has(sid))

  console.log(`Shipments with items: ${shipmentsWithItems.size}`)
  console.log(`Missing from shipment_items: ${missingFromItems.length}\n`)

  // Step 3: Check if these missing shipments exist in shipments table
  console.log('--- Checking if missing shipments exist in shipments table ---')

  let foundInShipments = 0
  let notFoundInShipments = 0
  const sampleMissing = []

  for (let i = 0; i < missingFromItems.length; i += 400) {
    const batch = missingFromItems.slice(i, i + 400)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, created_date, status')
      .in('shipment_id', batch)

    if (shipments) {
      foundInShipments += shipments.length
      if (sampleMissing.length < 10) {
        sampleMissing.push(...shipments.slice(0, 10 - sampleMissing.length))
      }
    }
    notFoundInShipments += batch.length - (shipments?.length || 0)
  }

  console.log(`Found in shipments table: ${foundInShipments}`)
  console.log(`NOT in shipments table: ${notFoundInShipments}`)

  // Step 4: For found shipments, check their orders and order_items
  if (sampleMissing.length > 0) {
    console.log('\n--- Sample shipments missing items ---')
    for (const s of sampleMissing.slice(0, 5)) {
      console.log(`\nShipment ${s.shipment_id}:`)
      console.log(`  created_date: ${s.created_date}`)
      console.log(`  status: ${s.status}`)
      console.log(`  order_id: ${s.order_id}`)

      // Check order
      const { data: order } = await supabase
        .from('orders')
        .select('shipbob_order_id, order_type, channel_name, created_date')
        .eq('id', s.order_id)
        .single()

      if (order) {
        console.log(`  order: shipbob_order_id=${order.shipbob_order_id}, type=${order.order_type}, channel=${order.channel_name}`)
        console.log(`  order created: ${order.created_date}`)
      } else {
        console.log(`  order: NOT FOUND`)
      }

      // Check order_items
      const { data: items, count } = await supabase
        .from('order_items')
        .select('*', { count: 'exact' })
        .eq('order_id', s.order_id)
        .limit(3)

      console.log(`  order_items count: ${count || 0}`)
      if (items && items.length > 0) {
        for (const item of items) {
          console.log(`    - name: ${item.name}, qty: ${item.quantity}, sku: ${item.sku}`)
        }
      }
    }
  }

  // Step 5: Check created_date distribution of missing shipments
  console.log('\n--- Created date distribution of missing shipments ---')

  let byDate = {}
  for (let i = 0; i < missingFromItems.length; i += 400) {
    const batch = missingFromItems.slice(i, i + 400)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('created_date')
      .in('shipment_id', batch)

    for (const s of (shipments || [])) {
      const date = s.created_date?.split('T')[0] || 'unknown'
      byDate[date] = (byDate[date] || 0) + 1
    }
  }

  const sortedDates = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]))
  for (const [date, count] of sortedDates.slice(0, 10)) {
    console.log(`  ${date}: ${count} shipments`)
  }

  // Step 6: Check if these are recently synced
  console.log('\n--- Sync timing analysis ---')

  const recentShipmentIds = missingFromItems.slice(0, 50)
  const { data: recentShipments } = await supabase
    .from('shipments')
    .select('shipment_id, created_date, synced_at')
    .in('shipment_id', recentShipmentIds)
    .order('synced_at', { ascending: false })
    .limit(10)

  if (recentShipments) {
    for (const s of recentShipments) {
      console.log(`  ${s.shipment_id}: created ${s.created_date?.split('T')[0]}, synced ${s.synced_at}`)
    }
  }
}

main().catch(console.error)
