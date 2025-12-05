#!/usr/bin/env node
/**
 * Deep dive on invoice_ids filter in POST /transactions:query
 * This filter returned data in Test 5 - let's see if we can get MORE data this way
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactionsWithPagination(params, maxPages = 20) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    const bodyParams = { ...params, page_size: 250 }
    if (cursor) bodyParams.cursor = cursor

    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(bodyParams)
    })

    if (!response.ok) {
      console.log(`  Page ${pageNum}: ERROR ${response.status}`)
      break
    }

    const data = await response.json()
    const items = data.items || []
    allItems.push(...items)

    console.log(`  Page ${pageNum}: ${items.length} items (total: ${allItems.length})`)

    cursor = data.next || null

    if (pageNum >= maxPages) {
      console.log(`  Stopping at page ${maxPages}`)
      break
    }
  } while (cursor)

  return allItems
}

async function main() {
  console.log('Testing invoice_ids filter with pagination\n')

  const invoices = [
    { id: '8633612', date: 'Dec 1', expected: 11127.61 },
    { id: '8595597', date: 'Nov 24', expected: 13003.29 },
    { id: '8564590', date: 'Nov 17', expected: 13429.47 },
  ]

  for (const inv of invoices) {
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Invoice #${inv.id} (${inv.date}) - Expected: $${inv.expected}`)
    console.log('═'.repeat(50))

    console.log('\nMethod 1: POST /transactions:query with invoice_ids')
    const txnsFromQuery = await queryTransactionsWithPagination({ invoice_ids: [inv.id] })

    if (txnsFromQuery.length > 0) {
      const dates = txnsFromQuery.map(t => t.charge_date).filter(Boolean).sort()
      const uniqueDates = [...new Set(dates)]
      const total = txnsFromQuery.reduce((sum, t) => sum + t.amount, 0)

      console.log(`\n  Results:`)
      console.log(`    Transactions: ${txnsFromQuery.length}`)
      console.log(`    Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)
      console.log(`    Total: $${total.toFixed(2)}`)
      console.log(`    Gap: $${(inv.expected - total).toFixed(2)} (${((inv.expected - total) / inv.expected * 100).toFixed(1)}%)`)
    } else {
      console.log(`\n  Results: 0 transactions`)
    }

    // Compare with GET endpoint
    console.log('\nMethod 2: GET /invoices/{id}/transactions')
    let getTxns = []
    let cursor = null

    do {
      let url = `${BASE_URL}/2025-07/invoices/${inv.id}/transactions?PageSize=250`
      if (cursor) url += `&Cursor=${encodeURIComponent(cursor)}`

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
      })

      if (!response.ok) break

      const data = await response.json()
      getTxns.push(...(data.items || []))
      cursor = data.next || null
    } while (cursor)

    if (getTxns.length > 0) {
      const dates = getTxns.map(t => t.charge_date).filter(Boolean).sort()
      const uniqueDates = [...new Set(dates)]
      const total = getTxns.reduce((sum, t) => sum + t.amount, 0)

      console.log(`    Transactions: ${getTxns.length}`)
      console.log(`    Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)
      console.log(`    Total: $${total.toFixed(2)}`)
    } else {
      console.log(`    Results: 0 transactions`)
    }

    // Do they return the same data?
    console.log(`\n  Comparison:`)
    console.log(`    POST method: ${txnsFromQuery.length} txns`)
    console.log(`    GET method:  ${getTxns.length} txns`)

    if (txnsFromQuery.length > 0 && getTxns.length > 0) {
      const postIds = new Set(txnsFromQuery.map(t => t.transaction_id))
      const getIds = new Set(getTxns.map(t => t.transaction_id))

      const onlyInPost = txnsFromQuery.filter(t => !getIds.has(t.transaction_id))
      const onlyInGet = getTxns.filter(t => !postIds.has(t.transaction_id))

      console.log(`    Only in POST: ${onlyInPost.length}`)
      console.log(`    Only in GET:  ${onlyInGet.length}`)
    }
  }

  console.log('\n' + '═'.repeat(50))
  console.log('SUMMARY')
  console.log('═'.repeat(50))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
