#!/usr/bin/env node
/**
 * Full test of offset-based pagination
 * Using PageSize (not Limit) as that worked in the test
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function getAllWithOffset(invoiceId) {
  console.log(`\nFetching all transactions for invoice #${invoiceId} using offset pagination\n`)

  const allItems = []
  const seenIds = new Set()
  let offset = 0
  const pageSize = 250
  let pageNum = 0
  let duplicateCount = 0

  while (pageNum < 50) {  // Safety limit
    pageNum++

    const endpoint = `/2025-07/invoices/${invoiceId}/transactions?PageSize=${pageSize}&Offset=${offset}`

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
    })

    if (!response.ok) {
      console.log(`Page ${pageNum}: ERROR ${response.status}`)
      break
    }

    const data = await response.json()
    const items = data.items || []

    // Check for duplicates
    let newCount = 0
    let dupeCount = 0
    for (const t of items) {
      if (seenIds.has(t.transaction_id)) {
        dupeCount++
        duplicateCount++
      } else {
        seenIds.add(t.transaction_id)
        allItems.push(t)
        newCount++
      }
    }

    console.log(`Page ${pageNum} (offset=${offset}): ${items.length} items (${newCount} new, ${dupeCount} dupes)`)

    if (items.length === 0) {
      console.log('  No more items')
      break
    }

    // If all duplicates, we've wrapped around
    if (dupeCount === items.length) {
      console.log('  All duplicates - stopping')
      break
    }

    offset += items.length
  }

  return { items: allItems, duplicates: duplicateCount }
}

async function main() {
  // Test Dec 1 invoice
  const result = await getAllWithOffset(8633612)

  console.log('\n' + '═'.repeat(60))
  console.log('RESULTS')
  console.log('═'.repeat(60))

  console.log(`Total unique transactions: ${result.items.length}`)
  console.log(`Total duplicates: ${result.duplicates}`)

  if (result.items.length > 0) {
    const total = result.items.reduce((sum, t) => sum + t.amount, 0)
    console.log(`Total amount: $${total.toFixed(2)}`)

    const dates = result.items.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]
    console.log(`Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)

    console.log(`\nDate breakdown:`)
    for (const d of uniqueDates) {
      const dayItems = result.items.filter(t => t.charge_date === d)
      const dayTotal = dayItems.reduce((s, t) => s + t.amount, 0)
      console.log(`  ${d}: ${dayItems.length} txns, $${dayTotal.toFixed(2)}`)
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log('COMPARISON')
  console.log('═'.repeat(60))
  console.log(`Expected invoice total: $11,127.61`)
  console.log(`Offset pagination total: $${result.items.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)

  // Also test Nov 24 invoice
  console.log('\n\nTesting Nov 24 invoice...')
  const nov24Result = await getAllWithOffset(8595597)
  console.log(`Nov 24 invoice: ${nov24Result.items.length} transactions`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
