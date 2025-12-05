#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function testPagination() {
  console.log('=== Testing ShipBob Pagination ===\n')

  // Test 1: Try with explicit pageSize parameter in query body
  console.log('Test 1: Query with pageSize in body...')
  const response1 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-20',
      end_date: '2025-11-26',
      page_size: 500  // Try snake_case
    })
  })
  const data1 = await response1.json()
  console.log(`  Items returned: ${data1.items?.length || 0}`)
  console.log(`  Has next cursor: ${!!data1.next}`)
  if (data1.next) console.log(`  Next cursor: ${data1.next.substring(0, 50)}...`)

  // Test 2: Try with pageSize in URL query params
  console.log('\nTest 2: Query with pageSize in URL...')
  const response2 = await fetch('https://api.shipbob.com/2025-07/transactions:query?pageSize=500', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-20',
      end_date: '2025-11-26'
    })
  })
  const data2 = await response2.json()
  console.log(`  Items returned: ${data2.items?.length || 0}`)
  console.log(`  Has next cursor: ${!!data2.next}`)

  // Test 3: Try limit parameter
  console.log('\nTest 3: Query with limit in body...')
  const response3 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-20',
      end_date: '2025-11-26',
      limit: 500
    })
  })
  const data3 = await response3.json()
  console.log(`  Items returned: ${data3.items?.length || 0}`)
  console.log(`  Has next cursor: ${!!data3.next}`)

  // Test 4: Proper cursor pagination - fetch multiple pages
  console.log('\nTest 4: Paginate through ALL results using cursor...')
  let allItems = []
  let cursor = null
  let pageNum = 0
  const seenIds = new Set()

  do {
    pageNum++
    const body = {
      start_date: '2025-11-20',
      end_date: '2025-11-26'
    }
    if (cursor) body.cursor = cursor

    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const data = await response.json()

    // Check for duplicates
    let newItems = 0
    let dupes = 0
    for (const item of data.items || []) {
      if (seenIds.has(item.transaction_id)) {
        dupes++
      } else {
        seenIds.add(item.transaction_id)
        allItems.push(item)
        newItems++
      }
    }

    console.log(`  Page ${pageNum}: ${data.items?.length || 0} items (${newItems} new, ${dupes} dupes)`)

    // Stop conditions
    if (!data.next) {
      console.log('  No next cursor - stopping')
      break
    }
    if (newItems === 0) {
      console.log('  All duplicates - stopping')
      break
    }
    if (pageNum >= 10) {
      console.log('  Max pages reached - stopping')
      break
    }

    cursor = data.next
  } while (true)

  console.log(`\n  Total unique items: ${allItems.length}`)
  const total = allItems.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`  Total amount: $${total.toFixed(2)}`)

  // Test 5: Try the non-query endpoint - list all transactions
  console.log('\nTest 5: Try GET /transactions endpoint...')
  const params = new URLSearchParams({
    startDate: '2025-11-20',
    endDate: '2025-11-26',
    pageSize: '500'
  })
  const response5 = await fetch(`https://api.shipbob.com/2025-07/transactions?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  if (!response5.ok) {
    console.log(`  Error: ${response5.status} ${response5.statusText}`)
    const text = await response5.text()
    console.log(`  ${text.substring(0, 200)}`)
  } else {
    const data5 = await response5.json()
    console.log(`  Items returned: ${data5.items?.length || data5.length || 0}`)
  }

  // Test 6: Check invoice transactions endpoint with pagination
  console.log('\nTest 6: Invoice transactions with pagination params...')
  const invoiceId = 8595597  // Known invoice
  const invParams = new URLSearchParams({ pageSize: '500' })
  const response6 = await fetch(`https://api.shipbob.com/2025-07/invoices/${invoiceId}/transactions?${invParams}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  if (!response6.ok) {
    console.log(`  Error: ${response6.status}`)
  } else {
    const data6 = await response6.json()
    const items = data6.items || data6
    console.log(`  Items returned: ${Array.isArray(items) ? items.length : 'unknown structure'}`)
    const invTotal = (Array.isArray(items) ? items : []).reduce((sum, tx) => sum + (tx.amount || 0), 0)
    console.log(`  Total amount: $${invTotal.toFixed(2)}`)
  }
}

testPagination().catch(console.error)
