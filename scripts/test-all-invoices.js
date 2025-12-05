#!/usr/bin/env node
/**
 * Test fetching transactions from ALL invoices to understand full coverage
 */
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function test() {
  console.log('=== Analyzing All Invoice Transaction Counts ===\n')

  // Get all invoices from last 30 days
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)
  const endDate = new Date()

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

  console.log(`Found ${invoices.length} invoices\n`)

  // Group by date and type
  const byDate = {}
  for (const inv of invoices) {
    const d = inv.invoice_date
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(inv)
  }

  // Fetch transactions for EVERY non-Payment invoice
  console.log('Fetching transactions for each invoice...\n')
  const seenTxIds = new Set()
  let totalFromInvoices = 0
  let totalAmount = 0

  for (const [date, invs] of Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]))) {
    console.log(`\n${date}:`)

    for (const inv of invs) {
      if (inv.invoice_type === 'Payment') {
        console.log(`  ${inv.invoice_id} ${inv.invoice_type.padEnd(22)} $${inv.amount.toFixed(2).padStart(12)} (payment - no tx)`)
        continue
      }

      const txResponse = await fetch(`https://api.shipbob.com/2025-07/invoices/${inv.invoice_id}/transactions?pageSize=1000`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      })
      const txData = await txResponse.json()
      const items = txData.items || txData || []

      if (!Array.isArray(items)) {
        console.log(`  ${inv.invoice_id} ${inv.invoice_type.padEnd(22)} $${inv.amount.toFixed(2).padStart(12)} → ERROR`)
        continue
      }

      // Count unique transactions
      let newCount = 0
      let txTotal = 0
      for (const tx of items) {
        txTotal += tx.amount
        if (!seenTxIds.has(tx.transaction_id)) {
          seenTxIds.add(tx.transaction_id)
          newCount++
          totalFromInvoices++
          totalAmount += tx.amount
        }
      }

      const hasMore = items.length >= 1000 ? ' ⚠️ LIMIT' : ''
      console.log(`  ${inv.invoice_id} ${inv.invoice_type.padEnd(22)} $${inv.amount.toFixed(2).padStart(12)} → ${items.length.toString().padStart(4)} tx ($${txTotal.toFixed(2)})${hasMore}`)
    }
  }

  console.log('\n\n=== SUMMARY ===')
  console.log(`Total unique transactions from invoices: ${totalFromInvoices}`)
  console.log(`Total amount from invoice transactions: $${totalAmount.toFixed(2)}`)
  console.log(`Invoice dates covered: ${Object.keys(byDate).sort().join(', ')}`)

  // Compare to pending
  console.log('\n\nFetching pending transactions...')
  const pendingResponse = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ page_size: 1000 })
  })
  const pendingData = await pendingResponse.json()
  const pending = pendingData.items || []
  const pendingTotal = pending.reduce((s, t) => s + t.amount, 0)

  // Count truly new pending
  let newPending = 0
  for (const tx of pending) {
    if (!seenTxIds.has(tx.transaction_id)) {
      seenTxIds.add(tx.transaction_id)
      newPending++
    }
  }

  console.log(`Pending transactions: ${pending.length} (${newPending} new, not in invoices)`)
  console.log(`Pending total: $${pendingTotal.toFixed(2)}`)

  console.log('\n\n=== GRAND TOTAL ===')
  console.log(`All unique transactions: ${seenTxIds.size}`)
  console.log(`From invoices: ${totalFromInvoices}`)
  console.log(`From pending: ${newPending}`)
}

test().catch(console.error)
