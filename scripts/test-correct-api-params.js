#!/usr/bin/env node
/**
 * Test with CORRECT API parameters from full reference:
 * - from_date / to_date (NOT start_date/end_date!)
 * - page_size (1-1000)
 * - Cursor as query param
 * - invoiced_status: true/false/null
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function testQuery(bodyParams, queryParams = {}, label) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Test: ${label}`)
  console.log(`Body: ${JSON.stringify(bodyParams)}`)
  if (Object.keys(queryParams).length > 0) {
    console.log(`Query: ${JSON.stringify(queryParams)}`)
  }

  let url = `${BASE_URL}/2025-07/transactions:query`
  if (Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(queryParams).toString()
    url += `?${qs}`
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bodyParams)
  })

  console.log(`Status: ${response.status}`)

  if (!response.ok) {
    const text = await response.text()
    console.log(`Error: ${text.substring(0, 300)}`)
    return null
  }

  const data = await response.json()
  const items = data.items || []

  console.log(`Items: ${items.length}`)

  if (items.length > 0) {
    const dates = items.map(t => t.charge_date).filter(Boolean)
    const uniqueDates = [...new Set(dates)].sort()
    console.log(`Dates: ${uniqueDates.join(', ')}`)

    // Count by date
    const byDate = {}
    for (const t of items) {
      const d = t.charge_date || 'null'
      byDate[d] = (byDate[d] || 0) + 1
    }
    for (const [d, c] of Object.entries(byDate).sort()) {
      console.log(`  ${d}: ${c}`)
    }
  }

  return data
}

async function getAllWithPagination(bodyParams, label) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`PAGINATED: ${label}`)
  console.log(`Body: ${JSON.stringify(bodyParams)}`)

  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) {
      url += `?Cursor=${encodeURIComponent(cursor)}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyParams)
    })

    if (!response.ok) {
      console.log(`Page ${pageNum}: ERROR ${response.status}`)
      break
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

    console.log(`Page ${pageNum}: ${items.length} items (${newCount} new)`)

    cursor = data.next || null

    // Safety limits
    if (pageNum >= 50) {
      console.log('Hit 50 page limit')
      break
    }
    if (items.length > 0 && newCount === 0) {
      console.log('All duplicates, stopping')
      break
    }
  } while (cursor)

  // Summary
  const byDate = {}
  for (const t of allItems) {
    const d = t.charge_date || 'null'
    byDate[d] = (byDate[d] || 0) + 1
  }

  console.log(`\nTotal unique: ${allItems.length}`)
  console.log('By date:')
  for (const [d, c] of Object.entries(byDate).sort()) {
    console.log(`  ${d}: ${c}`)
  }

  return allItems
}

async function main() {
  console.log('Testing with CORRECT API parameters\n')
  console.log('from_date/to_date, page_size, Cursor as query param')
  console.log('═'.repeat(60))

  // Test 1: from_date/to_date with page_size 1000
  await testQuery({
    from_date: '2025-12-01T00:00:00Z',
    to_date: '2025-12-04T23:59:59Z',
    page_size: 1000
  }, {}, 'from_date/to_date + page_size 1000')

  // Test 2: Just from_date (should default to_date to today)
  await testQuery({
    from_date: '2025-12-01T00:00:00Z',
    page_size: 1000
  }, {}, 'Just from_date')

  // Test 3: invoiced_status: false (unbilled only)
  await testQuery({
    invoiced_status: false,
    page_size: 1000
  }, {}, 'invoiced_status: false (unbilled)')

  // Test 4: invoiced_status: null (all)
  await testQuery({
    invoiced_status: null,
    page_size: 1000
  }, {}, 'invoiced_status: null (all)')

  // Test 5: Unbilled with date range
  await testQuery({
    from_date: '2025-12-01T00:00:00Z',
    to_date: '2025-12-04T23:59:59Z',
    invoiced_status: false,
    page_size: 1000
  }, {}, 'Unbilled + date range')

  // Test 6: Full pagination with unbilled
  await getAllWithPagination({
    invoiced_status: false,
    page_size: 1000
  }, 'Full pagination - unbilled only')

  // Test 7: Full pagination with ALL (null invoiced_status)
  await getAllWithPagination({
    invoiced_status: null,
    page_size: 1000
  }, 'Full pagination - all transactions')

  // Test 8: Full pagination with date range
  await getAllWithPagination({
    from_date: '2025-12-01T00:00:00Z',
    to_date: '2025-12-04T23:59:59Z',
    page_size: 1000
  }, 'Full pagination - Dec 1-4')

  console.log('\n' + '═'.repeat(60))
  console.log('CONCLUSION')
  console.log('═'.repeat(60))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
