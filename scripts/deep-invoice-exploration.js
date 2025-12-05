#!/usr/bin/env node
/**
 * Deep exploration of invoice and transaction endpoints
 * Looking for ANY additional fields that might contain breakdown
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithHeaders(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  const data = response.ok ? await response.json() : null
  return {
    status: response.status,
    data,
    headers: Object.fromEntries(response.headers)
  }
}

async function main() {
  console.log('═'.repeat(100))
  console.log('DEEP INVOICE/TRANSACTION EXPLORATION')
  console.log('═'.repeat(100))

  const testInvoiceId = 8633612  // Dec 1 Shipping invoice
  const testOrderId = '320860433'

  // ═══════════════════════════════════════════════════════════════════════════
  // Check GET /invoices/{id}/transactions with different params
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('GET /invoices/{id}/transactions - DETAILED')
  console.log('█'.repeat(80))

  // Try with different parameters
  const invoiceTxParams = [
    '',
    '?PageSize=10',
    '?PageSize=10&IncludeDetails=true',
    '?PageSize=10&includeDetails=true',
    '?PageSize=10&expand=all',
    '?PageSize=10&fields=all',
    '?PageSize=10&detail=full',
  ]

  for (const params of invoiceTxParams) {
    const url = `${BASE_URL}/2025-07/invoices/${testInvoiceId}/transactions${params}`
    console.log(`\n--- ${params || '(no params)'} ---`)

    const result = await fetchWithHeaders(url)
    console.log(`Status: ${result.status}`)

    if (result.data?.items?.[0]) {
      const tx = result.data.items.find(t => t.reference_id === testOrderId) || result.data.items[0]
      console.log('Sample transaction:')
      console.log(JSON.stringify(tx, null, 2))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Check GET /invoices/{id} - maybe invoice has breakdown summary
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('GET /invoices/{id} - INVOICE DETAIL')
  console.log('█'.repeat(80))

  const invoiceDetailParams = [
    '',
    '?IncludeDetails=true',
    '?expand=transactions',
    '?expand=all',
  ]

  for (const params of invoiceDetailParams) {
    const url = `${BASE_URL}/2025-07/invoices/${testInvoiceId}${params}`
    console.log(`\n--- ${params || '(no params)'} ---`)

    const result = await fetchWithHeaders(url)
    console.log(`Status: ${result.status}`)

    if (result.data) {
      console.log('Response:')
      console.log(JSON.stringify(result.data, null, 2))
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Check POST /transactions:query with different body params
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('POST /transactions:query - DIFFERENT PARAMS')
  console.log('█'.repeat(80))

  const queryBodies = [
    { reference_ids: [testOrderId], page_size: 10 },
    { reference_ids: [testOrderId], page_size: 10, include_details: true },
    { reference_ids: [testOrderId], page_size: 10, includeDetails: true },
    { reference_ids: [testOrderId], page_size: 10, expand: 'all' },
    { reference_ids: [testOrderId], page_size: 10, detail_level: 'full' },
  ]

  for (const body of queryBodies) {
    console.log(`\n--- Body: ${JSON.stringify(body)} ---`)

    const result = await fetchWithHeaders(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      body: JSON.stringify(body)
    })

    console.log(`Status: ${result.status}`)

    if (result.data?.items?.length > 0) {
      const shippingTx = result.data.items.find(t => t.transaction_fee === 'Shipping')
      if (shippingTx) {
        console.log('Shipping transaction:')
        console.log(JSON.stringify(shippingTx, null, 2))
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Check response headers for pagination/API hints
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('CHECKING RESPONSE HEADERS')
  console.log('█'.repeat(80))

  const headerCheck = await fetchWithHeaders(`${BASE_URL}/2025-07/invoices/${testInvoiceId}/transactions?PageSize=5`)
  console.log('\nResponse headers:')
  for (const [key, value] of Object.entries(headerCheck.headers)) {
    if (!key.startsWith('x-') && !['date', 'server', 'content-type', 'content-length'].includes(key)) continue
    console.log(`  ${key}: ${value}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Try fetching llms.txt for API documentation
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('FETCHING API DOCUMENTATION')
  console.log('█'.repeat(80))

  try {
    const llmsResponse = await fetch('https://developer.shipbob.com/llms.txt')
    if (llmsResponse.ok) {
      const text = await llmsResponse.text()
      console.log('\nllms.txt (searching for "breakdown", "surcharge", "fulfillment"):')

      const lines = text.split('\n')
      for (const line of lines) {
        if (line.toLowerCase().includes('breakdown') ||
            line.toLowerCase().includes('surcharge') ||
            line.toLowerCase().includes('fulfillment') ||
            line.toLowerCase().includes('charge')) {
          console.log(`  ${line}`)
        }
      }
    }
  } catch (e) {
    console.log('Could not fetch llms.txt')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Check if there's a billing/reports endpoint mentioned
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('CHECKING BILLING API GUIDE')
  console.log('█'.repeat(80))

  try {
    const guideResponse = await fetch('https://developer.shipbob.com/guides/billing')
    if (guideResponse.ok) {
      const text = await guideResponse.text()

      // Look for any mention of breakdown or detailed billing
      if (text.includes('breakdown') || text.includes('surcharge') || text.includes('detail')) {
        console.log('\nFound relevant content in billing guide!')

        // Extract relevant sections
        const matches = text.match(/[^.]*(?:breakdown|surcharge|detail)[^.]*/gi)
        if (matches) {
          for (const match of matches.slice(0, 10)) {
            console.log(`  - ${match.trim()}`)
          }
        }
      }
    }
  } catch (e) {
    console.log('Could not fetch billing guide')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
