#!/usr/bin/env npx tsx
/**
 * Test current billing reference_ids with Henson User ID
 *
 * The 96 current billing transactions are likely Henson's - let's verify
 *
 * Run with: npx tsx scripts/test-current-refs-with-henson.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

const outputDir = path.resolve(process.cwd(), 'scripts/output')

// Henson Shaving User ID
const HENSON_USER_ID = '386350'

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

async function test() {
  header('Get current billing reference_ids')

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const txRes = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  if (!txRes.data?.items?.length) {
    log('No billing transactions found', c.red)
    return
  }

  // Get unique reference_ids
  const refIds = [...new Set(txRes.data.items.map((tx: Record<string, unknown>) => tx.reference_id as string))]
  log(`\nUnique reference_ids in billing: ${refIds.length}`, c.dim)
  log(`Sample: ${refIds.slice(0, 5).join(', ')}`, c.dim)

  header('Test Orders API with Henson User ID')

  // Test with first few reference_ids
  for (const refId of refIds.slice(0, 3)) {
    log(`\n--- Testing reference_id: ${refId} ---`, c.yellow)

    // 1. Try direct order lookup by ID (might work)
    log(`\n1. GET /order/${refId} with shipbob_user_id header`, c.dim)
    const res1 = await fetchAPI(`/order/${refId}`, '1.0', {}, { 'shipbob_user_id': HENSON_USER_ID })
    log(`   Status: ${res1.status}`, res1.status === 200 ? c.green : c.yellow)
    if (res1.status === 200 && res1.data && !res1.data.statusCode) {
      log(`   ${c.green}✅ FOUND ORDER!${c.reset}`)
      console.log(JSON.stringify(res1.data, null, 2).substring(0, 1500))
      saveJSON(`order-${refId}.json`, res1.data)
    }

    // 2. Try search by shipment ID (reference_id might be shipment_id)
    log(`\n2. GET /order?ShipmentId=${refId} with shipbob_user_id header`, c.dim)
    const res2 = await fetchAPI(`/order?ShipmentId=${refId}`, '1.0', {}, { 'shipbob_user_id': HENSON_USER_ID })
    log(`   Status: ${res2.status}`, res2.status === 200 ? c.green : c.yellow)
    if (res2.status === 200 && Array.isArray(res2.data) && res2.data.length > 0) {
      log(`   ${c.green}✅ FOUND ${res2.data.length} ORDERS!${c.reset}`)
      console.log(JSON.stringify(res2.data[0], null, 2).substring(0, 1500))
      saveJSON(`orders-by-shipment-${refId}.json`, res2.data)
    }

    // 3. Try HasShipments parameter
    log(`\n3. GET /order?HasShipments=true with shipbob_user_id header`, c.dim)
    const res3 = await fetchAPI(
      `/order?HasShipments=true&Limit=3`,
      '1.0',
      {},
      { 'shipbob_user_id': HENSON_USER_ID }
    )
    log(`   Status: ${res3.status}`, res3.status === 200 ? c.green : c.yellow)
    if (res3.status === 200 && Array.isArray(res3.data)) {
      log(`   Orders with shipments: ${res3.data.length}`)
      if (res3.data.length > 0) {
        log(`   ${c.green}✅ FOUND ORDERS WITH SHIPMENTS!${c.reset}`)
        saveJSON('henson-orders-with-shipments.json', res3.data)

        // Show first order with shipments array
        const orderWithShipments = res3.data.find((o: Record<string, unknown>) => o.shipments)
        if (orderWithShipments) {
          log(`\nFirst order structure:`, c.bright)
          console.log(JSON.stringify(orderWithShipments, null, 2).substring(0, 2000))

          // Check if shipment IDs match our billing reference_ids
          const shipments = (orderWithShipments.shipments || []) as Record<string, unknown>[]
          const shipmentIds = shipments.map(s => s.id || s.shipment_id)
          log(`\nShipment IDs in order: ${shipmentIds.join(', ')}`, c.bright)

          // Check if any match our billing
          const matchingIds = shipmentIds.filter(id => refIds.includes(String(id)))
          if (matchingIds.length > 0) {
            log(`${c.green}✅ MATCH FOUND! Billing reference_id = Order shipment_id${c.reset}`)
            log(`Matching IDs: ${matchingIds.join(', ')}`, c.green)
          }
        }
      }
    }
  }

  // Also try listing all orders in last 7 days with user ID
  header('Test: List recent Henson orders')

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  log(`\nGET /order?StartDate=7_days_ago&Limit=10 with shipbob_user_id: ${HENSON_USER_ID}`, c.dim)
  const recentRes = await fetchAPI(
    `/order?StartDate=${sevenDaysAgo.toISOString()}&Limit=10`,
    '1.0',
    {},
    { 'shipbob_user_id': HENSON_USER_ID }
  )

  log(`Status: ${recentRes.status}`)
  if (recentRes.status === 200 && Array.isArray(recentRes.data)) {
    log(`Orders returned: ${recentRes.data.length}`, recentRes.data.length > 0 ? c.green : c.yellow)

    if (recentRes.data.length > 0) {
      saveJSON('henson-recent-orders.json', recentRes.data)
      log(`\nFirst order:`, c.bright)
      console.log(JSON.stringify(recentRes.data[0], null, 2).substring(0, 1500))
    }
  }

  header('CONCLUSION')
  log(`
If orders were found:
  ✅ The User ID header DOES unlock child account Orders API
  ✅ billing.reference_id = order.shipments[].id (shipment ID)
  ✅ We can join billing transactions to orders via shipment ID

If orders are still empty:
  ❌ The PAT token may not have Orders API access for child accounts
  ❌ Need to contact ShipBob support about parent→child API access
`, c.reset)
}

test().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
