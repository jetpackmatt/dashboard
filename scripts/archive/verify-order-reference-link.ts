#!/usr/bin/env npx tsx
/**
 * Verify Order ↔ Reference ID Link
 *
 * Goal: Prove that billing reference_id = order ID in child accounts
 *
 * Run with: npx tsx scripts/verify-order-reference-link.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

const outputDir = path.resolve(process.cwd(), 'scripts/output')

// Test client: Henson Shaving
const TEST_USER_ID = '386350'

const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(msg: string, color = c.reset) {
  console.log(`${color}${msg}${c.reset}`)
}

function header(title: string) {
  console.log('\n' + '='.repeat(70))
  log(title, c.bright + c.cyan)
  console.log('='.repeat(70))
}

async function fetchAPI(
  endpoint: string,
  version = '1.0',
  options: RequestInit = {},
  extraHeaders?: Record<string, string>
) {
  const url = `${baseUrl}/${version}${endpoint}`

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders,
      ...options.headers,
    },
  })

  const text = await response.text()
  if (!text) return { status: response.status, data: null }

  try {
    return { status: response.status, data: JSON.parse(text) }
  } catch {
    return { status: response.status, data: { raw: text.substring(0, 500) } }
  }
}

function saveJSON(filename: string, data: unknown) {
  const filepath = path.join(outputDir, filename)
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2))
  log(`Saved: scripts/output/${filename}`, c.green)
}

async function verify() {
  header('Step 1: Get Orders for Henson Shaving (User ID: 386350)')

  // Get orders for last 90 days
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  log(`\nFetching orders with shipbob_user_id header...`, c.dim)
  const ordersRes = await fetchAPI(
    `/order?StartDate=${ninetyDaysAgo.toISOString()}&Limit=100`,
    '1.0',
    {},
    { 'shipbob_user_id': TEST_USER_ID }
  )

  if (ordersRes.status === 200 && ordersRes.data) {
    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : []
    log(`\nOrders returned: ${orders.length}`, orders.length > 0 ? c.green : c.yellow)

    if (orders.length > 0) {
      saveJSON('henson-orders.json', orders)

      // Show sample order structure
      log(`\nFirst order structure:`, c.bright)
      console.log(JSON.stringify(orders[0], null, 2))

      // Extract order IDs for comparison
      const orderIds = orders.map((o: Record<string, unknown>) => o.id || o.order_id || o.reference_id)
      log(`\nOrder IDs from Orders API:`, c.bright)
      log(orderIds.slice(0, 10).join(', '), c.dim)

      // Now check if any of these match billing transactions
      header('Step 2: Cross-reference with Billing Transactions')

      const txRes = await fetchAPI('/transactions:query', '2025-07', {
        method: 'POST',
        body: JSON.stringify({
          start_date: ninetyDaysAgo.toISOString(),
          end_date: new Date().toISOString(),
        }),
      })

      if (txRes.data?.items) {
        const txReferenceIds = txRes.data.items.map((tx: Record<string, unknown>) => tx.reference_id)
        log(`\nBilling reference_ids (first 10):`, c.bright)
        log(txReferenceIds.slice(0, 10).join(', '), c.dim)

        // Find matches
        const matches = orderIds.filter((id: string) => txReferenceIds.includes(String(id)))
        log(`\n${c.bright}MATCHES FOUND: ${matches.length}${c.reset}`)

        if (matches.length > 0) {
          log(`Matching IDs: ${matches.slice(0, 10).join(', ')}`, c.green)
          log(`\n${c.green}✅ CONFIRMED: Billing reference_id = Order ID in child account${c.reset}`)
        }
      }
    } else {
      log(`\nNo orders found for User ID ${TEST_USER_ID}`, c.yellow)
      log(`Possible reasons:`, c.dim)
      log(`  - No orders in last 90 days`, c.dim)
      log(`  - User ID header not being used by API`, c.dim)
      log(`  - Account setup issue`, c.dim)
    }
  }

  // Test without user ID to see if it's the header or the data
  header('Step 3: Compare - Orders WITHOUT User ID header')

  const ordersNoHeader = await fetchAPI(
    `/order?StartDate=${ninetyDaysAgo.toISOString()}&Limit=10`,
    '1.0'
  )

  if (ordersNoHeader.status === 200) {
    const count = Array.isArray(ordersNoHeader.data) ? ordersNoHeader.data.length : 0
    log(`Orders without header: ${count}`, c.dim)
  }

  // Try a completely different endpoint to verify User ID header works
  header('Step 4: Verify User ID header works via different endpoints')

  // Returns
  log(`\nReturns with User ID header:`, c.dim)
  const returnsRes = await fetchAPI(
    '/return?Limit=5',
    '1.0',
    {},
    { 'shipbob_user_id': TEST_USER_ID }
  )
  if (returnsRes.status === 200 && Array.isArray(returnsRes.data)) {
    log(`  Returns found: ${returnsRes.data.length}`, returnsRes.data.length > 0 ? c.green : c.yellow)
    if (returnsRes.data.length > 0) {
      saveJSON('henson-returns.json', returnsRes.data)
    }
  }

  // Inventory
  log(`\nInventory with User ID header:`, c.dim)
  const invRes = await fetchAPI(
    '/inventory?Limit=5',
    '1.0',
    {},
    { 'shipbob_user_id': TEST_USER_ID }
  )
  if (invRes.status === 200 && Array.isArray(invRes.data)) {
    log(`  Inventory items found: ${invRes.data.length}`, invRes.data.length > 0 ? c.green : c.yellow)
    if (invRes.data.length > 0) {
      saveJSON('henson-inventory.json', invRes.data)
    }
  }

  // Receiving
  log(`\nReceiving orders with User ID header:`, c.dim)
  const recRes = await fetchAPI(
    '/receiving?Limit=5',
    '1.0',
    {},
    { 'shipbob_user_id': TEST_USER_ID }
  )
  if (recRes.status === 200 && Array.isArray(recRes.data)) {
    log(`  Receiving orders found: ${recRes.data.length}`, recRes.data.length > 0 ? c.green : c.yellow)
  }

  // Summary
  header('SUMMARY')
  log(`
${c.bright}Key Question:${c.reset} Does User ID header unlock child account data?

${c.bright}Results:${c.reset}
- Orders API: Check scripts/output/henson-orders.json
- Returns API: Check scripts/output/henson-returns.json
- Inventory API: Check scripts/output/henson-inventory.json

${c.yellow}If Henson has no data, try with a client that definitely has recent orders.${c.reset}
`, c.reset)
}

verify().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
