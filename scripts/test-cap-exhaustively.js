#!/usr/bin/env node
/**
 * Exhaustively test the transaction cap by trying every combination
 * Goal: Find the true maximum we can retrieve
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryWithStats(params, label) {
  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    const body = { ...params, page_size: 250 }
    if (cursor) body.cursor = cursor

    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) return { items: [], label, error: response.status }

    const data = await response.json()
    const items = data.items || []

    for (const t of items) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
      }
    }

    cursor = data.next || null
    if (pageNum >= 30) break
    // Stop if all duplicates
    if (items.length > 0 && items.every(t => seenIds.has(t.transaction_id))) break
  } while (cursor)

  return { items: allItems, label }
}

async function main() {
  console.log('Exhaustively testing transaction retrieval caps\n')
  console.log('═'.repeat(70))

  const masterSet = new Map()
  const results = []

  // 1. All known transaction types
  const txTypes = ['Charge', 'Credit', 'Refund', 'Payment', 'Adjustment']
  for (const type of txTypes) {
    const result = await queryWithStats({ transaction_types: [type] }, `txType: ${type}`)
    results.push(result)
    console.log(`${result.label}: ${result.items.length}`)
    for (const t of result.items) masterSet.set(t.transaction_id, t)
  }

  console.log('')

  // 2. All known reference types
  const refTypes = ['Shipment', 'Default', 'WRO', 'FC Transfer', 'TicketNumber', 'Return', 'Storage']
  for (const type of refTypes) {
    const result = await queryWithStats({ reference_types: [type] }, `refType: ${type}`)
    results.push(result)
    console.log(`${result.label}: ${result.items.length}`)
    for (const t of result.items) masterSet.set(t.transaction_id, t)
  }

  console.log('')

  // 3. Check what invoice types exist in transactions
  const invoiceTypes = ['Shipping', 'AdditionalFee', 'WarehouseStorage', 'ReturnsFee', 'Credits', 'WarehouseInboundFee']
  for (const type of invoiceTypes) {
    const result = await queryWithStats({ invoice_types: [type] }, `invType: ${type}`)
    results.push(result)
    console.log(`${result.label}: ${result.items.length}`)
    for (const t of result.items) masterSet.set(t.transaction_id, t)
  }

  console.log('')

  // 4. Try invoiced_status filter
  const pendingResult = await queryWithStats({ invoiced_status: false }, 'pending only')
  results.push(pendingResult)
  console.log(`pending only: ${pendingResult.items.length}`)
  for (const t of pendingResult.items) masterSet.set(t.transaction_id, t)

  const invoicedResult = await queryWithStats({ invoiced_status: true }, 'invoiced only')
  results.push(invoicedResult)
  console.log(`invoiced only: ${invoicedResult.items.length}`)
  for (const t of invoicedResult.items) masterSet.set(t.transaction_id, t)

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log('SUMMARY')
  console.log('═'.repeat(70))

  console.log(`\nTotal unique transactions from ALL queries: ${masterSet.size}`)

  const masterTotal = [...masterSet.values()].reduce((sum, t) => sum + t.amount, 0)
  console.log(`Total amount: $${masterTotal.toFixed(2)}`)

  // Breakdown by type
  const byTxType = {}
  const byRefType = {}
  const byInvType = {}
  const byInvoiced = { pending: 0, invoiced: 0 }

  for (const t of masterSet.values()) {
    const tx = t.transaction_type || 'unknown'
    const ref = t.reference_type || 'unknown'
    const inv = t.invoice_type || 'unknown'

    byTxType[tx] = (byTxType[tx] || 0) + 1
    byRefType[ref] = (byRefType[ref] || 0) + 1
    byInvType[inv] = (byInvType[inv] || 0) + 1

    if (t.invoiced_status) byInvoiced.invoiced++
    else byInvoiced.pending++
  }

  console.log('\nBy transaction_type:')
  for (const [k, v] of Object.entries(byTxType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\nBy reference_type:')
  for (const [k, v] of Object.entries(byRefType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\nBy invoice_type:')
  for (const [k, v] of Object.entries(byInvType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\nBy invoiced_status:')
  console.log(`  pending: ${byInvoiced.pending}`)
  console.log(`  invoiced: ${byInvoiced.invoiced}`)

  // Check which filter gave us the most
  const sorted = results.filter(r => r.items.length > 0).sort((a, b) => b.items.length - a.items.length)
  console.log('\nTop 5 filters by count:')
  for (const r of sorted.slice(0, 5)) {
    console.log(`  ${r.label}: ${r.items.length}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
