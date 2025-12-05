#!/usr/bin/env node
/**
 * Find the actual data window for the ShipBob billing API
 * How far back can we retrieve transaction details?
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint) {
  const url = `${BASE_URL}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

async function getTransactionCount(invoiceId) {
  const data = await fetchWithAuth(`/2025-07/invoices/${invoiceId}/transactions?Limit=10`)
  return {
    count: data.items?.length || 0,
    hasMore: !!data.next,
    sample: data.items?.[0]
  }
}

async function main() {
  console.log('Finding ShipBob API data window\n')

  // Get all invoices from last 90 days
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const invoicesData = await fetchWithAuth(`/2025-07/invoices?StartDate=${startDate.toISOString().split('T')[0]}&Limit=100`)
  const invoices = invoicesData.items || []

  // Filter to Shipping invoices only (most consistent)
  const shippingInvoices = invoices.filter(inv => inv.invoice_type === 'Shipping')

  console.log(`Found ${shippingInvoices.length} shipping invoices\n`)

  console.log('Invoice ID    | Date       | Amount      | Txns  | Has More')
  console.log('-'.repeat(65))

  for (const inv of shippingInvoices) {
    try {
      const result = await getTransactionCount(inv.invoice_id)
      const hasMoreStr = result.hasMore ? 'Yes' : 'No'
      const txnStr = result.count.toString().padStart(4)

      console.log(`${inv.invoice_id}  | ${inv.invoice_date} | $${inv.amount.toFixed(2).padStart(10)} | ${txnStr} | ${hasMoreStr}`)

      // If we found transactions, show the charge date range
      if (result.count > 0 && result.sample) {
        console.log(`              | Sample charge_date: ${result.sample.charge_date}`)
      }
    } catch (err) {
      console.log(`${inv.invoice_id}  | ${inv.invoice_date} | $${inv.amount.toFixed(2).padStart(10)} | ERROR: ${err.message}`)
    }
  }

  // Also check AdditionalFee invoices
  console.log('\n--- AdditionalFee Invoices ---\n')
  const addlInvoices = invoices.filter(inv => inv.invoice_type === 'AdditionalFee')

  for (const inv of addlInvoices.slice(0, 5)) {
    try {
      const result = await getTransactionCount(inv.invoice_id)
      console.log(`${inv.invoice_id}  | ${inv.invoice_date} | $${inv.amount.toFixed(2).padStart(10)} | ${result.count.toString().padStart(4)} txns`)
    } catch (err) {
      console.log(`${inv.invoice_id}  | ${inv.invoice_date} | ERROR`)
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(65))
  console.log('CONCLUSION')
  console.log('═'.repeat(65))

  const withData = shippingInvoices.filter(inv => inv.invoice_date >= '2025-11-27')
  const withoutData = shippingInvoices.filter(inv => inv.invoice_date < '2025-11-27')

  console.log(`
Invoices with transaction data: those from ~Nov 27 onwards
Invoices WITHOUT transaction data: those before ~Nov 27

This suggests the API has a ~7 day rolling window for transaction details.
Or there's a date-based cutoff around Nov 27, 2025.

Today is: ${new Date().toISOString().split('T')[0]}
Days since Nov 27: ${Math.floor((Date.now() - new Date('2025-11-27').getTime()) / (1000 * 60 * 60 * 24))}
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
