#!/usr/bin/env node
/**
 * Check if POST /transactions:query with invoice_ids has duplicate pagination bug
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function main() {
  console.log('Testing POST pagination for duplicates with invoice_ids filter\n')

  const allItems = []
  const seenIds = new Set()
  let duplicateCount = 0
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    const body = {
      invoice_ids: ['8633612'],
      page_size: 250
    }
    if (cursor) body.cursor = cursor

    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = await response.json()
    const items = data.items || []

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

    console.log(`Page ${pageNum}: ${items.length} items (${newCount} new, ${dupeCount} dupes)`)

    cursor = data.next || null

    // Stop after 30 pages or if all dupes
    if (pageNum >= 30 || (items.length > 0 && dupeCount === items.length)) {
      if (dupeCount === items.length && items.length > 0) {
        console.log('⚠️ Full page of duplicates - stopping')
      }
      break
    }
  } while (cursor)

  console.log(`\n${'═'.repeat(50)}`)
  console.log('RESULTS')
  console.log('═'.repeat(50))

  console.log(`Total pages: ${pageNum}`)
  console.log(`Total unique transactions: ${allItems.length}`)
  console.log(`Total duplicates: ${duplicateCount}`)
  console.log(`Duplicate rate: ${((duplicateCount / (allItems.length + duplicateCount)) * 100).toFixed(1)}%`)

  const total = allItems.reduce((sum, t) => sum + t.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)

  const dates = allItems.map(t => t.charge_date).filter(Boolean).sort()
  const uniqueDates = [...new Set(dates)]
  console.log(`Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)

  console.log(`\nDate breakdown:`)
  for (const d of uniqueDates) {
    const count = allItems.filter(t => t.charge_date === d).length
    const amt = allItems.filter(t => t.charge_date === d).reduce((s, t) => s + t.amount, 0)
    console.log(`  ${d}: ${count} txns, $${amt.toFixed(2)}`)
  }

  console.log(`\n${'═'.repeat(50)}`)
  console.log('COMPARISON')
  console.log('═'.repeat(50))
  console.log(`Expected invoice total: $11,127.61`)
  console.log(`POST unique transactions: $${total.toFixed(2)}`)
  console.log(`Gap: $${(11127.61 - total).toFixed(2)} (${((11127.61 - total) / 11127.61 * 100).toFixed(1)}%)`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
