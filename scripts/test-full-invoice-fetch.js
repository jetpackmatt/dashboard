#!/usr/bin/env node
/**
 * Test full pagination through invoice transactions using cursor
 */
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

const SHIPPING_INVOICE = 8595597 // Nov 24 Shipping - $13,003.29

async function fetchAllInvoiceTransactions(invoiceId) {
  const allTx = []
  const seenIds = new Set()
  let cursor = null
  let page = 0

  do {
    page++
    let url = `https://api.shipbob.com/2025-07/invoices/${invoiceId}/transactions?pageSize=1000`
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    })
    const data = await response.json()
    const items = data.items || data || []

    if (!Array.isArray(items) || items.length === 0) {
      console.log(`  Page ${page}: No items`)
      break
    }

    let newCount = 0
    let dupeCount = 0
    for (const tx of items) {
      if (seenIds.has(tx.transaction_id)) {
        dupeCount++
      } else {
        seenIds.add(tx.transaction_id)
        allTx.push(tx)
        newCount++
      }
    }

    const pageTotal = items.reduce((s, t) => s + t.amount, 0)
    console.log(`  Page ${page}: ${items.length} items (${newCount} new, ${dupeCount} dupes) = $${pageTotal.toFixed(2)}`)

    if (newCount === 0) {
      console.log('  All duplicates - stopping')
      break
    }

    cursor = data.next
    if (!cursor) {
      console.log('  No more pages')
      break
    }

    if (page >= 20) {
      console.log('  Max pages reached')
      break
    }
  } while (true)

  return allTx
}

async function test() {
  console.log(`=== Full Pagination Test for Invoice ${SHIPPING_INVOICE} ===\n`)
  console.log('Expected total: $13,003.29\n')

  const transactions = await fetchAllInvoiceTransactions(SHIPPING_INVOICE)

  console.log('\n=== RESULTS ===')
  console.log(`Total transactions: ${transactions.length}`)
  const total = transactions.reduce((s, t) => s + t.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)
  console.log(`Expected: $13,003.29`)
  console.log(`Difference: $${(13003.29 - total).toFixed(2)}`)

  // By fee type
  console.log('\nBy fee type:')
  const byFee = {}
  for (const tx of transactions) {
    const fee = tx.transaction_fee
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += tx.amount
  }
  Object.entries(byFee)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(30)}: ${stats.count.toString().padStart(4)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })
}

test().catch(console.error)
