#!/usr/bin/env npx tsx
/**
 * Debug ShipBob API Responses
 *
 * This script logs raw API responses to understand the actual data structure
 * so we can fix our TypeScript type definitions.
 *
 * Run with: npx tsx scripts/debug-shipbob-responses.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

async function fetchRaw(endpoint: string, apiVersion: string = '1.0', options: RequestInit = {}) {
  const url = `${baseUrl}/${apiVersion}${endpoint}`
  console.log(`\n📡 Fetching: ${url}`)

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  })

  console.log(`   Status: ${response.status} ${response.statusText}`)

  const text = await response.text()
  if (!text) {
    console.log('   Response: (empty)')
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    console.log('   Response (text):', text.substring(0, 500))
    return null
  }
}

async function debugResponses() {
  console.log('='.repeat(70))
  console.log('ShipBob API Response Debug')
  console.log('='.repeat(70))

  // 1. Orders API - check field names
  console.log('\n' + '='.repeat(70))
  console.log('1. ORDERS API (/order)')
  console.log('='.repeat(70))

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const orders = await fetchRaw(`/order?StartDate=${thirtyDaysAgo.toISOString()}&Limit=2`)
  if (orders && Array.isArray(orders) && orders.length > 0) {
    console.log('\n📦 First order (full structure):')
    console.log(JSON.stringify(orders[0], null, 2))
  } else if (orders) {
    console.log('\n📦 Orders response structure:')
    console.log(JSON.stringify(orders, null, 2).substring(0, 1000))
  }

  // 2. Invoices API
  console.log('\n' + '='.repeat(70))
  console.log('2. INVOICES API (2025-07/invoices)')
  console.log('='.repeat(70))

  const sixtyDaysAgo = new Date()
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

  const invoices = await fetchRaw(`/invoices?startDate=${sixtyDaysAgo.toISOString()}&pageSize=2`, '2025-07')
  if (invoices) {
    console.log('\n📄 Invoices response structure:')
    console.log(JSON.stringify(invoices, null, 2).substring(0, 2000))
  }

  // 3. Transactions Query API
  console.log('\n' + '='.repeat(70))
  console.log('3. TRANSACTIONS QUERY API (2025-07/transactions:query)')
  console.log('='.repeat(70))

  const transactions = await fetchRaw('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })
  if (transactions) {
    console.log('\n💰 Transactions response structure:')
    // Show full structure if items exist
    if (transactions.items && transactions.items.length > 0) {
      console.log('First transaction:')
      console.log(JSON.stringify(transactions.items[0], null, 2))
      console.log('\nPagination info:')
      console.log(JSON.stringify({ pagination: transactions.pagination, totalItems: transactions.items?.length }, null, 2))
    } else {
      console.log(JSON.stringify(transactions, null, 2).substring(0, 1000))
    }
  }

  // 4. Fee Types
  console.log('\n' + '='.repeat(70))
  console.log('4. FEE TYPES API (2025-07/transaction-fees)')
  console.log('='.repeat(70))

  const feeTypes = await fetchRaw('/transaction-fees', '2025-07')
  console.log('\n📋 Fee Types response:')
  console.log(JSON.stringify(feeTypes, null, 2))

  // 5. Try different shipment endpoints
  console.log('\n' + '='.repeat(70))
  console.log('5. SHIPMENTS API - Testing different endpoints')
  console.log('='.repeat(70))

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  // Try /shipment (singular)
  console.log('\n--- Trying /shipment ---')
  await fetchRaw(`/shipment?StartDate=${sevenDaysAgo.toISOString()}&Limit=2`)

  // Try /shipments (plural)
  console.log('\n--- Trying /shipments ---')
  await fetchRaw(`/shipments?StartDate=${sevenDaysAgo.toISOString()}&Limit=2`)

  // Try /fulfillment/shipments
  console.log('\n--- Trying /fulfillment/shipments ---')
  await fetchRaw(`/fulfillment/shipments?StartDate=${sevenDaysAgo.toISOString()}&Limit=2`)

  // 6. Check if shipments are embedded in orders
  console.log('\n' + '='.repeat(70))
  console.log('6. CHECKING ORDER STRUCTURE FOR EMBEDDED SHIPMENTS')
  console.log('='.repeat(70))

  // Get orders with HasShipments filter if possible
  const ordersWithShipments = await fetchRaw(`/order?HasShipments=true&Limit=5`)
  if (ordersWithShipments && Array.isArray(ordersWithShipments)) {
    console.log(`\nFound ${ordersWithShipments.length} orders`)
    const withShipments = ordersWithShipments.find((o: Record<string, unknown>) =>
      o.shipments || o.Shipments || o.fulfillments || o.Fulfillments
    )
    if (withShipments) {
      console.log('\nOrder with shipments:')
      console.log(JSON.stringify(withShipments, null, 2))
    } else if (ordersWithShipments.length > 0) {
      console.log('\nFirst order keys:', Object.keys(ordersWithShipments[0]))
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('DEBUG COMPLETE')
  console.log('='.repeat(70))
}

debugResponses().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
