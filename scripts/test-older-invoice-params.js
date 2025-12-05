#!/usr/bin/env node
/**
 * Try different parameters on older invoices
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function testEndpoint(desc, endpoint) {
  console.log(`\n${desc}`)
  console.log(`  URL: ${endpoint}`)

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  console.log(`  Status: ${response.status}`)

  if (response.ok) {
    const data = await response.json()
    const items = data.items || (Array.isArray(data) ? data : [])
    console.log(`  Items: ${items.length}`)
    console.log(`  Has next: ${!!data.next}`)
    if (items[0]) {
      console.log(`  Sample: ${JSON.stringify(items[0]).substring(0, 150)}...`)
    }
  } else {
    const text = await response.text()
    console.log(`  Error: ${text.substring(0, 200)}`)
  }
}

async function main() {
  console.log('Testing different parameters on older invoices')

  const NOV_24_INVOICE = 8595597  // This one returns 0 transactions
  const DEC_1_INVOICE = 8633612   // This one works

  // Try different Limit values
  await testEndpoint('Nov 24 with Limit=1000', `/2025-07/invoices/${NOV_24_INVOICE}/transactions?Limit=1000`)
  await testEndpoint('Nov 24 with Limit=50', `/2025-07/invoices/${NOV_24_INVOICE}/transactions?Limit=50`)
  await testEndpoint('Nov 24 with no Limit', `/2025-07/invoices/${NOV_24_INVOICE}/transactions`)

  // Try different parameter names (maybe case sensitivity?)
  await testEndpoint('Nov 24 with limit (lowercase)', `/2025-07/invoices/${NOV_24_INVOICE}/transactions?limit=100`)

  // Try getting invoice details to confirm it exists
  await testEndpoint('Nov 24 invoice details', `/2025-07/invoices/${NOV_24_INVOICE}`)

  // Check if AdditionalFee invoice has same issue
  const NOV_24_ADDL = 8595606
  await testEndpoint('Nov 24 AdditionalFee txns', `/2025-07/invoices/${NOV_24_ADDL}/transactions?Limit=100`)

  // Check Nov 17 Storage invoice (storage was 100% on Dec 1)
  const NOV_17_STORAGE = 8564594
  await testEndpoint('Nov 17 Storage txns', `/2025-07/invoices/${NOV_17_STORAGE}/transactions?Limit=100`)

  // Try Credits invoice
  const NOV_24_CREDITS = 8595619
  await testEndpoint('Nov 24 Credits txns', `/2025-07/invoices/${NOV_24_CREDITS}/transactions?Limit=100`)

  // Let's also check if we can see the transaction-fees endpoint for context
  await testEndpoint('Transaction fee types', `/2025-07/transaction-fees`)

  console.log('\n\n' + '═'.repeat(60))
  console.log('FINAL CHECK: Verify Dec 1 still works')
  console.log('═'.repeat(60))
  await testEndpoint('Dec 1 Shipping txns', `/2025-07/invoices/${DEC_1_INVOICE}/transactions?Limit=10`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
