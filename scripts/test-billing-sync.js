#!/usr/bin/env node
/**
 * Test the billing sync with the updated logic
 * Mimics what sync.ts does but in plain JS for quick testing
 */
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function testBillingSync() {
  console.log('=== Testing Billing Sync Logic ===\n')

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)
  const endDate = new Date()

  // 1. Fetch invoices
  console.log('1. Fetching invoices...')
  const invParams = new URLSearchParams({
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    pageSize: '100'
  })
  const invResponse = await fetch(`https://api.shipbob.com/2025-07/invoices?${invParams}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const invData = await invResponse.json()
  const invoices = invData.items || []
  console.log(`   Found ${invoices.length} invoices`)

  // 2. Fetch pending transactions
  console.log('\n2. Fetching pending transactions...')
  const txResponse = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      page_size: 1000
    })
  })
  const txData = await txResponse.json()
  const pendingTxs = txData.items || []
  console.log(`   Found ${pendingTxs.length} pending transactions`)
  const pendingTotal = pendingTxs.reduce((s, t) => s + t.amount, 0)
  console.log(`   Pending total: $${pendingTotal.toFixed(2)}`)

  // 3. Fetch invoiced transactions from recent non-Payment invoices
  console.log('\n3. Fetching invoiced transactions from recent invoices...')
  const seenIds = new Set(pendingTxs.map(t => t.transaction_id))
  const invoicedTxs = []

  const billingInvoices = invoices.filter(inv => inv.invoice_type !== 'Payment')
  console.log(`   Processing ${billingInvoices.length} non-Payment invoices...`)

  for (const inv of billingInvoices) {
    // Paginate through all transactions for this invoice
    let cursor = null
    let invoiceTxCount = 0
    let invoiceNewCount = 0

    do {
      let url = `https://api.shipbob.com/2025-07/invoices/${inv.invoice_id}/transactions?pageSize=1000`
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

      const invTxResponse = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      })
      const invTxData = await invTxResponse.json()
      const items = invTxData.items || invTxData || []

      if (!Array.isArray(items) || items.length === 0) break

      invoiceTxCount += items.length
      let pageNewCount = 0
      for (const tx of items) {
        if (!seenIds.has(tx.transaction_id)) {
          seenIds.add(tx.transaction_id)
          invoicedTxs.push(tx)
          pageNewCount++
          invoiceNewCount++
        }
      }

      // Stop if all duplicates
      if (pageNewCount === 0) break

      cursor = invTxData.next
    } while (cursor)

    console.log(`   Invoice ${inv.invoice_id} (${inv.invoice_type.padEnd(20)}): ${invoiceTxCount.toString().padStart(4)} tx, ${invoiceNewCount} new`)
  }

  console.log(`   Total invoiced transactions found: ${invoicedTxs.length}`)
  const invoicedTotal = invoicedTxs.reduce((s, t) => s + t.amount, 0)
  console.log(`   Invoiced total: $${invoicedTotal.toFixed(2)}`)

  // 4. Summary
  const allTxs = [...pendingTxs, ...invoicedTxs]
  const grandTotal = allTxs.reduce((s, t) => s + t.amount, 0)

  console.log('\n=== SYNC SUMMARY ===')
  console.log(`Invoices: ${invoices.length}`)
  console.log(`Pending transactions: ${pendingTxs.length} ($${pendingTotal.toFixed(2)})`)
  console.log(`Invoiced transactions: ${invoicedTxs.length} ($${invoicedTotal.toFixed(2)})`)
  console.log(`Total transactions: ${allTxs.length}`)
  console.log(`Total amount: $${grandTotal.toFixed(2)}`)

  // Breakdown by charge_date
  console.log('\nBy charge_date:')
  const byDate = {}
  for (const tx of allTxs) {
    const d = tx.charge_date
    if (!byDate[d]) byDate[d] = { count: 0, total: 0 }
    byDate[d].count++
    byDate[d].total += tx.amount
  }
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-10) // Last 10 days
    .forEach(([date, stats]) => {
      console.log(`  ${date}: ${stats.count.toString().padStart(5)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })
}

testBillingSync().catch(console.error)
