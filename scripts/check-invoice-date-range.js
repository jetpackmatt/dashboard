#!/usr/bin/env node
/**
 * Check the actual date range covered by the invoice
 * and compare to what we're getting from the API
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
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

async function getAllInvoiceTransactions(invoiceId) {
  const all = []
  let cursor = null
  do {
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`
    const data = await fetchWithAuth(endpoint)
    all.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)
  return all
}

async function main() {
  console.log('Checking invoice date ranges\n')

  // Get the invoice details
  const invoicesData = await fetchWithAuth('/2025-07/invoices?StartDate=2025-11-24&EndDate=2025-12-02&Limit=50')

  console.log('Invoices from API:')
  for (const inv of invoicesData.items || []) {
    console.log(`  #${inv.invoice_id}: ${inv.invoice_type} - $${inv.amount} (date: ${inv.invoice_date})`)
  }

  // Get all transactions for the shipping invoice
  const INVOICE_ID = 8633612
  console.log(`\n--- Analyzing Invoice #${INVOICE_ID} ---\n`)

  const transactions = await getAllInvoiceTransactions(INVOICE_ID)

  // Group transactions by charge_date
  const byDate = {}
  for (const tx of transactions) {
    const date = tx.charge_date || 'NULL'
    if (!byDate[date]) byDate[date] = { count: 0, amount: 0 }
    byDate[date].count++
    byDate[date].amount += tx.amount
  }

  console.log('Transactions by charge_date:')
  for (const [date, data] of Object.entries(byDate).sort()) {
    console.log(`  ${date}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // Check our shipments by date
  console.log('\n--- Our Database Shipments by Date ---\n')

  // Query shipments with order import date (which should have the actual date)
  const { data: shipments } = await supabase
    .from('shipments')
    .select(`
      shipment_id,
      shipped_date,
      orders!inner(order_import_date)
    `)
    .gte('orders.order_import_date', '2025-11-24')
    .lte('orders.order_import_date', '2025-12-01')
    .order('orders(order_import_date)', { ascending: true })

  // Group by order_import_date
  const shipmentsByDate = {}
  for (const s of shipments || []) {
    const date = s.orders?.order_import_date?.split('T')[0] || 'NULL'
    if (!shipmentsByDate[date]) shipmentsByDate[date] = { count: 0, ids: [] }
    shipmentsByDate[date].count++
    shipmentsByDate[date].ids.push(s.shipment_id)
  }

  console.log('Our shipments by order_import_date:')
  for (const [date, data] of Object.entries(shipmentsByDate).sort()) {
    console.log(`  ${date}: ${data.count} shipments`)
  }

  // Cross-reference: which of our Nov 24-26 shipments are NOT in the API transactions?
  console.log('\n--- Cross-Reference: Nov 24-26 Shipments ---\n')

  const apiShipmentIds = new Set(transactions.map(tx => tx.reference_id))

  let missingCount = 0
  let missingAmount = 0
  const missingByDate = {}

  for (const [date, data] of Object.entries(shipmentsByDate)) {
    if (date >= '2025-11-24' && date <= '2025-11-26') {
      const missing = data.ids.filter(id => !apiShipmentIds.has(String(id)))
      if (missing.length > 0) {
        missingByDate[date] = missing.length
        missingCount += missing.length
      }
    }
  }

  if (missingCount > 0) {
    console.log(`Missing shipments from Nov 24-26:`)
    for (const [date, count] of Object.entries(missingByDate)) {
      console.log(`  ${date}: ${count} shipments not in API response`)
    }
    console.log(`\nTotal missing: ${missingCount} shipments`)
  }

  // Check total shipments in invoice period vs API
  const totalOurShipments = Object.values(shipmentsByDate).reduce((sum, d) => sum + d.count, 0)

  console.log(`\n--- SUMMARY ---`)
  console.log(`Invoice date: Dec 1, 2025`)
  console.log(`API transactions span: Nov 27 - Dec 1 (${transactions.length} transactions)`)
  console.log(`Our DB shipments (Nov 24 - Dec 1): ${totalOurShipments}`)

  // Calculate what we should have
  const apiAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`\nAPI total: $${apiAmount.toFixed(2)}`)
  console.log(`Invoice total: $11,127.61`)
  console.log(`Gap: $${(11127.61 - apiAmount).toFixed(2)}`)

  // If the API only returns Nov 27+, we're missing Nov 24-26
  const nov24_26Shipments = Object.entries(shipmentsByDate)
    .filter(([date]) => date >= '2025-11-24' && date <= '2025-11-26')
    .reduce((sum, [, data]) => sum + data.count, 0)

  console.log(`\nShipments from Nov 24-26: ${nov24_26Shipments}`)
  console.log(`Shipments from Nov 27-Dec 1: ${totalOurShipments - nov24_26Shipments}`)

  // Estimate missing amount
  const avgPerShipment = apiAmount / transactions.length
  const estimatedMissing = nov24_26Shipments * avgPerShipment

  console.log(`\nAverage cost per shipment: $${avgPerShipment.toFixed(2)}`)
  console.log(`Estimated missing amount: $${estimatedMissing.toFixed(2)}`)
  console.log(`Actual gap: $${(11127.61 - apiAmount).toFixed(2)}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
