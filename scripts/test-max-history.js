#!/usr/bin/env node
/**
 * Find the earliest transaction available via API
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(bodyParams) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...bodyParams, page_size: 1000 })
    })

    if (!response.ok) return { items: [], error: response.status }

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null

    if (pageNum >= 200) break
  } while (cursor)

  return { items: allItems, pages: pageNum }
}

async function main() {
  console.log('Finding maximum historical data available\n')
  console.log('═'.repeat(60))

  // Try progressively older date ranges
  const ranges = [
    { from: '2025-09-01', to: '2025-09-30', label: 'September 2025' },
    { from: '2025-08-01', to: '2025-08-31', label: 'August 2025' },
    { from: '2025-07-01', to: '2025-07-31', label: 'July 2025' },
    { from: '2025-06-01', to: '2025-06-30', label: 'June 2025' },
    { from: '2025-01-01', to: '2025-01-31', label: 'January 2025' },
    { from: '2024-12-01', to: '2024-12-31', label: 'December 2024' },
    { from: '2024-01-01', to: '2024-12-31', label: 'All of 2024' },
  ]

  for (const r of ranges) {
    console.log(`\n${r.label} (${r.from} to ${r.to})...`)

    const result = await queryTransactions({
      from_date: `${r.from}T00:00:00Z`,
      to_date: `${r.to}T23:59:59Z`
    })

    if (result.error) {
      console.log(`  ERROR: ${result.error}`)
      continue
    }

    const items = result.items
    if (items.length === 0) {
      console.log(`  No transactions found`)
      continue
    }

    const dates = items.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]
    const total = items.reduce((sum, t) => sum + t.amount, 0)

    console.log(`  Found: ${items.length} transactions`)
    console.log(`  Dates: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)
    console.log(`  Amount: $${total.toFixed(2)}`)
  }

  // Now get EVERYTHING with a wide date range
  console.log('\n' + '═'.repeat(60))
  console.log('Attempting to get ALL transactions (2024-01-01 to today)...')
  console.log('═'.repeat(60))

  const allTime = await queryTransactions({
    from_date: '2024-01-01T00:00:00Z',
    to_date: '2025-12-31T23:59:59Z'
  })

  if (allTime.items.length > 0) {
    const items = allTime.items
    const dates = items.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]

    console.log(`\nTotal transactions: ${items.length}`)
    console.log(`Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)
    console.log(`Total pages: ${allTime.pages}`)

    // Group by month
    const byMonth = {}
    for (const t of items) {
      const month = t.charge_date?.substring(0, 7) || 'unknown'
      byMonth[month] = (byMonth[month] || 0) + 1
    }

    console.log('\nTransactions by month:')
    for (const [m, c] of Object.entries(byMonth).sort()) {
      console.log(`  ${m}: ${c}`)
    }

    // Total amount
    const total = items.reduce((sum, t) => sum + t.amount, 0)
    console.log(`\nTotal amount: $${total.toFixed(2)}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
