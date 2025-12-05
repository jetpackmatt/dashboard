#!/usr/bin/env node
/**
 * Test if combining sort_order with filters gets us all pending transactions
 * Ascending = oldest first, Descending = newest first
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
    if (pageNum >= 30) break
    if ((data.items || []).every(t => seenIds.has(t.transaction_id))) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('Testing sort_order strategy for comprehensive pending sync\n')
  console.log('═'.repeat(70))

  const masterMap = new Map()
  const SORT_ORDERS = ['Ascending', 'Descending']
  const TX_TYPES = ['Charge', 'Credit', 'Payment']
  const REF_TYPES = ['Shipment', 'Default', 'WRO', 'Return']

  let queryCount = 0
  const startTime = Date.now()

  // Strategy: Query each filter combo with BOTH sort orders
  console.log('\nPhase 1: Pending + sort_order')
  for (const sort of SORT_ORDERS) {
    const items = await queryTransactions({ invoiced_status: false, sort_order: sort })
    queryCount++
    for (const t of items) masterMap.set(t.transaction_id, t)
    console.log(`  Pending + ${sort}: ${items.length}`)
  }
  console.log(`  Unique so far: ${masterMap.size}`)

  console.log('\nPhase 2: Transaction types + sort_order')
  for (const tx of TX_TYPES) {
    for (const sort of SORT_ORDERS) {
      const items = await queryTransactions({
        transaction_types: [tx],
        invoiced_status: false,
        sort_order: sort
      })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
    }
  }
  console.log(`  Unique so far: ${masterMap.size}`)

  console.log('\nPhase 3: Reference types + sort_order')
  for (const ref of REF_TYPES) {
    for (const sort of SORT_ORDERS) {
      const items = await queryTransactions({
        reference_types: [ref],
        invoiced_status: false,
        sort_order: sort
      })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
    }
  }
  console.log(`  Unique so far: ${masterMap.size}`)

  console.log('\nPhase 4: TX type + Ref type + sort_order')
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
  console.log(`  Unique so far: ${masterMap.size}`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const transactions = [...masterMap.values()]

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log('RESULTS')
  console.log('═'.repeat(70))

  console.log(`\nTotal unique PENDING transactions: ${transactions.length}`)
  console.log(`Queries made: ${queryCount}`)
  console.log(`Time: ${elapsed}s`)

  // By date
  const byDate = {}
  for (const t of transactions) {
    const d = t.charge_date || 'null'
    byDate[d] = (byDate[d] || 0) + 1
  }

  console.log('\nBy charge_date:')
  let totalExpected = 0
  for (const [d, c] of Object.entries(byDate).sort()) {
    // Estimate: ~370/day expected
    const expected = 370
    totalExpected += expected
    const pct = ((c / expected) * 100).toFixed(0)
    console.log(`  ${d}: ${c} (${pct}% of ~${expected} expected)`)
  }

  // Total amount
  const total = transactions.reduce((sum, t) => sum + t.amount, 0)
  console.log(`\nTotal amount: $${total.toFixed(2)}`)

  console.log('\n' + '═'.repeat(70))
  console.log('EFFECTIVENESS')
  console.log('═'.repeat(70))
  console.log(`Expected pending (Dec 1-4, ~370/day × 4): ~1480`)
  console.log(`Retrieved: ${transactions.length}`)
  console.log(`Gap: ${1480 - transactions.length} (${((1480 - transactions.length) / 1480 * 100).toFixed(0)}% missing)`)

  if (transactions.length >= 1000) {
    console.log(`\n✅ Sort order strategy significantly improved retrieval!`)
  } else {
    console.log(`\n⚠️ Still missing many transactions - may need Excel import fallback`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
