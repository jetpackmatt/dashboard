#!/usr/bin/env node
/**
 * Find shipments that exist in transactions but not in shipments table
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

  console.log('Finding orphan shipments (in transactions but not in shipments table)...\n')

  // Get all shipment IDs from transactions
  let allTx = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('reference_id, transaction_date, created_at')
      .eq('client_id', hensonClientId)
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += 1000
  }

  const txMap = new Map()
  for (const tx of allTx) {
    txMap.set(tx.reference_id, tx)
  }
  const txShipmentIds = [...txMap.keys()]
  console.log(`Total shipments in transactions: ${txShipmentIds.length}`)

  // Get shipment_ids that exist in shipments table
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
  console.log(`Orphan shipments (in tx, not in shipments): ${orphanIds.length}\n`)

  if (orphanIds.length > 0) {
    // Show sample orphan shipments with their transaction info
    console.log('--- Sample orphan shipments ---')
    for (const sid of orphanIds.slice(0, 20)) {
      const tx = txMap.get(sid)
      console.log(`  ${sid}: tx_date=${tx.transaction_date?.split('T')[0]}, synced=${tx.created_at}`)
    }

    // Group by transaction date
    console.log('\n--- Orphans by transaction date ---')
    const byDate = {}
    for (const sid of orphanIds) {
      const tx = txMap.get(sid)
      const date = tx.transaction_date?.split('T')[0] || 'unknown'
      byDate[date] = (byDate[date] || 0) + 1
    }
    Object.entries(byDate)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([date, count]) => console.log(`  ${date}: ${count}`))

    // Export orphan IDs for sync
    console.log('\n--- Orphan shipment IDs (for manual sync) ---')
    console.log(orphanIds.slice(0, 50).join('\n'))
  }
}

main().catch(console.error)
