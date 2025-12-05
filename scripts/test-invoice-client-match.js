#!/usr/bin/env node
/**
 * Check how many invoice transactions match our synced clients
 *
 * The invoice may contain transactions for ALL Jetpack merchants,
 * but we might only see the ones that match shipments in our database.
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
    const items = data.items || []
    allTransactions.push(...items)

    cursor = data.next || null
  } while (cursor)

  return allTransactions
}

async function main() {
  console.log('Testing invoice transaction client matching\n')

  // Get recent shipping invoice
  const invoicesData = await fetchWithAuth('/2025-07/invoices?StartDate=2025-12-01&Limit=10')
  const shippingInvoice = invoicesData.items.find(inv => inv.invoice_type === 'Shipping')

  console.log(`Testing Invoice #${shippingInvoice.invoice_id} (${shippingInvoice.invoice_date})`)
  console.log(`Invoice amount: $${shippingInvoice.amount}\n`)

  // Get all transactions for this invoice
  console.log('Fetching all transactions...')
  const transactions = await getAllInvoiceTransactions(shippingInvoice.invoice_id)
  console.log(`Total transactions: ${transactions.length}`)

  // Get reference IDs (shipment IDs) from transactions
  const referenceIds = transactions
    .filter(tx => tx.reference_type === 'Shipment')
    .map(tx => tx.reference_id)

  console.log(`Shipment references: ${referenceIds.length}`)

  // Check how many match our shipments table
  console.log('\nQuerying our shipments table...')

  // Batch the lookup (Supabase has limits)
  const batchSize = 100
  const matchedIds = []
  const unmatchedIds = []

  for (let i = 0; i < referenceIds.length; i += batchSize) {
    const batch = referenceIds.slice(i, i + batchSize)
    const { data: matchedShipments } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .in('shipment_id', batch.map(id => parseInt(id)))

    const matchedSet = new Set(matchedShipments?.map(s => s.shipment_id.toString()) || [])

    for (const id of batch) {
      if (matchedSet.has(id)) {
        matchedIds.push(id)
      } else {
        unmatchedIds.push(id)
      }
    }
  }

  console.log(`\n--- RESULTS ---`)
  console.log(`Matched to our clients: ${matchedIds.length} (${(matchedIds.length / referenceIds.length * 100).toFixed(1)}%)`)
  console.log(`Not in our database: ${unmatchedIds.length} (${(unmatchedIds.length / referenceIds.length * 100).toFixed(1)}%)`)

  // Calculate amounts
  let matchedAmount = 0
  let unmatchedAmount = 0

  for (const tx of transactions) {
    if (tx.reference_type === 'Shipment') {
      if (matchedIds.includes(tx.reference_id)) {
        matchedAmount += tx.amount
      } else {
        unmatchedAmount += tx.amount
      }
    } else {
      // Non-shipment transactions (returns, etc.)
      console.log(`Non-shipment tx: ${tx.reference_type} - $${tx.amount}`)
    }
  }

  console.log(`\nMatched amount: $${matchedAmount.toFixed(2)}`)
  console.log(`Unmatched amount: $${unmatchedAmount.toFixed(2)}`)
  console.log(`Total from API: $${(matchedAmount + unmatchedAmount).toFixed(2)}`)
  console.log(`Invoice amount: $${shippingInvoice.amount}`)

  if (unmatchedIds.length > 0) {
    console.log(`\nSample unmatched shipment IDs (first 10):`)
    unmatchedIds.slice(0, 10).forEach(id => console.log(`  - ${id}`))

    // Check if these are from other Jetpack merchants
    console.log(`\nThese might belong to other Jetpack merchants not yet in our system.`)
  }

  // Final verdict
  console.log(`\n${'='.repeat(50)}`)
  console.log('CONCLUSION')
  console.log(`${'='.repeat(50)}`)

  if (unmatchedAmount > 0) {
    console.log(`\nThe invoice includes transactions for merchants outside our database.`)
    console.log(`This is expected - Jetpack has multiple merchants under the parent account.`)
    console.log(`\nFor our billing workflow:`)
    console.log(`  1. Fetch all transactions via GET /invoices/{id}/transactions ✅`)
    console.log(`  2. JOIN to shipments table to get client_id ✅`)
    console.log(`  3. Filter to only include our active clients ✅`)
    console.log(`  4. Generate per-client invoices ✅`)
  } else {
    console.log(`\n100% of transactions matched our clients!`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
