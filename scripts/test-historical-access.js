#!/usr/bin/env node
/**
 * Test how far back we can access transactions with correct API params
 * Previously thought 7-day limit - let's verify!
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

    if (pageNum >= 100) break // Safety limit
  } while (cursor)

  return { items: allItems, pages: pageNum }
}

async function testDateRange(fromDate, toDate, label) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`${label}`)
  console.log(`Range: ${fromDate} to ${toDate}`)

  const result = await queryTransactions({
    from_date: `${fromDate}T00:00:00Z`,
    to_date: `${toDate}T23:59:59Z`
  })

  if (result.error) {
    console.log(`  ERROR: ${result.error}`)
    return null
  }

  const items = result.items
  console.log(`  Total: ${items.length} transactions (${result.pages} pages)`)

  if (items.length > 0) {
    // Group by date
    const byDate = {}
    for (const t of items) {
      const d = t.charge_date || 'null'
      byDate[d] = (byDate[d] || 0) + 1
    }

    const dates = Object.keys(byDate).sort()
    console.log(`  Date range in response: ${dates[0]} to ${dates[dates.length - 1]}`)
    console.log(`  Unique dates: ${dates.length}`)

    // Show daily counts
    for (const [d, c] of Object.entries(byDate).sort()) {
      console.log(`    ${d}: ${c}`)
    }

    // Amount
    const total = items.reduce((sum, t) => sum + t.amount, 0)
    console.log(`  Total amount: $${total.toFixed(2)}`)
  }

  return result.items
}

async function main() {
  console.log('Testing historical transaction access with CORRECT params\n')
  console.log('═'.repeat(60))

  // Test 1: Last 7 days (what we know works)
  await testDateRange('2025-11-27', '2025-12-04', 'Last 7 days (Nov 27 - Dec 4)')

  // Test 2: Go back 2 weeks
  await testDateRange('2025-11-20', '2025-12-04', 'Last 2 weeks (Nov 20 - Dec 4)')

  // Test 3: Go back 3 weeks
  await testDateRange('2025-11-13', '2025-12-04', 'Last 3 weeks (Nov 13 - Dec 4)')

  // Test 4: Go back 1 month
  await testDateRange('2025-11-04', '2025-12-04', 'Last month (Nov 4 - Dec 4)')

  // Test 5: All of November
  await testDateRange('2025-11-01', '2025-11-30', 'All November')

  // Test 6: All of October
  await testDateRange('2025-10-01', '2025-10-31', 'All October')

  // Test 7: No date filter (see what default returns)
  console.log(`\n${'─'.repeat(60)}`)
  console.log('No date filter (API default)')
  const noFilter = await queryTransactions({})
  if (noFilter.items.length > 0) {
    const dates = noFilter.items.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]
    console.log(`  Total: ${noFilter.items.length} transactions`)
    console.log(`  Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)
  }

  // Test 8: Invoiced only (to see historical invoiced transactions)
  console.log(`\n${'─'.repeat(60)}`)
  console.log('Invoiced only - last 30 days')
  const invoiced = await queryTransactions({
    invoiced_status: true,
    from_date: '2025-11-04T00:00:00Z',
    to_date: '2025-12-04T23:59:59Z'
  })
  if (invoiced.items.length > 0) {
    const byDate = {}
    for (const t of invoiced.items) {
      const d = t.charge_date || 'null'
      byDate[d] = (byDate[d] || 0) + 1
    }
    console.log(`  Total invoiced: ${invoiced.items.length}`)
    const dates = Object.keys(byDate).sort()
    console.log(`  Date range: ${dates[0]} to ${dates[dates.length - 1]}`)

    // Show by invoice_id
    const byInvoice = {}
    for (const t of invoiced.items) {
      const inv = t.invoice_id || 'null'
      byInvoice[inv] = (byInvoice[inv] || 0) + 1
    }
    console.log(`  Unique invoice IDs: ${Object.keys(byInvoice).length}`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
