#!/usr/bin/env node
/**
 * Check pending transactions breakdown by client/reference
 * to understand if we're seeing all clients combined
 */
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function check() {
  console.log('=== Analyzing Pending Transactions by Client ===\n')

  // Fetch pending transactions
  const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 1000 })
  })
  const data = await response.json()
  const pending = data.items || []

  console.log(`Total pending transactions: ${pending.length}`)
  console.log(`Total pending amount: $${pending.reduce((s, t) => s + t.amount, 0).toFixed(2)}\n`)

  // Group by reference_type
  console.log('By reference_type:')
  const byRefType = {}
  for (const tx of pending) {
    const rt = tx.reference_type || 'Unknown'
    if (!byRefType[rt]) byRefType[rt] = { count: 0, total: 0, refs: new Set() }
    byRefType[rt].count++
    byRefType[rt].total += tx.amount
    byRefType[rt].refs.add(tx.reference_id)
  }
  Object.entries(byRefType).forEach(([type, stats]) => {
    console.log(`  ${type.padEnd(15)}: ${stats.count.toString().padStart(4)} tx, ${stats.refs.size} unique refs, $${stats.total.toFixed(2)}`)
  })

  // Group by fulfillment_center (might indicate different clients)
  console.log('\nBy fulfillment_center:')
  const byFC = {}
  for (const tx of pending) {
    const fc = tx.fulfillment_center || 'Unknown'
    if (!byFC[fc]) byFC[fc] = { count: 0, total: 0 }
    byFC[fc].count++
    byFC[fc].total += tx.amount
  }
  Object.entries(byFC).forEach(([fc, stats]) => {
    console.log(`  ${fc.padEnd(25)}: ${stats.count.toString().padStart(4)} tx, $${stats.total.toFixed(2)}`)
  })

  // Group by transaction_fee type
  console.log('\nBy transaction_fee:')
  const byFee = {}
  for (const tx of pending) {
    const fee = tx.transaction_fee
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += tx.amount
  }
  Object.entries(byFee)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(30)}: ${stats.count.toString().padStart(4)} tx, $${stats.total.toFixed(2)}`)
    })

  // Count unique shipment references
  const shipmentRefs = pending.filter(t => t.reference_type === 'Shipment').map(t => t.reference_id)
  const uniqueShipments = new Set(shipmentRefs)
  console.log(`\nUnique Shipment reference_ids: ${uniqueShipments.size}`)

  // By charge_date
  console.log('\nBy charge_date:')
  const byDate = {}
  for (const tx of pending) {
    const d = tx.charge_date
    if (!byDate[d]) byDate[d] = { count: 0, total: 0, shipments: new Set() }
    byDate[d].count++
    byDate[d].total += tx.amount
    if (tx.reference_type === 'Shipment') byDate[d].shipments.add(tx.reference_id)
  }
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, stats]) => {
      console.log(`  ${date}: ${stats.count.toString().padStart(4)} tx, ${stats.shipments.size} shipments, $${stats.total.toFixed(2)}`)
    })

  // Show sample reference_ids to see if they look like they're from different clients
  console.log('\nSample reference_ids (first 10):')
  const sampleRefs = [...uniqueShipments].slice(0, 10)
  for (const ref of sampleRefs) {
    const txs = pending.filter(t => t.reference_id === ref)
    const fees = txs.map(t => t.transaction_fee).join(', ')
    const total = txs.reduce((s, t) => s + t.amount, 0)
    console.log(`  ${ref}: ${txs.length} tx (${fees}) = $${total.toFixed(2)}`)
  }
}

check().catch(console.error)
