#!/usr/bin/env node
/**
 * Explore ShipBob Billing API
 *
 * Fetches sample transactions from EVERY invoice type to understand
 * what data is available directly from the API.
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
  return response.json()
}

async function main() {
  console.log('=== ShipBob Billing API Explorer ===\n')

  // 1. Get list of all invoice types we've seen
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90) // Last 90 days
  const endDate = new Date()

  console.log(`Fetching invoices from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...\n`)

  // Fetch all invoices
  const params = new URLSearchParams({
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    pageSize: '250'
  })

  const invoicesData = await fetchJson(`${API_BASE}/invoices?${params}`)
  const invoices = invoicesData.items || []

  console.log(`Found ${invoices.length} invoices\n`)

  // Group by type
  const byType = {}
  for (const inv of invoices) {
    if (!byType[inv.invoice_type]) {
      byType[inv.invoice_type] = []
    }
    byType[inv.invoice_type].push(inv)
  }

  console.log('Invoice types found:')
  for (const [type, list] of Object.entries(byType)) {
    const total = list.reduce((s, inv) => s + inv.amount, 0)
    console.log(`  ${type}: ${list.length} invoices, total $${total.toFixed(2)}`)
  }

  console.log('\n' + '='.repeat(80))

  // 2. For each type, get sample transactions
  for (const [invoiceType, invoiceList] of Object.entries(byType)) {
    console.log(`\n### ${invoiceType.toUpperCase()} ###\n`)

    // Skip Payment type (no transactions)
    if (invoiceType === 'Payment') {
      console.log('(Payment invoices have no transactions - they are just payments)\n')

      // Show invoice structure
      const sampleInvoice = invoiceList[0]
      console.log('Sample Invoice:')
      console.log(JSON.stringify(sampleInvoice, null, 2))
      continue
    }

    // Get a recent invoice of this type
    const sampleInvoice = invoiceList[0]
    console.log(`Sample Invoice ID: ${sampleInvoice.invoice_id}`)
    console.log(`Invoice Date: ${sampleInvoice.invoice_date}`)
    console.log(`Amount: $${sampleInvoice.amount}`)

    // Fetch transactions for this invoice
    const txUrl = `${API_BASE}/invoices/${sampleInvoice.invoice_id}/transactions?pageSize=5`
    const txData = await fetchJson(txUrl)
    const transactions = txData.items || txData || []

    console.log(`\nTransactions in this invoice: ${transactions.length > 5 ? '5+ (showing first 5)' : transactions.length}`)

    if (transactions.length > 0) {
      // Show FULL structure of first transaction
      console.log('\n--- FULL TRANSACTION STRUCTURE ---')
      console.log(JSON.stringify(transactions[0], null, 2))

      // If there are more, show just the fee types
      if (transactions.length > 1) {
        console.log('\n--- Other transactions in this invoice (summary) ---')
        for (let i = 1; i < Math.min(5, transactions.length); i++) {
          const tx = transactions[i]
          console.log(`  ${i + 1}. ${tx.transaction_fee}: $${tx.amount} (ref: ${tx.reference_id}, type: ${tx.reference_type})`)
        }
      }
    } else {
      console.log('  (No transactions found for this invoice)')
    }

    console.log('\n' + '-'.repeat(80))
  }

  // 3. Also fetch pending (uninvoiced) transactions
  console.log('\n### PENDING (UNINVOICED) TRANSACTIONS ###\n')

  const pendingData = await fetchJson(`${API_BASE}/transactions:query`, {
    method: 'POST',
    body: JSON.stringify({
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      page_size: 10
    })
  })

  const pendingTxs = pendingData.items || []
  console.log(`Found ${pendingTxs.length} pending transactions (showing first 10)`)

  if (pendingTxs.length > 0) {
    console.log('\n--- FULL PENDING TRANSACTION STRUCTURE ---')
    console.log(JSON.stringify(pendingTxs[0], null, 2))

    // Group by transaction_fee to see variety
    const byFee = {}
    for (const tx of pendingTxs) {
      byFee[tx.transaction_fee] = (byFee[tx.transaction_fee] || 0) + 1
    }
    console.log('\nTransaction fee types in pending:')
    for (const [fee, count] of Object.entries(byFee)) {
      console.log(`  ${fee}: ${count}`)
    }
  }

  // 4. List all available transaction fee types
  console.log('\n' + '='.repeat(80))
  console.log('\n### ALL TRANSACTION FEE TYPES ###\n')

  const feeTypesData = await fetchJson(`${API_BASE}/transaction-fees`)
  const feeTypes = feeTypesData.items || feeTypesData || []

  console.log(`Total fee types available: ${feeTypes.length}`)
  console.log('\nFirst 20:')
  for (let i = 0; i < Math.min(20, feeTypes.length); i++) {
    console.log(`  ${i + 1}. ${JSON.stringify(feeTypes[i])}`)
  }

  if (feeTypes.length > 20) {
    console.log(`  ... and ${feeTypes.length - 20} more`)
  }
}

main().catch(console.error)
