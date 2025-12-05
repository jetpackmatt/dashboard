#!/usr/bin/env node
/**
 * Test offset-based pagination as described in the billing guide
 * Guide says: limit + offset parameters, NOT cursor
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  return { status: response.status, data: response.ok ? await response.json() : null }
}

async function testOffsetPagination(invoiceId, description) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Testing: ${description}`)
  console.log('═'.repeat(60))

  const allItems = []
  const seenIds = new Set()
  let offset = 0
  const limit = 250
  let pageNum = 0
  let duplicateCount = 0

  while (pageNum < 30) {  // Safety limit
    pageNum++

    // Try offset-based pagination
    const endpoint = `/2025-07/invoices/${invoiceId}/transactions?limit=${limit}&offset=${offset}`
    console.log(`Page ${pageNum}: offset=${offset}`)

    const { status, data } = await fetchWithAuth(endpoint)

    if (status !== 200) {
      console.log(`  ERROR: ${status}`)
      break
    }

    const items = data.items || data || []
    console.log(`  Returned: ${items.length} items`)

    if (items.length === 0) {
      console.log(`  No more items - done`)
      break
    }

    // Check for duplicates
    let newCount = 0
    for (const t of items) {
      if (seenIds.has(t.transaction_id)) {
        duplicateCount++
      } else {
        seenIds.add(t.transaction_id)
        allItems.push(t)
        newCount++
      }
    }
    console.log(`  New: ${newCount}, Duplicates: ${items.length - newCount}`)

    // Move offset forward
    offset += items.length

    // If we got fewer than limit, we're done
    if (items.length < limit) {
      console.log(`  Got ${items.length} < ${limit}, done`)
      break
    }
  }

  // Results
  console.log(`\nResults:`)
  console.log(`  Total unique: ${allItems.length}`)
  console.log(`  Total duplicates: ${duplicateCount}`)

  if (allItems.length > 0) {
    const total = allItems.reduce((sum, t) => sum + t.amount, 0)
    console.log(`  Total amount: $${total.toFixed(2)}`)

    const dates = allItems.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]
    console.log(`  Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)

    console.log(`\n  Date breakdown:`)
    for (const d of uniqueDates) {
      const count = allItems.filter(t => t.charge_date === d).length
      console.log(`    ${d}: ${count} txns`)
    }
  }

  return allItems
}

async function testStartEndDate() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`Testing POST with start_date/end_date (from guide)`)
  console.log('═'.repeat(60))

  const params = {
    start_date: '2025-11-24T00:00:00Z',
    end_date: '2025-12-02T00:00:00Z',
    page_size: 100
  }

  console.log(`Params: ${JSON.stringify(params)}`)

  const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  })

  console.log(`Status: ${response.status}`)

  if (response.ok) {
    const data = await response.json()
    const items = data.items || []
    console.log(`Items: ${items.length}`)

    if (items.length > 0) {
      const dates = items.map(t => t.charge_date).filter(Boolean).sort()
      console.log(`Dates: ${[...new Set(dates)].join(', ')}`)
    }
  } else {
    const text = await response.text()
    console.log(`Error: ${text.substring(0, 200)}`)
  }
}

async function main() {
  console.log('Testing pagination methods from billing guide\n')

  // Test 1: Offset pagination on Dec 1 invoice
  await testOffsetPagination(8633612, 'Dec 1 Invoice with offset pagination')

  // Test 2: Offset pagination on Nov 24 invoice
  await testOffsetPagination(8595597, 'Nov 24 Invoice with offset pagination')

  // Test 3: POST with start_date/end_date
  await testStartEndDate()

  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
