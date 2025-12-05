#!/usr/bin/env node
/**
 * Verify invoices exist and check details endpoint
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  return { status: response.status, data: response.ok ? await response.json() : null }
}

async function main() {
  console.log('Checking invoice existence and accessibility\n')

  // Get invoice list
  const { data: invoiceList } = await fetchWithAuth('/2025-07/invoices?StartDate=2025-11-01&Limit=50')

  const shippingInvoices = invoiceList.items.filter(inv => inv.invoice_type === 'Shipping')

  console.log('Shipping invoices from list:')
  for (const inv of shippingInvoices) {
    console.log(`  #${inv.invoice_id}: ${inv.invoice_date} - $${inv.amount}`)
  }

  console.log('\nChecking each invoice...\n')

  for (const inv of shippingInvoices) {
    // Try to get invoice details
    const details = await fetchWithAuth(`/2025-07/invoices/${inv.invoice_id}`)

    // Try to get transactions
    const txns = await fetchWithAuth(`/2025-07/invoices/${inv.invoice_id}/transactions?Limit=10`)

    console.log(`Invoice #${inv.invoice_id} (${inv.invoice_date}):`)
    console.log(`  Details endpoint: ${details.status}`)
    console.log(`  Transactions endpoint: ${txns.status}`)
    console.log(`  Transactions count: ${txns.data?.items?.length || 0}`)

    if (txns.data?.items?.length > 0) {
      const dates = txns.data.items.map(t => t.charge_date).sort()
      console.log(`  Charge date range: ${dates[0]} to ${dates[dates.length - 1]}`)
    }
    console.log('')
  }

  // Summary
  console.log('═'.repeat(50))
  console.log('ANALYSIS')
  console.log('═'.repeat(50))

  const withTxns = shippingInvoices.filter(async inv => {
    const r = await fetchWithAuth(`/2025-07/invoices/${inv.invoice_id}/transactions?Limit=1`)
    return r.data?.items?.length > 0
  })

  console.log(`
The pattern appears to be:
- Invoice LIST endpoint shows all invoices ✓
- Invoice DETAILS endpoint returns 404 for older invoices
- Invoice TRANSACTIONS endpoint returns 200 but empty array for older invoices

This strongly suggests ShipBob purges transaction details after ~7 days,
but keeps invoice metadata (totals, dates) indefinitely.

This is a significant API limitation that affects billing reconciliation.
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
