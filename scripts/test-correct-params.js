#!/usr/bin/env node
/**
 * Test POST /transactions:query with CORRECT parameter names
 * from_date / to_date (not start_date / end_date)
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params, description) {
  console.log(`\n--- ${description} ---`)
  console.log(`Parameters: ${JSON.stringify(params)}`)

  const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(params)
  })

  console.log(`Status: ${response.status}`)

  if (!response.ok) {
    const text = await response.text()
    console.log(`Error: ${text.substring(0, 200)}`)
    return null
  }

  const data = await response.json()
  const items = data.items || []

  console.log(`Items returned: ${items.length}`)
  console.log(`Has next: ${!!data.next}`)

  if (items.length > 0) {
    const dates = items.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]
    console.log(`Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)

    const total = items.reduce((sum, t) => sum + t.amount, 0)
    console.log(`Total amount: $${total.toFixed(2)}`)

    // Show invoiced status breakdown
    const invoiced = items.filter(t => t.invoiced_status).length
    const pending = items.filter(t => !t.invoiced_status).length
    console.log(`Invoiced: ${invoiced}, Pending: ${pending}`)
  }

  return data
}

async function main() {
  console.log('Testing POST /transactions:query with CORRECT parameters\n')
  console.log('Documentation says from_date default is "current - 7 days"')
  console.log('Let\'s try explicit date ranges further back...\n')

  // Test 1: No date params (should use defaults: last 7 days)
  await queryTransactions(
    { page_size: 100 },
    'Test 1: No date params (default = 7 days)'
  )

  // Test 2: Explicit from_date 14 days back
  const fourteenDaysAgo = new Date()
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

  await queryTransactions(
    {
      from_date: fourteenDaysAgo.toISOString(),
      to_date: new Date().toISOString(),
      page_size: 100
    },
    'Test 2: from_date = 14 days ago'
  )

  // Test 3: Explicit from_date 30 days back
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  await queryTransactions(
    {
      from_date: thirtyDaysAgo.toISOString(),
      to_date: new Date().toISOString(),
      page_size: 100
    },
    'Test 3: from_date = 30 days ago'
  )

  // Test 4: Query by invoice_ids (Nov 24 invoice)
  await queryTransactions(
    {
      invoice_ids: ['8595597'],  // Nov 24 shipping invoice
      page_size: 100
    },
    'Test 4: invoice_ids = [8595597] (Nov 24)'
  )

  // Test 5: Query by invoice_ids (Dec 1 invoice)
  await queryTransactions(
    {
      invoice_ids: ['8633612'],  // Dec 1 shipping invoice
      page_size: 100
    },
    'Test 5: invoice_ids = [8633612] (Dec 1)'
  )

  // Test 6: Query invoiced_status = true with extended date range
  await queryTransactions(
    {
      invoiced_status: true,
      from_date: thirtyDaysAgo.toISOString(),
      to_date: new Date().toISOString(),
      page_size: 100
    },
    'Test 6: invoiced_status=true, from_date=30 days ago'
  )

  // Test 7: Try date format without time (just YYYY-MM-DD)
  await queryTransactions(
    {
      from_date: '2025-11-24',
      to_date: '2025-12-01',
      page_size: 100
    },
    'Test 7: Date format YYYY-MM-DD (Nov 24 - Dec 1)'
  )

  // Test 8: Query specific reference_ids from Nov 24 period
  // (shipment IDs we know exist)
  await queryTransactions(
    {
      reference_ids: ['319900667', '319850000', '319800000'],
      page_size: 100
    },
    'Test 8: Specific reference_ids'
  )

  console.log('\n' + '═'.repeat(60))
  console.log('CONCLUSION')
  console.log('═'.repeat(60))
  console.log(`
If date filtering works:
  - Tests 2-3 should return data from beyond 7 days
  - Tests 4-5 should return invoice-specific data

If date filtering is ignored:
  - All tests return the same recent data regardless of params
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
