#!/usr/bin/env node
/**
 * Test more filter combinations based on actual data types found
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params, description) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${description}`)

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

    if (!response.ok) {
      const text = await response.text()
      console.log(`  ERROR ${response.status}: ${text.substring(0, 100)}`)
      return { items: [], error: response.status }
    }

    const data = await response.json()
    const items = data.items || []

    let newCount = 0
    for (const t of items) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
        newCount++
      }
    }

    if (pageNum <= 3) {
      console.log(`  Page ${pageNum}: ${items.length} items (${newCount} new)`)
    }

    cursor = data.next || null
    if (pageNum >= 20 || (items.length > 0 && newCount === 0)) break
  } while (cursor)

  const total = allItems.reduce((sum, t) => sum + t.amount, 0)
  console.log(`  → ${allItems.length} unique, $${total.toFixed(2)}`)

  return { items: allItems, total }
}

async function main() {
  console.log('Testing filter combinations to maximize pending transaction retrieval\n')
  console.log('═'.repeat(60))

  // Collect all results
  const results = {}

  // 1. Test each transaction type separately
  console.log('\n📊 BY TRANSACTION TYPE:')
  results.charge = await queryTransactions({ transaction_types: ['Charge'] }, 'Charge only')
  results.credit = await queryTransactions({ transaction_types: ['Credit'] }, 'Credit only')
  results.refund = await queryTransactions({ transaction_types: ['Refund'] }, 'Refund only')

  // 2. Test each reference type separately
  console.log('\n📊 BY REFERENCE TYPE:')
  results.shipment = await queryTransactions({ reference_types: ['Shipment'] }, 'Shipment refs')
  results.default = await queryTransactions({ reference_types: ['Default'] }, 'Default refs')
  results.wro = await queryTransactions({ reference_types: ['WRO'] }, 'WRO refs')
  results.fcTransfer = await queryTransactions({ reference_types: ['FC Transfer'] }, 'FC Transfer refs')
  results.ticketNumber = await queryTransactions({ reference_types: ['TicketNumber'] }, 'TicketNumber refs')

  // 3. Test date ranges - go back further
  console.log('\n📊 BY DATE RANGE:')
  const ranges = [
    { start: '2025-12-04', end: '2025-12-04', label: 'Dec 4 only' },
    { start: '2025-12-03', end: '2025-12-03', label: 'Dec 3 only' },
    { start: '2025-12-02', end: '2025-12-02', label: 'Dec 2 only' },
    { start: '2025-12-01', end: '2025-12-01', label: 'Dec 1 only' },
    { start: '2025-11-30', end: '2025-11-30', label: 'Nov 30 only' },
    { start: '2025-11-27', end: '2025-11-27', label: 'Nov 27 only' },
  ]

  for (const r of ranges) {
    results[r.label] = await queryTransactions(
      { start_date: r.start, end_date: r.end },
      r.label
    )
  }

  // 4. Combine type + reference
  console.log('\n📊 COMBINED FILTERS:')
  results.chargeShipment = await queryTransactions(
    { transaction_types: ['Charge'], reference_types: ['Shipment'] },
    'Charge + Shipment'
  )
  results.creditDefault = await queryTransactions(
    { transaction_types: ['Credit'], reference_types: ['Default'] },
    'Credit + Default'
  )

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY - UNIQUE TRANSACTION COUNTS')
  console.log('═'.repeat(60))

  // Merge all unique transactions
  const allUnique = new Map()
  for (const [key, result] of Object.entries(results)) {
    if (result.items) {
      for (const t of result.items) {
        if (!allUnique.has(t.transaction_id)) {
          allUnique.set(t.transaction_id, t)
        }
      }
    }
  }

  const mergedTotal = [...allUnique.values()].reduce((sum, t) => sum + t.amount, 0)
  console.log(`\nTotal unique transactions across ALL filters: ${allUnique.size}`)
  console.log(`Total amount: $${mergedTotal.toFixed(2)}`)

  // If merging got us more than any single query, filters help!
  const maxSingle = Math.max(...Object.values(results).map(r => r.items?.length || 0))
  if (allUnique.size > maxSingle) {
    console.log(`\n✅ FILTER STRATEGY WORKS!`)
    console.log(`Single query max: ${maxSingle}`)
    console.log(`Combined unique: ${allUnique.size}`)
    console.log(`Improvement: +${allUnique.size - maxSingle} transactions`)
  } else {
    console.log(`\n⚠️ Filters don't help - all queries return same ${maxSingle} transactions`)
  }

  // Breakdown by reference type and transaction type
  const byRefType = {}
  const byTxType = {}
  for (const t of allUnique.values()) {
    const ref = t.reference_type || 'unknown'
    const tx = t.transaction_type || 'unknown'
    byRefType[ref] = (byRefType[ref] || 0) + 1
    byTxType[tx] = (byTxType[tx] || 0) + 1
  }

  console.log('\nBy reference_type:')
  for (const [k, v] of Object.entries(byRefType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\nBy transaction_type:')
  for (const [k, v] of Object.entries(byTxType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
