#!/usr/bin/env node
/**
 * Analyze what POST /transactions:query with invoice_ids is actually returning
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function main() {
  console.log('Analyzing POST /transactions:query response for invoice_ids=[8633612]\n')

  // Get first 500 transactions
  const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      invoice_ids: ['8633612'],
      page_size: 500
    })
  })

  const data = await response.json()
  const items = data.items || []

  console.log(`Returned ${items.length} transactions`)
  console.log(`Has next page: ${!!data.next}\n`)

  // Check invoice_id field in the transactions
  const invoiceIds = new Set(items.map(t => t.invoice_id))
  console.log(`Unique invoice_ids in response: ${invoiceIds.size}`)
  console.log(`Invoice IDs: ${[...invoiceIds].join(', ')}\n`)

  // Group by invoice_id
  const byInvoice = {}
  for (const t of items) {
    const invId = t.invoice_id || 'null'
    if (!byInvoice[invId]) byInvoice[invId] = { count: 0, amount: 0 }
    byInvoice[invId].count++
    byInvoice[invId].amount += t.amount
  }

  console.log('Breakdown by invoice_id:')
  for (const [id, data] of Object.entries(byInvoice).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${id}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // Check invoice types
  const byInvoiceType = {}
  for (const t of items) {
    const type = t.invoice_type || 'null'
    if (!byInvoiceType[type]) byInvoiceType[type] = { count: 0, amount: 0 }
    byInvoiceType[type].count++
    byInvoiceType[type].amount += t.amount
  }

  console.log('\nBreakdown by invoice_type:')
  for (const [type, data] of Object.entries(byInvoiceType).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${type}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // Check date range
  const dates = items.map(t => t.charge_date).filter(Boolean).sort()
  console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}`)

  // Check invoiced status
  const invoiced = items.filter(t => t.invoiced_status).length
  const pending = items.filter(t => !t.invoiced_status).length
  console.log(`\nInvoiced: ${invoiced}, Pending: ${pending}`)

  // Sample transaction
  console.log('\nSample transaction:')
  console.log(JSON.stringify(items[0], null, 2))

  // Check if invoice_id matches what we requested
  console.log('\n═'.repeat(50))
  console.log('ANALYSIS')
  console.log('═'.repeat(50))

  if (invoiceIds.size === 1 && invoiceIds.has(8633612)) {
    console.log('\n✅ All transactions are from invoice #8633612')
  } else {
    console.log('\n⚠️ Transactions are from MULTIPLE invoices!')
    console.log('The invoice_ids filter may not be working as expected')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
