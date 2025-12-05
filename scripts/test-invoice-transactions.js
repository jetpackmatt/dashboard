#!/usr/bin/env node
/**
 * Test GET /invoices/{id}/transactions endpoint
 *
 * Purpose: Verify this endpoint has working pagination and can retrieve
 * all transactions for an invoice (unlike the broken POST /transactions:query)
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN  // Parent token
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`
  console.log(`\nFetching: ${url}`)

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }

  return response.json()
}

async function getRecentInvoices() {
  // Get invoices from last 30 days
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)

  const endpoint = `/2025-07/invoices?StartDate=${startDate.toISOString().split('T')[0]}&Limit=20`
  return fetchWithAuth(endpoint)
}

async function getInvoiceTransactions(invoiceId, cursor = null) {
  let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
  if (cursor) {
    endpoint += `&Cursor=${encodeURIComponent(cursor)}`
  }
  return fetchWithAuth(endpoint)
}

async function testPagination(invoiceId, invoiceType, expectedCount) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Testing Invoice #${invoiceId} (${invoiceType})`)
  console.log(`${'='.repeat(60)}`)

  const allTransactions = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0
  let duplicateCount = 0

  do {
    pageNum++
    console.log(`\n--- Page ${pageNum} ---`)

    const data = await getInvoiceTransactions(invoiceId, cursor)
    const items = data.items || []

    console.log(`  Items returned: ${items.length}`)
    console.log(`  Raw 'next' value: ${JSON.stringify(data.next)}`)
    console.log(`  Type of 'next': ${typeof data.next}`)

    // Check for duplicates
    let newItems = 0
    let dupes = 0
    for (const tx of items) {
      if (seenIds.has(tx.transaction_id)) {
        dupes++
        duplicateCount++
      } else {
        seenIds.add(tx.transaction_id)
        allTransactions.push(tx)
        newItems++
      }
    }

    console.log(`  New unique items: ${newItems}`)
    if (dupes > 0) {
      console.log(`  ⚠️ DUPLICATES: ${dupes}`)
    }

    // Get next cursor - try multiple approaches
    cursor = null
    if (data.next) {
      if (typeof data.next === 'string') {
        // Check if it's a URL path
        if (data.next.startsWith('/') || data.next.startsWith('http')) {
          try {
            const nextUrl = new URL(data.next, BASE_URL)
            cursor = nextUrl.searchParams.get('Cursor') || nextUrl.searchParams.get('cursor')
            console.log(`  Extracted cursor from URL: ${cursor ? cursor.substring(0, 40) + '...' : 'null'}`)
          } catch (e) {
            // Treat as raw cursor
            cursor = data.next
            console.log(`  Using raw cursor: ${cursor.substring(0, 40)}...`)
          }
        } else {
          // It's a raw cursor string
          cursor = data.next
          console.log(`  Using raw cursor: ${cursor.substring(0, 40)}...`)
        }
      }
    }

    // Safety: stop after 20 pages
    if (pageNum >= 20) {
      console.log('\n⚠️ Stopping after 20 pages (safety limit)')
      break
    }

  } while (cursor)

  console.log(`\n--- RESULTS for Invoice #${invoiceId} ---`)
  console.log(`Total pages fetched: ${pageNum}`)
  console.log(`Total unique transactions: ${allTransactions.length}`)
  console.log(`Total duplicates found: ${duplicateCount}`)
  console.log(`Duplicate rate: ${((duplicateCount / (allTransactions.length + duplicateCount)) * 100).toFixed(1)}%`)

  // Show breakdown by fee type
  const feeTypeCounts = {}
  let totalAmount = 0
  for (const tx of allTransactions) {
    const feeType = tx.transaction_fee || 'unknown'
    feeTypeCounts[feeType] = (feeTypeCounts[feeType] || 0) + 1
    totalAmount += tx.amount || 0
  }

  console.log(`\nFee type breakdown:`)
  Object.entries(feeTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`)
    })

  console.log(`\nTotal amount: $${totalAmount.toFixed(2)}`)

  return {
    invoiceId,
    invoiceType,
    transactionCount: allTransactions.length,
    duplicates: duplicateCount,
    totalAmount,
    paginationWorking: duplicateCount === 0
  }
}

async function main() {
  console.log('Testing GET /invoices/{id}/transactions endpoint\n')

  if (!SHIPBOB_TOKEN) {
    console.error('Missing SHIPBOB_API_TOKEN in .env.local')
    process.exit(1)
  }

  // Step 1: Get recent invoices
  console.log('Step 1: Fetching recent invoices...')
  const invoicesData = await getRecentInvoices()
  const invoices = invoicesData.items || []

  console.log(`\nFound ${invoices.length} invoices:`)
  invoices.forEach(inv => {
    console.log(`  #${inv.invoice_id}: ${inv.invoice_type} - $${inv.amount} (${inv.invoice_date})`)
  })

  // Step 2: Test pagination on the largest invoice (likely Shipping)
  const shippingInvoice = invoices.find(inv => inv.invoice_type === 'Shipping')

  if (shippingInvoice) {
    try {
      const result = await testPagination(shippingInvoice.invoice_id, shippingInvoice.invoice_type, null)
      console.log(`\n${'='.repeat(60)}`)
      console.log('CONCLUSION')
      console.log(`${'='.repeat(60)}`)

      const expected = Math.abs(shippingInvoice.amount)  // Invoice amount
      const avgPerTx = result.totalAmount / result.transactionCount
      const estimatedTotal = result.totalAmount

      console.log(`Invoice amount: $${shippingInvoice.amount}`)
      console.log(`Sum of transactions: $${result.totalAmount.toFixed(2)}`)
      console.log(`Transaction count: ${result.transactionCount}`)

      if (result.transactionCount === 100 && shippingInvoice.amount > result.totalAmount * 1.5) {
        console.log(`\n⚠️ Likely MORE transactions exist - we only got 100 but pagination stopped`)
        console.log(`   Invoice is $${shippingInvoice.amount} but we only got $${result.totalAmount.toFixed(2)}`)
      }
    } catch (err) {
      console.error(`\nError: ${err.message}`)
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
