#!/usr/bin/env node
/**
 * Test GET /invoices/{id}/transactions with:
 * - PageSize=1000 (maximum)
 * - Both SortOrder options (Ascending/Descending)
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchAllTransactions(invoiceId, sortOrder) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Invoice #${invoiceId} - SortOrder: ${sortOrder}`)
  console.log('═'.repeat(60))

  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?PageSize=1000&SortOrder=${sortOrder}`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
    })

    if (!response.ok) {
      console.log(`Page ${pageNum}: ERROR ${response.status}`)
      break
    }

    const data = await response.json()
    const items = data.items || []

    let newCount = 0
    let dupeCount = 0
    for (const t of items) {
      if (seenIds.has(t.transaction_id)) {
        dupeCount++
      } else {
        seenIds.add(t.transaction_id)
        allItems.push(t)
        newCount++
      }
    }

    console.log(`Page ${pageNum}: ${items.length} items (${newCount} new, ${dupeCount} dupes)`)

    cursor = data.next || null

    // Safety limit
    if (pageNum >= 20) break
  } while (cursor)

  // Results
  const total = allItems.reduce((sum, t) => sum + t.amount, 0)
  const dates = allItems.map(t => t.charge_date).filter(Boolean).sort()
  const uniqueDates = [...new Set(dates)]

  console.log(`\nResults:`)
  console.log(`  Total unique transactions: ${allItems.length}`)
  console.log(`  Total amount: $${total.toFixed(2)}`)
  console.log(`  Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)

  return { items: allItems, total, dates: uniqueDates }
}

async function main() {
  console.log('Testing GET /invoices/{id}/transactions with max PageSize\n')

  const invoiceId = 8633612 // Dec 1 invoice

  // Test both sort orders
  const descResult = await fetchAllTransactions(invoiceId, 'Descending')
  const ascResult = await fetchAllTransactions(invoiceId, 'Ascending')

  console.log(`\n${'═'.repeat(60)}`)
  console.log('COMPARISON')
  console.log('═'.repeat(60))
  console.log(`Expected invoice total: $11,127.61\n`)
  console.log(`Descending: ${descResult.items.length} txns, $${descResult.total.toFixed(2)}, dates: ${descResult.dates.join(', ')}`)
  console.log(`Ascending:  ${ascResult.items.length} txns, $${ascResult.total.toFixed(2)}, dates: ${ascResult.dates.join(', ')}`)

  // Check if different transactions were returned
  const descIds = new Set(descResult.items.map(t => t.transaction_id))
  const ascIds = new Set(ascResult.items.map(t => t.transaction_id))

  const onlyInDesc = descResult.items.filter(t => !ascIds.has(t.transaction_id))
  const onlyInAsc = ascResult.items.filter(t => !descIds.has(t.transaction_id))

  if (onlyInDesc.length > 0 || onlyInAsc.length > 0) {
    console.log(`\n⚠️ Different transactions returned by sort order!`)
    console.log(`  Only in Descending: ${onlyInDesc.length}`)
    console.log(`  Only in Ascending: ${onlyInAsc.length}`)
  } else {
    console.log(`\n✅ Both sort orders return same transactions`)
  }

  // Gap analysis
  const gap = 11127.61 - descResult.total
  console.log(`\nGap from expected: $${gap.toFixed(2)} (${(gap / 11127.61 * 100).toFixed(1)}%)`)
  console.log(`Missing dates: Nov 24, 25, 26 (before 7-day window)`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
