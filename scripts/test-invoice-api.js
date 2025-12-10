#!/usr/bin/env node
/**
 * Test ShipBob /invoices/{id}/transactions endpoint
 *
 * Compares our client behavior vs direct fetch
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_API_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

const INVOICES_TO_TEST = [
  { id: 8661966, type: 'Shipping' },
  { id: 8661967, type: 'Receiving' },
  { id: 8661968, type: 'Storage' },
  { id: 8661969, type: 'Credits' },
]

async function testWithFetch(invoiceId) {
  const url = `${BASE_URL}/2025-07/invoices/${invoiceId}/transactions?PageSize=1000`

  console.log(`\n--- Testing invoice ${invoiceId} ---`)
  console.log(`URL: ${url}`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  })

  console.log(`Status: ${response.status} ${response.statusText}`)
  console.log(`Headers: ${JSON.stringify(Object.fromEntries(response.headers))}`)

  if (!response.ok) {
    const text = await response.text()
    console.log(`Error body: ${text}`)
    return null
  }

  const data = await response.json()
  const items = Array.isArray(data) ? data : (data.items || [])
  console.log(`Transactions: ${items.length}`)

  return items
}

async function testWithMinimalHeaders(invoiceId) {
  const url = `${BASE_URL}/2025-07/invoices/${invoiceId}/transactions?PageSize=1000`

  console.log(`\n--- Testing invoice ${invoiceId} (minimal headers) ---`)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
    },
  })

  console.log(`Status: ${response.status} ${response.statusText}`)

  if (!response.ok) {
    const text = await response.text()
    console.log(`Error body: ${text}`)
    return null
  }

  const data = await response.json()
  const items = Array.isArray(data) ? data : (data.items || [])
  console.log(`Transactions: ${items.length}`)

  return items
}

async function main() {
  console.log('Testing ShipBob /invoices/{id}/transactions API')
  console.log('Token:', SHIPBOB_API_TOKEN?.slice(0, 10) + '...')

  console.log('\n=== Test with full headers (like our client) ===')
  for (const inv of INVOICES_TO_TEST) {
    try {
      await testWithFetch(inv.id)
    } catch (err) {
      console.log(`Error: ${err.message}`)
    }
  }

  console.log('\n\n=== Test with minimal headers (like curl) ===')
  for (const inv of INVOICES_TO_TEST) {
    try {
      await testWithMinimalHeaders(inv.id)
    } catch (err) {
      console.log(`Error: ${err.message}`)
    }
  }
}

main().catch(console.error)
