#!/usr/bin/env node
/**
 * Identify orphan shipments (in transactions but not in shipments table)
 * for Dec 8-14 billing period
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

  console.log('Identifying orphan shipments for Dec 8-14 period (Henson)...\n')

  // Step 1: Get all shipment transactions for these invoices
  let allTx = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('reference_id, charge_date, total_charge')
      .eq('client_id', hensonClientId)
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += 1000
  }

  console.log(`Total shipping transactions: ${allTx.length}`)

  // Build map of shipment_id → transaction info
  const txMap = new Map()
  for (const tx of allTx) {
    txMap.set(tx.reference_id, tx)
  }
  const txShipmentIds = [...txMap.keys()]
  console.log(`Unique shipment IDs in transactions: ${txShipmentIds.length}`)

  // Step 2: Check which exist in shipments table
  let existingIds = new Set()
  for (let i = 0; i < txShipmentIds.length; i += 400) {
    const batch = txShipmentIds.slice(i, i + 400)
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id')
      .in('shipment_id', batch)
    if (data) data.forEach(s => existingIds.add(String(s.shipment_id)))
  }

  console.log(`Found in shipments table: ${existingIds.size}`)

  const orphanIds = txShipmentIds.filter(id => !existingIds.has(id))
  console.log(`Orphan shipments: ${orphanIds.length} (${(orphanIds.length / txShipmentIds.length * 100).toFixed(1)}%)`)

  if (orphanIds.length === 0) {
    console.log('\n✅ No orphan shipments found!')
    return
  }

  // Step 3: Analyze orphan shipments by charge_date
  console.log('\n--- Orphan shipments by charge_date ---')
  const byDate = {}
  for (const sid of orphanIds) {
    const tx = txMap.get(sid)
    const date = tx.charge_date || 'unknown'
    byDate[date] = (byDate[date] || 0) + 1
  }
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, count]) => console.log(`  ${date}: ${count}`))

  // Step 4: Show sample orphan shipment IDs
  console.log('\n--- Sample orphan shipment IDs (first 30) ---')
  console.log(orphanIds.slice(0, 30).join(', '))

  // Step 5: Calculate total value of orphan shipments
  let orphanTotal = 0
  for (const sid of orphanIds) {
    const tx = txMap.get(sid)
    orphanTotal += tx.total_charge || 0
  }
  console.log(`\n--- Orphan shipments total value: $${orphanTotal.toFixed(2)} ---`)
}

main().catch(console.error)
