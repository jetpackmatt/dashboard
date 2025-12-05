#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function fetchAllInvoiceTransactions(invoiceId) {
  const allTx = []
  const seenIds = new Set()
  let page = 0

  // Try to paginate (even if cursor doesn't work, pageSize should)
  while (true) {
    page++
    const response = await fetch(`https://api.shipbob.com/2025-07/invoices/${invoiceId}/transactions?pageSize=1000&page=${page}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    })
    const data = await response.json()
    const items = data.items || data || []

    if (!Array.isArray(items) || items.length === 0) break

    let newCount = 0
    for (const tx of items) {
      if (!seenIds.has(tx.transaction_id)) {
        seenIds.add(tx.transaction_id)
        allTx.push(tx)
        newCount++
      }
    }

    console.log(`    Page ${page}: ${items.length} items (${newCount} new)`)
    if (newCount === 0 || items.length < 1000) break
    if (page >= 10) break
  }

  return allTx
}

async function test() {
  console.log('=== Fetching Transactions via Invoice Endpoint ===\n')

  // Get all invoices for November
  console.log('Fetching November invoices...')
  const invResponse = await fetch('https://api.shipbob.com/2025-07/invoices?startDate=2025-11-01&endDate=2025-11-26&pageSize=100', {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const invData = await invResponse.json()
  const invoices = invData.items || []
  console.log(`Found ${invoices.length} invoices\n`)

  // Show invoice summary
  console.log('Invoice Summary:')
  let totalInvoiceAmount = 0
  for (const inv of invoices) {
    console.log(`  ${inv.invoice_id} | ${inv.invoice_date} | ${inv.invoice_type.padEnd(20)} | $${inv.amount.toFixed(2).padStart(10)}`)
    totalInvoiceAmount += inv.amount
  }
  console.log(`  ${''.padEnd(45)} Total: $${totalInvoiceAmount.toFixed(2).padStart(10)}`)

  // Fetch transactions for each invoice
  console.log('\n\nFetching transactions for each invoice...')
  let allTransactions = []
  const seenTxIds = new Set()

  for (const inv of invoices) {
    console.log(`\n  Invoice ${inv.invoice_id} (${inv.invoice_type} $${inv.amount}):`)
    const txs = await fetchAllInvoiceTransactions(inv.invoice_id)

    let newCount = 0
    for (const tx of txs) {
      if (!seenTxIds.has(tx.transaction_id)) {
        seenTxIds.add(tx.transaction_id)
        allTransactions.push(tx)
        newCount++
      }
    }

    const txTotal = txs.reduce((sum, tx) => sum + tx.amount, 0)
    console.log(`    Total: ${txs.length} tx, $${txTotal.toFixed(2)} (${newCount} unique added)`)
  }

  console.log('\n\n=== RESULTS ===')
  console.log(`Total invoiced transactions: ${allTransactions.length}`)
  const grandTotal = allTransactions.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`Total invoiced amount: $${grandTotal.toFixed(2)}`)

  // Now add uninvoiced transactions
  console.log('\n\nFetching uninvoiced transactions...')
  const unInvResponse = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 1000 })  // No date filter since it's ignored
  })
  const unInvData = await unInvResponse.json()
  const uninvoiced = (unInvData.items || []).filter(tx => !tx.invoiced_status)
  console.log(`Uninvoiced transactions: ${uninvoiced.length}`)
  const unInvTotal = uninvoiced.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`Uninvoiced total: $${unInvTotal.toFixed(2)}`)

  // Check for duplicates between invoiced and uninvoiced
  let dupeCount = 0
  for (const tx of uninvoiced) {
    if (seenTxIds.has(tx.transaction_id)) {
      dupeCount++
    } else {
      seenTxIds.add(tx.transaction_id)
      allTransactions.push(tx)
    }
  }
  console.log(`Duplicates with invoiced: ${dupeCount}`)

  console.log('\n\n=== GRAND TOTAL ===')
  console.log(`All transactions: ${allTransactions.length}`)
  const total = allTransactions.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)
}

test().catch(console.error)
