#!/usr/bin/env node
/**
 * Test if we can get older pending transactions via sort options
 * The POST endpoint seems biased toward today's date
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryWithOptions(params, label) {
  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    const body = { ...params, page_size: 250 }
    if (cursor) body.cursor = cursor

    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      return { items: [], label, error: `${response.status}: ${text.substring(0, 100)}` }
    }

    const data = await response.json()
    for (const t of (data.items || [])) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
      }
    }

    cursor = data.next || null
    if (pageNum >= 20) break
    if ((data.items || []).every(t => seenIds.has(t.transaction_id))) break
  } while (cursor)

  return { items: allItems, label }
}

async function main() {
  console.log('Testing sort and filter options to get older pending transactions\n')
  console.log('═'.repeat(70))

  // Test various parameter combinations
  const tests = [
    { params: { invoiced_status: false }, label: 'Baseline (pending only)' },
    { params: { invoiced_status: false, sort_order: 'Ascending' }, label: 'Pending + Ascending' },
    { params: { invoiced_status: false, sort_order: 'Descending' }, label: 'Pending + Descending' },
    { params: { invoiced_status: false, sort_by: 'charge_date' }, label: 'Pending + sort by charge_date' },
    { params: { invoiced_status: false, sort_by: 'charge_date', sort_order: 'Ascending' }, label: 'Pending + charge_date asc' },
    { params: { invoiced_status: false, order_by: 'charge_date' }, label: 'Pending + order_by charge_date' },
  ]

  for (const test of tests) {
    const result = await queryWithOptions(test.params, test.label)

    if (result.error) {
      console.log(`\n${test.label}: ERROR - ${result.error}`)
      continue
    }

    // Group by date
    const byDate = {}
    for (const t of result.items) {
      const d = t.charge_date || 'null'
      byDate[d] = (byDate[d] || 0) + 1
    }

    console.log(`\n${test.label}: ${result.items.length} total`)
    for (const [d, c] of Object.entries(byDate).sort()) {
      console.log(`  ${d}: ${c}`)
    }
  }

  // Check what the actual pending invoice amounts are
  console.log('\n' + '═'.repeat(70))
  console.log('Checking what we SHOULD see...\n')

  // Get invoice list
  const invResponse = await fetch(
    `${BASE_URL}/2025-07/invoices?FromDate=2025-12-01&ToDate=2025-12-10&PageSize=20`,
    { headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` } }
  )

  if (invResponse.ok) {
    const invData = await invResponse.json()
    console.log('Recent/upcoming invoices:')
    for (const inv of (invData.items || [])) {
      console.log(`  ${inv.invoice_id}: ${inv.invoice_date} ${inv.invoice_type} $${inv.amount?.toFixed(2)}`)
    }
  }

  console.log('\n' + '═'.repeat(70))
  console.log('CONCLUSION')
  console.log('═'.repeat(70))
  console.log(`
The POST /transactions:query endpoint appears to have these limitations:
1. Returns max ~250-1000 transactions total across all filters
2. Biased heavily toward most recent dates
3. Ignores date filter parameters
4. Sort options may not be supported

This means for PENDING transactions (not yet on an invoice),
we can only reliably capture them by:
- Running sync VERY frequently (multiple times per hour)
- Accumulating transactions in our database over time
- Using the invoice endpoint on Monday to verify/reconcile
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
