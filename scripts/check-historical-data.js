#!/usr/bin/env node
/**
 * Check if historical data exists - try different approaches
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
    },
  })
  return response.json()
}

async function main() {
  console.log('='.repeat(100))
  console.log('HISTORICAL DATA CHECK')
  console.log('='.repeat(100))

  // ============================================================
  // CHECK 1: Try specific older date ranges
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 1: SPECIFIC DATE RANGE QUERIES')
  console.log('█'.repeat(100))

  const ranges = [
    { start: '2025-11-01', end: '2025-11-30', desc: 'November 2025' },
    { start: '2025-10-01', end: '2025-10-31', desc: 'October 2025' },
    { start: '2025-09-01', end: '2025-09-30', desc: 'September 2025' },
    { start: '2025-06-01', end: '2025-06-30', desc: 'June 2025' },
    { start: '2025-03-01', end: '2025-03-31', desc: 'March 2025' },
    { start: '2024-12-01', end: '2024-12-31', desc: 'December 2024' },
  ]

  for (const range of ranges) {
    console.log('\n--- ' + range.desc + ' ---')

    // Invoices
    const invUrl = API_BASE + '/invoices?startDate=' + range.start + '&endDate=' + range.end + '&pageSize=100'
    const invData = await fetchJson(invUrl)
    const invoices = invData.items || []
    console.log('Invoices: ' + invoices.length)

    // Transactions
    const txData = await fetchJson(API_BASE + '/transactions:query', {
      method: 'POST',
      body: JSON.stringify({
        start_date: range.start,
        end_date: range.end,
        page_size: 100
      })
    })
    const txs = txData.items || []
    console.log('Transactions (first page): ' + txs.length)

    if (txs.length > 0) {
      const dates = txs.map(t => t.charge_date)
      console.log('  Date range: ' + Math.min(...dates.map(d => new Date(d).getTime())) + ' to ' + Math.max(...dates.map(d => new Date(d).getTime())))
      console.log('  Actual dates: ' + [...new Set(dates)].sort().join(', '))
    }
  }

  // ============================================================
  // CHECK 2: Get ALL invoices and list them
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 2: ALL INVOICES DETAIL')
  console.log('█'.repeat(100))

  const allInvUrl = API_BASE + '/invoices?startDate=2020-01-01&endDate=2025-12-31&pageSize=500'
  const allInvData = await fetchJson(allInvUrl)
  const allInvoices = allInvData.items || []

  console.log('\nTotal invoices: ' + allInvoices.length)
  console.log('\nAll invoices:')

  for (const inv of allInvoices.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))) {
    console.log('  ' + inv.invoice_date + ' | ' + inv.invoice_type.padEnd(20) + ' | $' + inv.amount.toFixed(2).padStart(10) + ' | ID: ' + inv.invoice_id)
  }

  // ============================================================
  // CHECK 3: Check oldest transaction in a specific invoice
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 3: OLDEST INVOICE TRANSACTIONS')
  console.log('█'.repeat(100))

  if (allInvoices.length > 0) {
    const oldestInvoice = allInvoices.sort((a, b) => a.invoice_date.localeCompare(b.invoice_date))[0]
    console.log('\nOldest invoice: ' + oldestInvoice.invoice_id + ' (' + oldestInvoice.invoice_date + ')')

    const txData = await fetchJson(API_BASE + '/invoices/' + oldestInvoice.invoice_id + '/transactions?pageSize=10')
    const txs = txData.items || []

    console.log('Transactions in oldest invoice: ' + txs.length)
    if (txs.length > 0) {
      console.log('Sample:')
      console.log(JSON.stringify(txs[0], null, 2))
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('FINDINGS')
  console.log('█'.repeat(100))

  if (allInvoices.length > 0) {
    const dates = allInvoices.map(i => i.invoice_date).sort()
    console.log('\nData available from: ' + dates[0] + ' to ' + dates[dates.length - 1])
    console.log('\nPossible explanations:')
    console.log('1. This token was created recently (around Nov 2025)')
    console.log('2. The ShipBob account was migrated or created recently')
    console.log('3. API only returns data since token creation')
    console.log('4. Billing data retention policy limits historical access')
  }
}

main().catch(console.error)
