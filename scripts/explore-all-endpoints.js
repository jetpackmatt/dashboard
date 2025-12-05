#!/usr/bin/env node
/**
 * Explore ALL billing endpoints systematically
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`
  console.log(`\n→ ${options.method || 'GET'} ${endpoint}`)

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  console.log(`  Status: ${response.status}`)
  return response.ok ? await response.json() : null
}

async function main() {
  console.log('Exploring ALL billing endpoints\n')
  console.log('═'.repeat(60))

  // 1. GET /invoices - with different date parameters
  console.log('\n1. GET /invoices - List invoices')
  console.log('─'.repeat(40))

  // Test with FromDate/ToDate (PascalCase from docs)
  const invoices = await fetchWithAuth('/2025-07/invoices?FromDate=2025-11-01&ToDate=2025-12-05&PageSize=10')
  if (invoices) {
    console.log(`  Items: ${invoices.items?.length || 0}`)
    console.log(`  Sample invoice:`)
    if (invoices.items?.[0]) {
      console.log(JSON.stringify(invoices.items[0], null, 4))
    }
    console.log(`  Response keys: ${Object.keys(invoices).join(', ')}`)
  }

  // 2. GET /invoices/{id} - Single invoice details
  console.log('\n2. GET /invoices/{id} - Single invoice (Dec 1)')
  console.log('─'.repeat(40))

  const singleInvoice = await fetchWithAuth('/2025-07/invoices/8633612')
  if (singleInvoice) {
    console.log(`  Response:`)
    console.log(JSON.stringify(singleInvoice, null, 4))
  } else {
    console.log('  No data (404?)')
  }

  // 3. GET /invoices/{id}/transactions - Already tested, but check response structure
  console.log('\n3. GET /invoices/{id}/transactions - Dec 1')
  console.log('─'.repeat(40))

  const txns = await fetchWithAuth('/2025-07/invoices/8633612/transactions?PageSize=5')
  if (txns) {
    console.log(`  Response keys: ${Object.keys(txns).join(', ')}`)
    console.log(`  Items: ${txns.items?.length || 0}`)
    if (txns.items?.[0]) {
      console.log(`  Sample transaction:`)
      console.log(JSON.stringify(txns.items[0], null, 4))
    }
  }

  // 4. GET /transaction-fees
  console.log('\n4. GET /transaction-fees')
  console.log('─'.repeat(40))

  const fees = await fetchWithAuth('/2025-07/transaction-fees')
  if (fees) {
    console.log(`  Response:`)
    console.log(JSON.stringify(fees, null, 4))
  }

  // 5. POST /transactions:query - Check all response fields
  console.log('\n5. POST /transactions:query')
  console.log('─'.repeat(40))

  const queryResult = await fetchWithAuth('/2025-07/transactions:query', {
    method: 'POST',
    body: JSON.stringify({
      invoice_ids: ['8633612'],
      page_size: 5
    })
  })

  if (queryResult) {
    console.log(`  Response keys: ${Object.keys(queryResult).join(', ')}`)
    console.log(`  Items: ${queryResult.items?.length || 0}`)
  }

  // 6. Try to get Nov 24 invoice through different paths
  console.log('\n6. Testing Nov 24 invoice (8595597) - different approaches')
  console.log('─'.repeat(40))

  // Direct invoice details
  const nov24Direct = await fetchWithAuth('/2025-07/invoices/8595597')
  console.log(`  Direct /invoices/8595597: ${nov24Direct ? 'found' : '404'}`)

  // Transactions
  const nov24Txns = await fetchWithAuth('/2025-07/invoices/8595597/transactions?PageSize=10')
  console.log(`  Transactions: ${nov24Txns?.items?.length || 0}`)

  // Query with invoice_id
  const nov24Query = await fetchWithAuth('/2025-07/transactions:query', {
    method: 'POST',
    body: JSON.stringify({ invoice_ids: ['8595597'], page_size: 10 })
  })
  console.log(`  POST query: ${nov24Query?.items?.length || 0}`)

  // 7. Check if there are any other endpoints mentioned in response links
  console.log('\n7. Checking for additional links in responses')
  console.log('─'.repeat(40))

  if (invoices) {
    console.log(`  Invoice list links: first=${!!invoices.first}, last=${!!invoices.last}, next=${!!invoices.next}, prev=${!!invoices.prev}`)
  }
  if (txns) {
    console.log(`  Transaction links: first=${!!txns.first}, last=${!!txns.last}, next=${!!txns.next}, prev=${!!txns.prev}`)
  }

  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
  console.log(`
Available endpoints and their status:
1. GET /invoices - ✅ Returns invoice metadata (no transaction details)
2. GET /invoices/{id} - ❌ Returns 404 for all invoices
3. GET /invoices/{id}/transactions - ⚠️ Works but limited to ~7 days
4. GET /transaction-fees - ✅ Returns list of fee types
5. POST /transactions:query - ⚠️ Works but has pagination bugs

Key finding: Invoice metadata is available for all dates,
but transaction DETAILS are only available for ~7 days.
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
