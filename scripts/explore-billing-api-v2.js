#!/usr/bin/env node
/**
 * Comprehensive Billing API Exploration
 *
 * Explores ALL three billing endpoints:
 * 1. GET /invoices - List invoices by date range
 * 2. GET /invoices/{id}/transactions - Get transactions for an invoice
 * 3. GET /transaction-fees - Get all fee type definitions
 *
 * Also explores:
 * - POST /transactions:query - Get pending (uninvoiced) transactions
 *
 * Goal: Understand how to sync ALL transaction data for:
 * - Dashboard transactions section (all data, invoiced + pending)
 * - Weekly invoice generation (matching billing periods to ShipBob invoices)
 */
require('dotenv').config({ path: '.env.local' })

const token = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  // Log rate limit headers
  const remaining = response.headers.get('x-ratelimit-remaining')
  if (remaining && parseInt(remaining) < 50) {
    console.log(`⚠️  Rate limit remaining: ${remaining}`)
  }

  return response.json()
}

async function main() {
  console.log('='.repeat(80))
  console.log('SHIPBOB BILLING API - COMPREHENSIVE EXPLORATION')
  console.log('='.repeat(80))

  // Define our billing period (last week as example)
  const periodEnd = new Date()
  const periodStart = new Date()
  periodStart.setDate(periodStart.getDate() - 7)

  console.log(`\nExploring billing period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`)

  // ============================================================
  // ENDPOINT 1: GET /transaction-fees
  // ============================================================
  console.log('\n' + '='.repeat(80))
  console.log('ENDPOINT 1: GET /transaction-fees')
  console.log('Purpose: Get all available fee type definitions')
  console.log('='.repeat(80))

  const feeTypesResponse = await fetchJson(`${API_BASE}/transaction-fees`)
  console.log('\nRaw response type:', typeof feeTypesResponse)
  console.log('Is array:', Array.isArray(feeTypesResponse))

  if (Array.isArray(feeTypesResponse)) {
    console.log(`\nTotal fee types: ${feeTypesResponse.length}`)
    console.log('\nFirst 10 fee types:')
    for (let i = 0; i < Math.min(10, feeTypesResponse.length); i++) {
      console.log(`  ${i + 1}. ${JSON.stringify(feeTypesResponse[i])}`)
    }

    // Group by category if there's a pattern
    const uniqueFees = [...new Set(feeTypesResponse)]
    console.log(`\nUnique fee names: ${uniqueFees.length}`)
  } else if (feeTypesResponse.items) {
    console.log(`Total fee types: ${feeTypesResponse.items.length}`)
    console.log('\nFirst 10:')
    for (let i = 0; i < Math.min(10, feeTypesResponse.items.length); i++) {
      console.log(`  ${i + 1}. ${JSON.stringify(feeTypesResponse.items[i])}`)
    }
  } else {
    console.log('Response structure:', JSON.stringify(feeTypesResponse, null, 2).slice(0, 500))
  }

  // ============================================================
  // ENDPOINT 2: GET /invoices
  // ============================================================
  console.log('\n' + '='.repeat(80))
  console.log('ENDPOINT 2: GET /invoices')
  console.log('Purpose: Get invoices for a date range')
  console.log('='.repeat(80))

  // Fetch 30 days of invoices
  const invoiceStart = new Date()
  invoiceStart.setDate(invoiceStart.getDate() - 30)

  const invoiceParams = new URLSearchParams({
    startDate: invoiceStart.toISOString().split('T')[0],
    endDate: periodEnd.toISOString().split('T')[0],
    pageSize: '100'
  })

  const invoicesData = await fetchJson(`${API_BASE}/invoices?${invoiceParams}`)
  const invoices = invoicesData.items || []

  console.log(`\nFound ${invoices.length} invoices in last 30 days`)

  // Group by type and date
  const byType = {}
  const byDate = {}
  for (const inv of invoices) {
    // By type
    if (!byType[inv.invoice_type]) {
      byType[inv.invoice_type] = { count: 0, total: 0, invoices: [] }
    }
    byType[inv.invoice_type].count++
    byType[inv.invoice_type].total += inv.amount
    byType[inv.invoice_type].invoices.push(inv)

    // By date
    if (!byDate[inv.invoice_date]) {
      byDate[inv.invoice_date] = []
    }
    byDate[inv.invoice_date].push(inv)
  }

  console.log('\nInvoices by type:')
  for (const [type, data] of Object.entries(byType)) {
    console.log(`  ${type}: ${data.count} invoices, $${data.total.toFixed(2)}`)
  }

  console.log('\nInvoices by date (most recent 5 dates):')
  const sortedDates = Object.keys(byDate).sort().reverse().slice(0, 5)
  for (const date of sortedDates) {
    const dayInvoices = byDate[date]
    console.log(`  ${date}:`)
    for (const inv of dayInvoices) {
      console.log(`    - ${inv.invoice_type}: $${inv.amount.toFixed(2)} (ID: ${inv.invoice_id})`)
    }
  }

  console.log('\nFull invoice structure (first invoice):')
  if (invoices.length > 0) {
    console.log(JSON.stringify(invoices[0], null, 2))
  }

  // ============================================================
  // ENDPOINT 3: GET /invoices/{id}/transactions
  // ============================================================
  console.log('\n' + '='.repeat(80))
  console.log('ENDPOINT 3: GET /invoices/{invoiceId}/transactions')
  console.log('Purpose: Get all transactions for a specific invoice')
  console.log('='.repeat(80))

  // Get one invoice of each type and fetch its transactions
  for (const [invoiceType, data] of Object.entries(byType)) {
    if (invoiceType === 'Payment') {
      console.log(`\n### ${invoiceType} - Skipping (payments have no transactions)`)
      continue
    }

    const sampleInvoice = data.invoices[0]
    console.log(`\n### ${invoiceType} ###`)
    console.log(`Invoice ID: ${sampleInvoice.invoice_id}`)
    console.log(`Invoice Date: ${sampleInvoice.invoice_date}`)
    console.log(`Total Amount: $${sampleInvoice.amount}`)

    // Fetch ALL transactions for this invoice (paginated)
    let allTxs = []
    let cursor = null
    let pageCount = 0

    do {
      let url = `${API_BASE}/invoices/${sampleInvoice.invoice_id}/transactions?pageSize=250`
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

      const txData = await fetchJson(url)
      const items = txData.items || []
      allTxs.push(...items)
      cursor = txData.next
      pageCount++

      if (pageCount > 10) break // Safety limit
    } while (cursor)

    console.log(`Transactions fetched: ${allTxs.length} (in ${pageCount} pages)`)

    if (allTxs.length > 0) {
      // Show full structure of first transaction
      console.log('\nFULL TRANSACTION STRUCTURE:')
      console.log(JSON.stringify(allTxs[0], null, 2))

      // Show variety of transaction_fee types in this invoice
      const feeTypes = {}
      for (const tx of allTxs) {
        feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
      }
      console.log('\nFee types in this invoice:')
      for (const [fee, count] of Object.entries(feeTypes)) {
        console.log(`  ${fee}: ${count}`)
      }

      // Sum amounts to verify matches invoice total
      const txTotal = allTxs.reduce((sum, tx) => sum + tx.amount, 0)
      console.log(`\nTransaction sum: $${txTotal.toFixed(2)} (Invoice total: $${sampleInvoice.amount.toFixed(2)})`)
      if (Math.abs(txTotal - sampleInvoice.amount) > 0.01) {
        console.log('⚠️  MISMATCH - transactions don\'t sum to invoice total!')
      }
    }
  }

  // ============================================================
  // PENDING TRANSACTIONS (POST /transactions:query)
  // ============================================================
  console.log('\n' + '='.repeat(80))
  console.log('PENDING TRANSACTIONS: POST /transactions:query')
  console.log('Purpose: Get uninvoiced transactions for current billing period')
  console.log('='.repeat(80))

  // Query for pending transactions (no invoice yet)
  const pendingData = await fetchJson(`${API_BASE}/transactions:query`, {
    method: 'POST',
    body: JSON.stringify({
      start_date: periodStart.toISOString().split('T')[0],
      end_date: periodEnd.toISOString().split('T')[0],
      page_size: 250
    })
  })

  const pendingTxs = pendingData.items || []
  console.log(`\nPending transactions (last 7 days): ${pendingTxs.length}`)

  if (pendingTxs.length > 0) {
    // Show full structure
    console.log('\nFULL PENDING TRANSACTION STRUCTURE:')
    console.log(JSON.stringify(pendingTxs[0], null, 2))

    // Group by fee type
    const pendingByFee = {}
    let pendingTotal = 0
    for (const tx of pendingTxs) {
      pendingByFee[tx.transaction_fee] = (pendingByFee[tx.transaction_fee] || 0) + 1
      pendingTotal += tx.amount
    }

    console.log('\nPending by fee type:')
    for (const [fee, count] of Object.entries(pendingByFee)) {
      console.log(`  ${fee}: ${count}`)
    }
    console.log(`\nPending total: $${pendingTotal.toFixed(2)}`)

    // Check invoiced_status
    const invoicedCount = pendingTxs.filter(tx => tx.invoiced_status).length
    console.log(`\nInvoiced status: ${invoicedCount} invoiced, ${pendingTxs.length - invoicedCount} pending`)
  }

  // ============================================================
  // COMPARISON: Same transaction in different queries?
  // ============================================================
  console.log('\n' + '='.repeat(80))
  console.log('DATA COMPARISON')
  console.log('='.repeat(80))

  // Get the most recent Shipping invoice
  const shippingInvoices = byType['Shipping']?.invoices || []
  if (shippingInvoices.length > 0) {
    const recentShipping = shippingInvoices[0]
    console.log(`\nComparing data sources for Shipping Invoice ${recentShipping.invoice_id}`)

    // Get transactions via invoice endpoint
    const invTxData = await fetchJson(`${API_BASE}/invoices/${recentShipping.invoice_id}/transactions?pageSize=5`)
    const invTxs = invTxData.items || []

    if (invTxs.length > 0) {
      const sampleTx = invTxs[0]
      console.log(`\nSample transaction: ${sampleTx.transaction_id}`)
      console.log(`  reference_id (shipment): ${sampleTx.reference_id}`)

      // Can we query this same transaction via transactions:query?
      console.log('\nQuerying same transaction via POST /transactions:query...')
      const queryData = await fetchJson(`${API_BASE}/transactions:query`, {
        method: 'POST',
        body: JSON.stringify({
          reference_ids: [sampleTx.reference_id],
          page_size: 10
        })
      })

      const queryTxs = queryData.items || []
      console.log(`Found ${queryTxs.length} transactions for reference_id ${sampleTx.reference_id}`)

      if (queryTxs.length > 0) {
        console.log('\nComparing fields:')
        const fields = Object.keys(sampleTx)
        for (const field of fields) {
          const invValue = JSON.stringify(sampleTx[field])
          const queryValue = JSON.stringify(queryTxs.find(t => t.transaction_id === sampleTx.transaction_id)?.[field])
          const match = invValue === queryValue ? '✅' : '❌'
          console.log(`  ${field}: ${match}`)
        }
      }
    }
  }

  // ============================================================
  // SUMMARY & RECOMMENDATIONS
  // ============================================================
  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY: DATA AVAILABLE FROM BILLING API')
  console.log('='.repeat(80))

  console.log(`
ENDPOINTS:
1. GET /invoices - List ShipBob invoices by date range
   - Returns: invoice_id, invoice_date, invoice_type, amount, currency, running_balance
   - Use: Find which invoices fall within our billing period

2. GET /invoices/{id}/transactions - Get all transactions for an invoice
   - Returns: Full transaction details (see structure above)
   - Use: Get invoiced transactions with amounts

3. GET /transaction-fees - List all fee type names
   - Returns: Array of fee type strings
   - Use: Reference/validation only (not essential for sync)

4. POST /transactions:query - Query transactions by date/reference
   - Returns: Same structure as #2
   - Use: Get PENDING (uninvoiced) transactions

KEY INSIGHT:
- Transactions get the SAME structure from both #2 and #4
- #2 is for invoiced transactions (by invoice ID)
- #4 is for pending OR querying by reference_id/date range

FOR SYNC STRATEGY:
- Hourly: Use #4 to get all pending transactions
- Weekly invoice: Use #1 to find invoices, then #2 to get their transactions
- reference_id links to: Shipment ID, Return ID, or FC-InventoryID-LocationType
`)
}

main().catch(console.error)
