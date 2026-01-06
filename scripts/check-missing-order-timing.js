#!/usr/bin/env node
/**
 * Check the sync timing of shipments whose orders are missing
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

  console.log('Checking sync timing of shipments with missing orders...\n')

  // Get shipments missing items
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

  // Get shipment details and their order_ids
  let shipments = []
  for (let i = 0; i < txShipmentIds.length; i += 400) {
    const batch = txShipmentIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, created_date, synced_at, status')
      .in('shipment_id', batch)
    if (data) shipments.push(...data)
  }

  // Find which shipment_items exist
  let hasItems = new Set()
  for (let i = 0; i < txShipmentIds.length; i += 400) {
    const batch = txShipmentIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipment_items')
      .select('shipment_id')
      .in('shipment_id', batch)
    if (data) data.forEach(si => hasItems.add(String(si.shipment_id)))
  }

  // Filter to shipments missing items
  const shipmentsWithMissingItems = shipments.filter(s => !hasItems.has(String(s.shipment_id)))
  console.log(`Shipments missing items: ${shipmentsWithMissingItems.length}`)

  // Check which orders exist
  const orderIds = [...new Set(shipmentsWithMissingItems.map(s => s.order_id).filter(Boolean))]
  let existingOrders = new Set()
  for (let i = 0; i < orderIds.length; i += 400) {
    const batch = orderIds.slice(i, i + 400)
    const { data } = await supabase
      .from('orders')
      .select('id')
      .in('id', batch)
    if (data) data.forEach(o => existingOrders.add(o.id))
  }

  // Separate shipments by order existence
  const shipmentsWithMissingOrders = shipmentsWithMissingItems.filter(s => !existingOrders.has(s.order_id))
  const shipmentsWithExistingOrders = shipmentsWithMissingItems.filter(s => existingOrders.has(s.order_id))

  console.log(`  - with missing orders: ${shipmentsWithMissingOrders.length}`)
  console.log(`  - with existing orders: ${shipmentsWithExistingOrders.length}`)

  // Analyze synced_at for shipments with missing orders
  console.log('\n=== Sync timing for shipments with MISSING orders ===')

  const bySyncDate = {}
  const byCreatedDate = {}
  for (const s of shipmentsWithMissingOrders) {
    const syncDate = s.synced_at?.split('T')[0] || 'null'
    const createdDate = s.created_date?.split('T')[0] || 'null'
    bySyncDate[syncDate] = (bySyncDate[syncDate] || 0) + 1
    byCreatedDate[createdDate] = (byCreatedDate[createdDate] || 0) + 1
  }

  console.log('\nBy synced_at:')
  Object.entries(bySyncDate).sort((a, b) => b[0].localeCompare(a[0])).forEach(([d, c]) => console.log(`  ${d}: ${c}`))

  console.log('\nBy created_date:')
  Object.entries(byCreatedDate).sort((a, b) => b[0].localeCompare(a[0])).forEach(([d, c]) => console.log(`  ${d}: ${c}`))

  // Sample shipments with missing orders
  console.log('\n=== Sample shipments with missing orders ===')
  const sample = shipmentsWithMissingOrders.slice(0, 10)
  for (const s of sample) {
    console.log(`\nShipment ${s.shipment_id}:`)
    console.log(`  order_id: ${s.order_id}`)
    console.log(`  status: ${s.status}`)
    console.log(`  created_date: ${s.created_date?.split('T')[0]}`)
    console.log(`  synced_at: ${s.synced_at}`)
  }

  // Check if the order_id format is a UUID or integer
  console.log('\n=== Order ID format check ===')
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const sampleOrderIds = shipmentsWithMissingOrders.slice(0, 20).map(s => s.order_id)
  let uuidCount = 0
  let intCount = 0
  for (const oid of sampleOrderIds) {
    if (uuidPattern.test(oid)) uuidCount++
    else intCount++
  }
  console.log(`  UUID format: ${uuidCount}`)
  console.log(`  Integer format: ${intCount}`)
  console.log(`  Sample order_ids: ${sampleOrderIds.slice(0, 5).join(', ')}`)
}

main().catch(console.error)
