#!/usr/bin/env node
/**
 * Final comprehensive strategy: ALL filters × ALL sort orders
 * Try to maximize Dec 2-3 coverage
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params) {
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

    if (!response.ok) return []

    const data = await response.json()
    for (const t of (data.items || [])) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
      }
    }

    cursor = data.next || null
    if (pageNum >= 20) break
    if ((data.items || []).every(t => seenIds.has(t.transaction_id))) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('Final comprehensive pending transaction strategy\n')
  console.log('═'.repeat(70))

  const masterMap = new Map()
  const SORT_ORDERS = ['Ascending', 'Descending']
  const TX_TYPES = ['Charge', 'Credit', 'Payment', 'Adjustment']
  const REF_TYPES = ['Shipment', 'Default', 'WRO', 'Return']
  const INV_TYPES = ['Shipping', 'AdditionalFee', 'WarehouseStorage', 'ReturnsFee', 'Credits']

  let queryCount = 0
  const startTime = Date.now()

  // Round 1: Basic combos
  console.log('Round 1: Basic + sort_order')
  for (const sort of SORT_ORDERS) {
    const items = await queryTransactions({ invoiced_status: false, sort_order: sort })
    queryCount++
    for (const t of items) masterMap.set(t.transaction_id, t)
  }
  console.log(`  After Round 1: ${masterMap.size} unique`)

  // Round 2: Transaction types
  console.log('Round 2: TX types × sort_order')
  for (const tx of TX_TYPES) {
    for (const sort of SORT_ORDERS) {
      const items = await queryTransactions({ transaction_types: [tx], invoiced_status: false, sort_order: sort })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
    }
  }
  console.log(`  After Round 2: ${masterMap.size} unique`)

  // Round 3: Reference types
  console.log('Round 3: Ref types × sort_order')
  for (const ref of REF_TYPES) {
    for (const sort of SORT_ORDERS) {
      const items = await queryTransactions({ reference_types: [ref], invoiced_status: false, sort_order: sort })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
    }
  }
  console.log(`  After Round 3: ${masterMap.size} unique`)

  // Round 4: Invoice types (NEW!)
  console.log('Round 4: Invoice types × sort_order')
  for (const inv of INV_TYPES) {
    for (const sort of SORT_ORDERS) {
      const items = await queryTransactions({ invoice_types: [inv], invoiced_status: false, sort_order: sort })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
    }
  }
  console.log(`  After Round 4: ${masterMap.size} unique`)

  // Round 5: TX type × Ref type × sort
  console.log('Round 5: TX × Ref × sort_order')
  for (const tx of TX_TYPES) {
    for (const ref of REF_TYPES) {
      for (const sort of SORT_ORDERS) {
        const items = await queryTransactions({
          transaction_types: [tx],
          reference_types: [ref],
          invoiced_status: false,
          sort_order: sort
        })
        queryCount++
        for (const t of items) masterMap.set(t.transaction_id, t)
      }
    }
  }
  console.log(`  After Round 5: ${masterMap.size} unique`)

  // Round 6: TX type × Invoice type × sort
  console.log('Round 6: TX × InvType × sort_order')
  for (const tx of ['Charge', 'Credit']) { // Main types only
    for (const inv of INV_TYPES) {
      for (const sort of SORT_ORDERS) {
        const items = await queryTransactions({
          transaction_types: [tx],
          invoice_types: [inv],
          invoiced_status: false,
          sort_order: sort
        })
        queryCount++
        for (const t of items) masterMap.set(t.transaction_id, t)
      }
    }
  }
  console.log(`  After Round 6: ${masterMap.size} unique`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const transactions = [...masterMap.values()]

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log('FINAL RESULTS')
  console.log('═'.repeat(70))

  console.log(`\nTotal unique PENDING: ${transactions.length}`)
  console.log(`Queries: ${queryCount}`)
  console.log(`Time: ${elapsed}s`)

  // By date
  const byDate = {}
  for (const t of transactions) {
    const d = t.charge_date || 'null'
    byDate[d] = (byDate[d] || 0) + 1
  }

  console.log('\nBy date:')
  for (const [d, c] of Object.entries(byDate).sort()) {
    const bar = '█'.repeat(Math.ceil(c / 20))
    console.log(`  ${d}: ${c.toString().padStart(4)} ${bar}`)
  }

  // Total amount
  const total = transactions.reduce((sum, t) => sum + t.amount, 0)
  console.log(`\nTotal: $${total.toFixed(2)}`)

  // Compare to expected
  const daysCount = Object.keys(byDate).length
  const expectedPerDay = 370
  const expected = daysCount * expectedPerDay

  console.log(`\nExpected (~${expectedPerDay}/day × ${daysCount} days): ~${expected}`)
  console.log(`Retrieved: ${transactions.length}`)
  console.log(`Coverage: ${((transactions.length / expected) * 100).toFixed(0)}%`)

  // Dec 2-3 specifically
  const dec2 = byDate['2025-12-02'] || 0
  const dec3 = byDate['2025-12-03'] || 0
  console.log(`\nDec 2-3 specifically:`)
  console.log(`  Dec 2: ${dec2} (${((dec2 / expectedPerDay) * 100).toFixed(0)}% of expected)`)
  console.log(`  Dec 3: ${dec3} (${((dec3 / expectedPerDay) * 100).toFixed(0)}% of expected)`)

  console.log('\n' + '═'.repeat(70))
  console.log('CONCLUSION')
  console.log('═'.repeat(70))

  if (dec2 < 50 || dec3 < 50) {
    console.log(`
⚠️ API LIMITATION CONFIRMED

The POST /transactions:query endpoint cannot reliably access transactions
from "middle" dates. It strongly biases toward:
- Oldest pending (via sort_order: Ascending)
- Newest pending (via sort_order: Descending)

WORKAROUND OPTIONS:
1. Run sync every 5-10 minutes to capture new transactions immediately
2. Use Excel export from ShipBob dashboard as fallback
3. On Monday, use GET /invoices/{id}/transactions to reconcile

The workflow should be:
- CONTINUOUS: Sync every 5-10 min, capture what we can, store in DB
- MONDAY: Fetch invoices, use GET endpoint to get ALL invoice transactions
- VERIFY: Match against what we captured, flag discrepancies
`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
