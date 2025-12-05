#!/usr/bin/env npx tsx
/**
 * Test Methyl-Life® Orders API
 *
 * User ID: 392333
 *
 * Run with: npx tsx scripts/test-methyllife.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

const outputDir = path.resolve(process.cwd(), 'scripts/output')

// Methyl-Life User ID
const METHYLLIFE_USER_ID = '392333'

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
  log(`${options.method || 'GET'} ${url}`, c.dim)
  if (extraHeaders) {
    log(`  Headers: ${JSON.stringify(extraHeaders)}`, c.dim)
  }

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

  log(`  Status: ${response.status}`, response.status === 200 ? c.green : c.yellow)

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

async function test() {
  header(`Testing Methyl-Life® (User ID: ${METHYLLIFE_USER_ID})`)

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  // 1. Orders API
  header('1. Orders API')

  log(`\nWith shipbob_user_id header:`)
  const ordersRes = await fetchAPI(
    `/order?StartDate=${ninetyDaysAgo.toISOString()}&Limit=10`,
    '1.0',
    {},
    { 'shipbob_user_id': METHYLLIFE_USER_ID }
  )

  if (ordersRes.status === 200 && Array.isArray(ordersRes.data)) {
    log(`\n${c.bright}Orders returned: ${ordersRes.data.length}${c.reset}`, ordersRes.data.length > 0 ? c.green : c.yellow)

    if (ordersRes.data.length > 0) {
      saveJSON('methyllife-orders.json', ordersRes.data)
      log(`\nFirst order structure:`, c.bright)
      console.log(JSON.stringify(ordersRes.data[0], null, 2).substring(0, 2500))

      // If orders have shipments, show them
      const firstOrder = ordersRes.data[0] as Record<string, unknown>
      if (firstOrder.shipments && Array.isArray(firstOrder.shipments)) {
        log(`\nShipments in first order:`, c.bright)
        const shipments = firstOrder.shipments as Record<string, unknown>[]
        shipments.forEach((s, i) => {
          log(`  Shipment ${i + 1}: ID=${s.id}, Status=${s.status}`, c.dim)
        })
      }
    }
  }

  // 2. Inventory API
  header('2. Inventory API')

  const invRes = await fetchAPI(
    '/inventory?Limit=5',
    '1.0',
    {},
    { 'shipbob_user_id': METHYLLIFE_USER_ID }
  )

  if (invRes.status === 200 && Array.isArray(invRes.data)) {
    log(`\nInventory items: ${invRes.data.length}`, invRes.data.length > 0 ? c.green : c.yellow)
    if (invRes.data.length > 0) {
      saveJSON('methyllife-inventory.json', invRes.data)
      // Show first item name
      log(`  First item: ${(invRes.data[0] as Record<string, unknown>).name}`, c.dim)
    }
  }

  // 3. Products API
  header('3. Products API')

  const prodRes = await fetchAPI(
    '/product?Limit=5',
    '1.0',
    {},
    { 'shipbob_user_id': METHYLLIFE_USER_ID }
  )

  if (prodRes.status === 200 && Array.isArray(prodRes.data)) {
    log(`\nProducts: ${prodRes.data.length}`, prodRes.data.length > 0 ? c.green : c.yellow)
    if (prodRes.data.length > 0) {
      saveJSON('methyllife-products.json', prodRes.data)
      log(`  First product: ${(prodRes.data[0] as Record<string, unknown>).name}`, c.dim)
    }
  }

  // 4. Returns API
  header('4. Returns API')

  const retRes = await fetchAPI(
    '/return?Limit=5',
    '1.0',
    {},
    { 'shipbob_user_id': METHYLLIFE_USER_ID }
  )

  if (retRes.status === 200 && Array.isArray(retRes.data)) {
    log(`\nReturns: ${retRes.data.length}`, retRes.data.length > 0 ? c.green : c.yellow)
    if (retRes.data.length > 0) {
      saveJSON('methyllife-returns.json', retRes.data)
    }
  }

  header('SUMMARY')

  const foundOrders = ordersRes.data && Array.isArray(ordersRes.data) && ordersRes.data.length > 0

  if (foundOrders) {
    log(`
${c.green}✅ SUCCESS! Orders API works with User ID header${c.reset}

The shipbob_user_id header DOES unlock child account Orders data.
Now we can:
1. Use billing reference_id to get shipment ID
2. Find the order containing that shipment via Orders API
3. Link billing transactions to orders

${c.bright}To identify which User ID a billing transaction belongs to:${c.reset}
- Query each child account's Orders API by shipment ID
- The account that returns the order owns that transaction
`, c.reset)
  } else {
    log(`
${c.red}❌ Orders API still returns empty${c.reset}

Possible issues:
1. PAT token may not have Orders API access for ANY child account
2. The shipbob_user_id header is ignored
3. Different authentication approach needed

${c.yellow}Action: Contact ShipBob support about parent→child API access${c.reset}
`, c.reset)
  }
}

test().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
