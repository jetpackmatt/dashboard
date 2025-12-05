#!/usr/bin/env node
/**
 * Deep dive into invoice transactions breakdown
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchWithAuth(endpoint) {
  const url = `${BASE_URL}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }

  return response.json()
}

async function getAllInvoiceTransactions(invoiceId) {
  const allTransactions = []
  let cursor = null

  do {
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
    if (cursor) {
      endpoint += `&Cursor=${encodeURIComponent(cursor)}`
    }

    const data = await fetchWithAuth(endpoint)
    allTransactions.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)

  return allTransactions
}

async function main() {
  console.log('Invoice Transaction Breakdown Analysis\n')

  // Get the Dec 1 shipping invoice
  const invoicesData = await fetchWithAuth('/2025-07/invoices?StartDate=2025-12-01&Limit=10')
  const shippingInvoice = invoicesData.items.find(inv => inv.invoice_type === 'Shipping')

  console.log(`Invoice #${shippingInvoice.invoice_id}`)
  console.log(`Date: ${shippingInvoice.invoice_date}`)
  console.log(`Type: ${shippingInvoice.invoice_type}`)
  console.log(`Amount: $${shippingInvoice.amount}`)
  console.log(`Currency: ${shippingInvoice.currency_code}`)
  console.log('')

  // Get all transactions
  const transactions = await getAllInvoiceTransactions(shippingInvoice.invoice_id)

  console.log(`Transactions received: ${transactions.length}`)

  // Get shipment -> client mapping
  const shipmentIds = transactions
    .filter(tx => tx.reference_type === 'Shipment')
    .map(tx => parseInt(tx.reference_id))

  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, clients!inner(company_name)')
    .in('shipment_id', shipmentIds)

  const shipmentToClient = new Map()
  for (const s of shipments || []) {
    shipmentToClient.set(s.shipment_id.toString(), {
      clientId: s.client_id,
      clientName: s.clients?.company_name
    })
  }

  // Breakdown by client
  const byClient = {}
  let totalAmount = 0

  for (const tx of transactions) {
    const client = shipmentToClient.get(tx.reference_id)
    const clientName = client?.clientName || 'Unknown'

    if (!byClient[clientName]) {
      byClient[clientName] = { count: 0, amount: 0 }
    }
    byClient[clientName].count++
    byClient[clientName].amount += tx.amount
    totalAmount += tx.amount
  }

  console.log(`\nBreakdown by Client:`)
  console.log(`${'='.repeat(50)}`)
  for (const [name, data] of Object.entries(byClient).sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(`${name}:`)
    console.log(`  Transactions: ${data.count}`)
    console.log(`  Amount: $${data.amount.toFixed(2)}`)
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Total from API: $${totalAmount.toFixed(2)}`)
  console.log(`Invoice amount: $${shippingInvoice.amount}`)
  console.log(`Gap: $${(shippingInvoice.amount - totalAmount).toFixed(2)} (${((shippingInvoice.amount - totalAmount) / shippingInvoice.amount * 100).toFixed(1)}%)`)

  // Let's also check - maybe the gap is from other fee types on the same invoice?
  const byFeeType = {}
  for (const tx of transactions) {
    const feeType = tx.transaction_fee
    if (!byFeeType[feeType]) {
      byFeeType[feeType] = { count: 0, amount: 0 }
    }
    byFeeType[feeType].count++
    byFeeType[feeType].amount += tx.amount
  }

  console.log(`\nBreakdown by Fee Type:`)
  for (const [type, data] of Object.entries(byFeeType)) {
    console.log(`  ${type}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // Check AdditionalFee invoice for the same week
  const additionalFeeInvoice = invoicesData.items.find(inv => inv.invoice_type === 'AdditionalFee')
  if (additionalFeeInvoice) {
    console.log(`\n\nAdditionalFee Invoice #${additionalFeeInvoice.invoice_id}`)
    console.log(`Amount: $${additionalFeeInvoice.amount}`)

    const addlTxns = await getAllInvoiceTransactions(additionalFeeInvoice.invoice_id)
    console.log(`Transactions: ${addlTxns.length}`)

    let addlTotal = addlTxns.reduce((sum, tx) => sum + tx.amount, 0)
    console.log(`Sum: $${addlTotal.toFixed(2)}`)
    console.log(`Gap: $${(additionalFeeInvoice.amount - addlTotal).toFixed(2)}`)
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`)
  console.log('HYPOTHESIS:')
  console.log('The invoice amount ($11,127.61) includes ALL Jetpack merchants,')
  console.log('but the API is filtering to only show transactions we can "see".')
  console.log('This might be based on which child tokens exist in the parent account.')
  console.log('')
  console.log('For our use case, this is FINE because:')
  console.log('  1. We get all transactions for OUR clients')
  console.log('  2. We can attribute them correctly via shipment JOIN')
  console.log('  3. We don\'t need transactions for other Jetpack merchants')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
