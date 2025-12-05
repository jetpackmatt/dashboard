#!/usr/bin/env npx tsx
/**
 * Find Merchant ID via Orders/Shipments API
 *
 * Strategy:
 * 1. Get a transaction with a reference_id (Shipment ID)
 * 2. Look up that shipment/order to see if it has merchant info
 * 3. Check if orders have channel_id, user_id, or merchant_id fields
 *
 * Run with: npx tsx scripts/find-merchant-via-orders.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

const outputDir = path.resolve(process.cwd(), 'scripts/output')

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

async function fetchAPI(endpoint: string, version = '1.0', options: RequestInit = {}) {
  const url = `${baseUrl}/${version}${endpoint}`
  log(`Fetching: ${url}`, c.dim)

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  })

  log(`  Status: ${response.status} ${response.statusText}`, response.ok ? c.green : c.red)

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.substring(0, 500) }
  }
}

function saveJSON(filename: string, data: unknown) {
  const filepath = path.join(outputDir, filename)
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2))
  log(`  Saved: scripts/output/${filename}`, c.green)
}

// Get all unique keys from an object (recursively)
function getAllKeys(obj: unknown, prefix = ''): string[] {
  const keys: string[] = []
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      keys.push(fullKey)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        keys.push(...getAllKeys(value, fullKey))
      }
    }
  }
  return keys
}

async function findMerchant() {
  header('Finding Merchant ID via Orders/Shipments API')

  // 1. Get some recent transactions to find shipment IDs
  header('1. Getting recent transaction reference_ids')
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const transactions = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  if (!transactions?.items?.length) {
    log('No transactions found!', c.red)
    return
  }

  // Get unique reference_ids by type
  const refByType = new Map<string, string[]>()
  transactions.items.forEach((tx: Record<string, unknown>) => {
    const type = tx.reference_type as string
    const id = tx.reference_id as string
    if (!refByType.has(type)) refByType.set(type, [])
    const arr = refByType.get(type)!
    if (!arr.includes(id)) arr.push(id)
  })

  log('\nReference types and sample IDs:', c.bright)
  for (const [type, ids] of refByType) {
    log(`  ${type}: ${ids.slice(0, 3).join(', ')} (${ids.length} total)`, c.dim)
  }

  // 2. Try to fetch a shipment by ID
  const shipmentIds = refByType.get('Shipment') || []
  if (shipmentIds.length > 0) {
    header('2. Fetching Shipment by ID')
    const shipmentId = shipmentIds[0]

    // Try different endpoints
    const endpoints = [
      `/shipment/${shipmentId}`,
      `/shipments/${shipmentId}`,
      `/fulfillment/${shipmentId}`,
      `/fulfillments/${shipmentId}`,
    ]

    for (const endpoint of endpoints) {
      const result = await fetchAPI(endpoint)
      if (result && !result.statusCode) {
        log(`\nFound shipment at ${endpoint}:`, c.green)
        console.log(JSON.stringify(result, null, 2))
        saveJSON('shipment-by-id.json', result)

        log('\nAll keys in shipment object:', c.bright)
        log(`  ${getAllKeys(result).join(', ')}`, c.dim)
        break
      }
    }
  }

  // 3. Try Orders API - this is the key one
  header('3. Fetching Orders (likely has merchant/channel info)')

  // Try getting orders from the past year
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const orders = await fetchAPI(`/order?StartDate=${oneYearAgo.toISOString()}&Limit=5`)

  if (orders && Array.isArray(orders) && orders.length > 0) {
    log(`\nFound ${orders.length} orders`, c.green)

    // Save full structure
    saveJSON('orders-sample.json', orders)

    // Show first order structure
    const order = orders[0]
    log('\nFirst order full structure:', c.bright)
    console.log(JSON.stringify(order, null, 2))

    log('\nAll keys in order object:', c.bright)
    const keys = getAllKeys(order)
    log(`  ${keys.join(', ')}`, c.dim)

    // Look specifically for merchant/user/channel fields
    const merchantKeywords = ['merchant', 'user', 'channel', 'store', 'client', 'account', 'company']
    const matchingKeys = keys.filter(k =>
      merchantKeywords.some(keyword => k.toLowerCase().includes(keyword))
    )

    if (matchingKeys.length > 0) {
      log('\nPotential merchant identifier fields:', c.yellow)
      matchingKeys.forEach(k => {
        const value = k.split('.').reduce((obj: unknown, key) =>
          (obj as Record<string, unknown>)?.[key], order)
        log(`  ${k}: ${JSON.stringify(value)}`, c.bright)
      })
    }

    // Also check products within order for channel info
    if (order.products && Array.isArray(order.products)) {
      log('\nProducts in order:', c.bright)
      order.products.forEach((p: Record<string, unknown>, i: number) => {
        log(`  Product ${i + 1}:`, c.dim)
        const productKeys = getAllKeys(p)
        const productMerchantKeys = productKeys.filter(k =>
          merchantKeywords.some(keyword => k.toLowerCase().includes(keyword))
        )
        productMerchantKeys.forEach(k => {
          const value = k.split('.').reduce((obj: unknown, key) =>
            (obj as Record<string, unknown>)?.[key], p)
          log(`    ${k}: ${JSON.stringify(value)}`, c.bright)
        })
      })
    }
  } else {
    log('No orders found via /order endpoint', c.yellow)

    // Try alternative order endpoints
    const altEndpoints = [
      '/orders',
      '/order',
    ]

    for (const endpoint of altEndpoints) {
      const result = await fetchAPI(`${endpoint}?Limit=1`)
      if (result) {
        log(`\nResponse from ${endpoint}:`, c.dim)
        console.log(JSON.stringify(result, null, 2).substring(0, 1000))
      }
    }
  }

  // 4. Check if shipments via fulfillment have channel info
  header('4. Checking Fulfillment endpoint')
  const fulfillments = await fetchAPI('/fulfillment?Limit=5')
  if (fulfillments && Array.isArray(fulfillments) && fulfillments.length > 0) {
    log(`\nFound ${fulfillments.length} fulfillments`, c.green)
    saveJSON('fulfillments-sample.json', fulfillments)

    const fulfillment = fulfillments[0]
    log('\nFirst fulfillment structure:', c.bright)
    console.log(JSON.stringify(fulfillment, null, 2))

    const keys = getAllKeys(fulfillment)
    log('\nAll keys:', c.dim)
    log(`  ${keys.join(', ')}`, c.dim)
  }

  // 5. Check specific order by shipment reference
  if (shipmentIds.length > 0) {
    header('5. Finding Order by Shipment ID')
    const shipmentId = shipmentIds[0]

    // Try to find the order that contains this shipment
    const orderByShipment = await fetchAPI(`/order?HasShipmentId=${shipmentId}`)
    if (orderByShipment && Array.isArray(orderByShipment) && orderByShipment.length > 0) {
      log(`\nFound order for shipment ${shipmentId}:`, c.green)
      console.log(JSON.stringify(orderByShipment[0], null, 2))
      saveJSON('order-by-shipment.json', orderByShipment[0])
    }

    // Also try shipment endpoint directly
    const shipment = await fetchAPI(`/shipment/${shipmentId}`)
    if (shipment && !shipment.statusCode) {
      log(`\nFound shipment directly:`, c.green)
      console.log(JSON.stringify(shipment, null, 2))
    }
  }

  // Summary
  header('Summary')
  log(`
${c.bright}Strategy to find merchant/user ID:${c.reset}

1. Billing API transactions have ${c.yellow}reference_id${c.reset} (Shipment ID)
2. Need to find which API endpoint returns ${c.yellow}user_id${c.reset} or ${c.yellow}merchant_name${c.reset}
3. Then join: Transaction → Shipment/Order → Merchant

${c.yellow}Check scripts/output/ for detailed JSON responses${c.reset}
`, c.reset)
}

findMerchant().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
