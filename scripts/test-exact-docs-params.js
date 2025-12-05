#!/usr/bin/env node
/**
 * Test POST /transactions:query with EXACT parameters from documentation
 *
 * Documented params:
 * - invoice_ids (array)
 * - transaction_types (array) - Charge, Refund
 * - start_date (string) - ISO 8601 e.g. 2024-06-01T00:00:00Z
 * - end_date (string) - ISO 8601 format
 * - reference_ids (array)
 *
 * For pagination, docs mention limit/offset for GET /invoices
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function testQuery(params, label) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Test: ${label}`)
  console.log(`Body: ${JSON.stringify(params)}`)

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
    console.log(`Error: ${text.substring(0, 300)}`)
    return null
  }

  const data = await response.json()
  const items = data.items || []

  console.log(`Items returned: ${items.length}`)
  console.log(`Response keys: ${Object.keys(data).join(', ')}`)

  if (items.length > 0) {
    // Check dates
    const dates = items.map(t => t.charge_date || t.insertDate || t.date).filter(Boolean)
    const uniqueDates = [...new Set(dates)].sort()
    console.log(`Dates in response: ${uniqueDates.join(', ')}`)

    // Check invoiced status
    const invoiced = items.filter(t => t.invoiced === true || t.invoiced_status === true).length
    const uninvoiced = items.filter(t => t.invoiced === false || t.invoiced_status === false).length
    console.log(`Invoiced: ${invoiced}, Uninvoiced: ${uninvoiced}`)

    // Sample item
    console.log(`\nSample item:`)
    console.log(JSON.stringify(items[0], null, 2))
  }

  return data
}

async function main() {
  console.log('Testing with EXACT parameters from ShipBob documentation\n')
  console.log('═'.repeat(60))

  // Test 1: No params (baseline)
  await testQuery({}, 'No params')

  // Test 2: Date range with FULL ISO 8601 format (as shown in docs)
  await testQuery({
    start_date: '2025-12-01T00:00:00Z',
    end_date: '2025-12-04T23:59:59Z'
  }, 'ISO 8601 dates with time')

  // Test 3: Just start_date
  await testQuery({
    start_date: '2025-12-01T00:00:00Z'
  }, 'Just start_date')

  // Test 4: transaction_types as documented
  await testQuery({
    transaction_types: ['Charge']
  }, 'transaction_types: Charge')

  // Test 5: Combination
  await testQuery({
    transaction_types: ['Charge'],
    start_date: '2025-12-01T00:00:00Z',
    end_date: '2025-12-04T23:59:59Z'
  }, 'Charge + date range')

  // Test 6: Try with limit/offset (from GET /invoices docs)
  await testQuery({
    limit: 500,
    offset: 0
  }, 'With limit/offset')

  // Test 7: Try reference_ids with a known shipment
  await testQuery({
    reference_ids: ['324170170']  // From earlier sample
  }, 'reference_ids filter')

  // Test 8: Empty arrays
  await testQuery({
    invoice_ids: [],
    transaction_types: [],
    reference_ids: []
  }, 'Empty arrays')

  // Test 9: Large limit
  await testQuery({
    limit: 10000
  }, 'Large limit')

  console.log('\n' + '═'.repeat(60))
  console.log('Also fetching llms.txt for more info...')
  console.log('═'.repeat(60))

  // Fetch llms.txt as mentioned in docs
  try {
    const llmsResponse = await fetch('https://developer.shipbob.com/llms.txt')
    if (llmsResponse.ok) {
      const text = await llmsResponse.text()
      console.log('\nllms.txt contents (first 2000 chars):')
      console.log(text.substring(0, 2000))
    }
  } catch (e) {
    console.log('Could not fetch llms.txt')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
