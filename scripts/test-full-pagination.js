#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function testFullPagination() {
  console.log('=== Testing Full Pagination with page_size ===\n')

  // Test max page size
  console.log('Test: Query with page_size=1000...')
  const response1 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-20',
      end_date: '2025-11-26',
      page_size: 1000
    })
  })
  const data1 = await response1.json()
  console.log(`  Items returned: ${data1.items?.length || 0}`)
  console.log(`  Has next cursor: ${!!data1.next}`)
  if (data1.next) {
    console.log(`  Next cursor exists - there are more pages`)
  }

  const total1 = (data1.items || []).reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`  Total for this page: $${total1.toFixed(2)}`)

  // Now paginate through everything with page_size in cursor requests
  console.log('\n\nFull pagination with page_size=1000 and cursor...')
  let allItems = []
  let cursor = null
  let pageNum = 0
  const seenIds = new Set()

  do {
    pageNum++
    const body = {
      start_date: '2025-11-20',
      end_date: '2025-11-26',
      page_size: 1000
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

    // Track new vs duplicate items
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

    const pageTotal = (data.items || []).reduce((sum, tx) => sum + tx.amount, 0)
    console.log(`  Page ${pageNum}: ${data.items?.length || 0} items (${newItems} new, ${dupes} dupes) = $${pageTotal.toFixed(2)}`)

    // Stop conditions
    if (!data.next) {
      console.log('  ✓ No next cursor - done!')
      break
    }
    if (newItems === 0) {
      console.log('  ✗ All duplicates - cursor bug, stopping')
      break
    }
    if (pageNum >= 20) {
      console.log('  ✗ Max pages reached - stopping')
      break
    }

    cursor = data.next
  } while (true)

  console.log(`\n=== RESULTS ===`)
  console.log(`Total unique transactions: ${allItems.length}`)
  const grandTotal = allItems.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`Total amount: $${grandTotal.toFixed(2)}`)

  // Break down by date and fee type
  console.log('\nBy charge_date:')
  const byDate = {}
  for (const tx of allItems) {
    const d = tx.charge_date
    if (!byDate[d]) byDate[d] = { count: 0, total: 0 }
    byDate[d].count++
    byDate[d].total += tx.amount
  }
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, stats]) => {
      console.log(`  ${date}: ${stats.count.toString().padStart(4)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })

  console.log('\nBy fee type:')
  const byFee = {}
  for (const tx of allItems) {
    const fee = tx.transaction_fee
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += tx.amount
  }
  Object.entries(byFee)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(25)}: ${stats.count.toString().padStart(4)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })
}

testFullPagination().catch(console.error)
