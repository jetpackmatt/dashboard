#!/usr/bin/env node
/**
 * Compare ALL endpoints to find the fulfillment vs surcharge breakdown
 *
 * Excel columns: "Fulfillment without Surcharge" | "Surcharge Applied" | "Original Invoice"
 * We found "Original Invoice" (the combined total) - now find the breakdown!
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return response.ok ? await response.json() : null
}

// Recursively get ALL keys from an object
function getAllKeys(obj, prefix = '') {
  const keys = new Set()
  if (!obj || typeof obj !== 'object') return keys

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    keys.add(fullKey)

    if (Array.isArray(value)) {
      keys.add(`${fullKey}[]`)
      if (value.length > 0 && typeof value[0] === 'object') {
        for (const k of getAllKeys(value[0], `${fullKey}[]`)) {
          keys.add(k)
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const k of getAllKeys(value, fullKey)) {
        keys.add(k)
      }
    }
  }
  return keys
}

async function main() {
  console.log('═'.repeat(100))
  console.log('SEARCHING ALL ENDPOINTS FOR FULFILLMENT VS SURCHARGE BREAKDOWN')
  console.log('═'.repeat(100))

  // Test order from Excel with known breakdown
  // Order 320860433: Fulfillment=$5.97, Surcharge=$0.15, Total=$6.12
  const testOrderId = '320860433'
  const testInvoiceId = 8633612  // Dec 1 invoice

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 1: POST /transactions:query
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('ENDPOINT 1: POST /transactions:query')
  console.log('█'.repeat(80))

  const queryResult = await fetchJson(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    body: JSON.stringify({
      from_date: '2025-11-27T00:00:00Z',
      to_date: '2025-11-27T23:59:59Z',
      page_size: 1000
    })
  })

  const queryTx = queryResult?.items?.find(t => t.reference_id === testOrderId && t.transaction_fee === 'Shipping')

  if (queryTx) {
    console.log('\nFound test order via POST /transactions:query:')
    console.log(JSON.stringify(queryTx, null, 2))

    console.log('\nALL KEYS in response:')
    for (const key of [...getAllKeys(queryTx)].sort()) {
      console.log(`  ${key}`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 2: GET /invoices/{id}/transactions
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('ENDPOINT 2: GET /invoices/{id}/transactions')
  console.log('█'.repeat(80))

  const invoiceTxResult = await fetchJson(`${BASE_URL}/2025-07/invoices/${testInvoiceId}/transactions?PageSize=1000`)

  const invoiceTx = invoiceTxResult?.items?.find(t => t.reference_id === testOrderId && t.transaction_fee === 'Shipping')

  if (invoiceTx) {
    console.log('\nFound test order via GET /invoices/{id}/transactions:')
    console.log(JSON.stringify(invoiceTx, null, 2))

    console.log('\nALL KEYS in response:')
    for (const key of [...getAllKeys(invoiceTx)].sort()) {
      console.log(`  ${key}`)
    }

    // Compare with POST result
    console.log('\n--- COMPARING ENDPOINTS ---')
    const queryKeys = getAllKeys(queryTx)
    const invoiceKeys = getAllKeys(invoiceTx)

    const onlyInQuery = [...queryKeys].filter(k => !invoiceKeys.has(k))
    const onlyInInvoice = [...invoiceKeys].filter(k => !queryKeys.has(k))

    if (onlyInQuery.length > 0) {
      console.log('\nKeys ONLY in POST /transactions:query:')
      for (const k of onlyInQuery) console.log(`  ${k}`)
    }

    if (onlyInInvoice.length > 0) {
      console.log('\nKeys ONLY in GET /invoices/{id}/transactions:')
      for (const k of onlyInInvoice) console.log(`  ${k}`)
    }

    if (onlyInQuery.length === 0 && onlyInInvoice.length === 0) {
      console.log('\nBoth endpoints return IDENTICAL keys')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 3: GET /invoices (invoice metadata)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('ENDPOINT 3: GET /invoices (metadata)')
  console.log('█'.repeat(80))

  const invoicesResult = await fetchJson(`${BASE_URL}/2025-07/invoices?FromDate=2025-12-01&ToDate=2025-12-01&PageSize=10`)

  if (invoicesResult?.items?.length > 0) {
    console.log('\nInvoice metadata sample:')
    console.log(JSON.stringify(invoicesResult.items[0], null, 2))

    console.log('\nALL KEYS in invoice metadata:')
    for (const key of [...getAllKeys(invoicesResult.items[0])].sort()) {
      console.log(`  ${key}`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENDPOINT 4: GET /transaction-fees
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('ENDPOINT 4: GET /transaction-fees')
  console.log('█'.repeat(80))

  const feesResult = await fetchJson(`${BASE_URL}/2025-07/transaction-fees`)
  console.log('\nTransaction fees response:')
  console.log(JSON.stringify(feesResult, null, 2))

  // ═══════════════════════════════════════════════════════════════════════════
  // TRY: Different API versions?
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('TRYING: Different API versions (1.0 vs 2025-07)')
  console.log('█'.repeat(80))

  // Try 1.0 API
  const v1Result = await fetchJson(`${BASE_URL}/1.0/billing/transactions?StartDate=2025-11-27&EndDate=2025-11-27&Limit=10`)
  if (v1Result) {
    console.log('\n1.0 API Response:')
    console.log(JSON.stringify(v1Result, null, 2))
  } else {
    console.log('\n1.0 API: No data or different endpoint structure')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRY: Shipments API (maybe breakdown is there?)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('TRYING: Shipments API (maybe breakdown there?)')
  console.log('█'.repeat(80))

  // Need order ID to get shipment
  const shipmentResult = await fetchJson(`${BASE_URL}/2025-07/shipment?orderId=${testOrderId}`)
  if (shipmentResult) {
    console.log('\nShipment API Response:')
    console.log(JSON.stringify(shipmentResult, null, 2))

    console.log('\nALL KEYS:')
    const shipmentData = Array.isArray(shipmentResult) ? shipmentResult[0] : shipmentResult
    if (shipmentData) {
      for (const key of [...getAllKeys(shipmentData)].sort()) {
        console.log(`  ${key}`)
      }
    }
  }

  // Try orders API
  const orderResult = await fetchJson(`${BASE_URL}/2025-07/order/${testOrderId}`)
  if (orderResult) {
    console.log('\nOrder API Response:')
    console.log(JSON.stringify(orderResult, null, 2))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRY: Look for any field containing "surcharge", "fulfillment", "base"
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n' + '█'.repeat(80))
  console.log('SEARCHING: All transactions for breakdown-related fields')
  console.log('█'.repeat(80))

  // Get more transactions and look for any hidden fields
  const allTxs = queryResult?.items || []
  console.log(`\nSearching ${allTxs.length} transactions for breakdown fields...`)

  const breakdownTerms = [
    'surcharge', 'fulfillment', 'base', 'carrier', 'rate',
    'cost', 'fee', 'charge', 'price', 'subtotal', 'breakdown'
  ]

  // Collect ALL unique keys across ALL transactions
  const allFoundKeys = new Set()
  for (const tx of allTxs) {
    for (const key of getAllKeys(tx)) {
      allFoundKeys.add(key)
    }
  }

  console.log('\nAll unique keys found across all transactions:')
  for (const key of [...allFoundKeys].sort()) {
    const matchesTerm = breakdownTerms.some(term => key.toLowerCase().includes(term))
    console.log(`  ${matchesTerm ? '>>> ' : '    '}${key}`)
  }

  // Look inside additional_details more carefully
  console.log('\n--- Examining additional_details more carefully ---')
  const additionalDetailsVariants = new Map()
  for (const tx of allTxs) {
    const details = tx.additional_details
    if (details) {
      const keys = Object.keys(details).sort().join(',')
      if (!additionalDetailsVariants.has(keys)) {
        additionalDetailsVariants.set(keys, { count: 0, sample: details })
      }
      additionalDetailsVariants.get(keys).count++
    }
  }

  console.log('\nUnique additional_details structures:')
  for (const [keys, data] of additionalDetailsVariants) {
    console.log(`\n  Keys: [${keys}] - ${data.count} occurrences`)
    console.log(`  Sample: ${JSON.stringify(data.sample)}`)
  }

  console.log('\n' + '═'.repeat(100))
  console.log('NEXT STEPS TO TRY')
  console.log('═'.repeat(100))
  console.log(`
1. Check if there's a separate "rates" or "quotes" API
2. Check the Shipments API for carrier/rate breakdown
3. Check if breakdown appears in invoice PDF/export
4. Look at different invoice_type responses
5. Try querying with specific parameters that might unlock more fields
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
