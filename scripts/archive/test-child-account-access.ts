#!/usr/bin/env npx tsx
/**
 * Test Child Account Access via User ID
 *
 * Hypothesis: Parent PAT token can access child account data by specifying User ID
 *
 * Testing with Henson Shaving - User ID: 386350
 *
 * Run with: npx tsx scripts/test-child-account-access.ts
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
const TEST_CLIENT_NAME = 'Henson Shaving'

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

  const status = response.ok ? c.green : (response.status === 404 ? c.yellow : c.red)
  log(`  → ${response.status} ${response.statusText}`, status)

  // Log response headers that might be relevant
  const relevantHeaders = ['x-shipbob-user-id', 'x-shipbob-channel-id', 'x-ratelimit-remaining']
  relevantHeaders.forEach(h => {
    const val = response.headers.get(h)
    if (val) log(`  Header ${h}: ${val}`, c.dim)
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
  log(`  Saved: scripts/output/${filename}`, c.green)
}

async function testChildAccountAccess() {
  header(`Testing Child Account Access: ${TEST_CLIENT_NAME} (User ID: ${TEST_USER_ID})`)

  const results: Record<string, unknown> = {}
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  // First, get a reference_id from billing that we can use to test order lookup
  header('1. Get a reference_id from Billing API (known working)')
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const txRes = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  let sampleReferenceId: string | null = null
  if (txRes.data?.items?.length > 0) {
    sampleReferenceId = txRes.data.items[0].reference_id
    log(`\nSample reference_id from billing: ${sampleReferenceId}`, c.bright)
    log(`(This should match an Order ID in the child account)`, c.dim)
  }

  // Test different header approaches for User ID
  header('2. Try Orders API with User ID in different header formats')

  const headerVariants = [
    { 'shipbob_user_id': TEST_USER_ID },
    { 'x-shipbob-user-id': TEST_USER_ID },
    { 'ShipBob-User-Id': TEST_USER_ID },
    { 'user_id': TEST_USER_ID },
    { 'X-User-Id': TEST_USER_ID },
  ]

  for (const headers of headerVariants) {
    log(`\nTrying headers: ${JSON.stringify(headers)}`, c.yellow)
    const res = await fetchAPI(
      `/order?StartDate=${oneYearAgo.toISOString()}&Limit=3`,
      '1.0',
      {},
      headers
    )

    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      log(`  SUCCESS! Found ${res.data.length} orders`, c.green)
      results[`orders_with_${Object.keys(headers)[0]}`] = res.data
      saveJSON(`orders-henson-${Object.keys(headers)[0]}.json`, res.data)

      // Show first order
      log('\nFirst order structure:', c.bright)
      console.log(JSON.stringify(res.data[0], null, 2).substring(0, 2000))
      break
    } else if (res.data && !Array.isArray(res.data)) {
      log(`  Response (not array): ${JSON.stringify(res.data).substring(0, 200)}`, c.dim)
    }
  }

  // Test query parameter approach
  header('3. Try Orders API with User ID as query parameter')

  const paramVariants = [
    `user_id=${TEST_USER_ID}`,
    `UserId=${TEST_USER_ID}`,
    `merchant_id=${TEST_USER_ID}`,
    `MerchantId=${TEST_USER_ID}`,
  ]

  for (const param of paramVariants) {
    log(`\nTrying query param: ${param}`, c.yellow)
    const res = await fetchAPI(
      `/order?StartDate=${oneYearAgo.toISOString()}&Limit=3&${param}`,
      '1.0'
    )

    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      log(`  SUCCESS! Found ${res.data.length} orders`, c.green)
      results[`orders_with_param_${param.split('=')[0]}`] = res.data
      saveJSON(`orders-henson-param-${param.split('=')[0]}.json`, res.data)
      break
    }
  }

  // Test looking up specific order by reference_id
  if (sampleReferenceId) {
    header('4. Try to get Order by reference_id (from billing)')

    // Try different ID lookup approaches
    const idLookups = [
      `/order/${sampleReferenceId}`,
      `/order?ReferenceId=${sampleReferenceId}`,
      `/order?OrderId=${sampleReferenceId}`,
      `/order?Id=${sampleReferenceId}`,
    ]

    for (const endpoint of idLookups) {
      log(`\nTrying: ${endpoint}`, c.yellow)

      // Try without user ID
      const res1 = await fetchAPI(endpoint, '1.0')
      if (res1.status === 200 && res1.data) {
        const data = Array.isArray(res1.data) ? res1.data : [res1.data]
        if (data.length > 0 && !data[0]?.statusCode) {
          log(`  SUCCESS without User ID header!`, c.green)
          saveJSON(`order-by-ref-${sampleReferenceId}.json`, res1.data)
          console.log(JSON.stringify(res1.data, null, 2).substring(0, 1500))
        }
      }

      // Try with user ID header
      const res2 = await fetchAPI(endpoint, '1.0', {}, { 'shipbob_user_id': TEST_USER_ID })
      if (res2.status === 200 && res2.data) {
        const data = Array.isArray(res2.data) ? res2.data : [res2.data]
        if (data.length > 0 && !data[0]?.statusCode) {
          log(`  SUCCESS with shipbob_user_id header!`, c.green)
          saveJSON(`order-by-ref-${sampleReferenceId}-with-user-id.json`, res2.data)
          console.log(JSON.stringify(res2.data, null, 2).substring(0, 1500))
        }
      }
    }
  }

  // Test Shipments endpoint with User ID
  header('5. Try Shipments endpoint with User ID')

  const shipmentEndpoints = [
    '/shipment?Limit=3',
    '/shipments?Limit=3',
  ]

  for (const endpoint of shipmentEndpoints) {
    log(`\nTrying: ${endpoint} with shipbob_user_id header`, c.yellow)
    const res = await fetchAPI(endpoint, '1.0', {}, { 'shipbob_user_id': TEST_USER_ID })
    if (res.status === 200 && res.data) {
      log(`  Response:`, c.dim)
      console.log(JSON.stringify(res.data, null, 2).substring(0, 1000))
    }
  }

  // Test Products endpoint with User ID (we know inventory works)
  header('6. Try Products endpoint with User ID')

  log(`\nTrying: /product?Limit=3 with shipbob_user_id header`, c.yellow)
  const productRes = await fetchAPI('/product?Limit=3', '1.0', {}, { 'shipbob_user_id': TEST_USER_ID })
  if (productRes.status === 200 && productRes.data && Array.isArray(productRes.data)) {
    log(`  Found ${productRes.data.length} products`, c.green)
    if (productRes.data.length > 0) {
      saveJSON('products-henson.json', productRes.data)
      console.log(JSON.stringify(productRes.data[0], null, 2).substring(0, 1000))
    }
  }

  // Summary
  header('SUMMARY')
  log(`
${c.bright}Test Client:${c.reset} ${TEST_CLIENT_NAME}
${c.bright}User ID:${c.reset} ${TEST_USER_ID}
${c.bright}Sample Reference ID:${c.reset} ${sampleReferenceId || 'N/A'}

${c.yellow}Check scripts/output/ for any successful responses${c.reset}

${c.bright}If orders were found:${c.reset}
- The User ID header approach works
- We can access child account data via parent PAT
- reference_id from billing = order_id in orders API
`, c.reset)
}

testChildAccountAccess().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
