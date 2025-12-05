#!/usr/bin/env npx tsx
/**
 * Deep API Search for Merchant/User ID
 *
 * Trying all possible approaches to find the merchant identifier
 *
 * Run with: npx tsx scripts/deep-api-search.ts
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

async function fetchAPI(endpoint: string, version = '1.0', options: RequestInit = {}, extraHeaders?: Record<string, string>) {
  const url = `${baseUrl}/${version}${endpoint}`
  log(`${options.method || 'GET'} ${url}`, c.dim)

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

async function deepSearch() {
  const results: Record<string, unknown> = {}

  // Channel IDs from our earlier discovery
  const channelIds = [341684, 433646]

  header('1. Try Orders with specific Channel ID header')
  for (const channelId of channelIds) {
    log(`\nTrying with shipbob_channel_id: ${channelId}`, c.bright)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    const res = await fetchAPI(
      `/order?StartDate=${oneYearAgo.toISOString()}&Limit=3`,
      '1.0',
      {},
      { 'shipbob_channel_id': String(channelId) }
    )

    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      log(`  Found ${res.data.length} orders with channel ${channelId}!`, c.green)
      results[`orders_channel_${channelId}`] = res.data
      saveJSON(`orders-channel-${channelId}.json`, res.data)

      // Show structure of first order
      log('\nFirst order structure:', c.bright)
      console.log(JSON.stringify(res.data[0], null, 2))
    } else {
      log(`  No orders found with channel ${channelId}`, c.dim)
    }
  }

  header('2. Check Returns API (might have merchant info)')
  const returns = await fetchAPI('/return?Limit=5')
  if (returns.status === 200 && returns.data) {
    log('\nReturns response:', c.bright)
    console.log(JSON.stringify(returns.data, null, 2).substring(0, 2000))
    results['returns'] = returns.data
    saveJSON('returns-sample.json', returns.data)
  }

  header('3. Check Inventory Items (have product → channel link)')
  const inventory = await fetchAPI('/inventory?Limit=5')
  if (inventory.status === 200 && inventory.data) {
    log('\nInventory response:', c.bright)
    console.log(JSON.stringify(inventory.data, null, 2).substring(0, 2000))
    results['inventory'] = inventory.data
    saveJSON('inventory-sample.json', inventory.data)
  }

  header('4. Get Locations (fulfillment centers)')
  const locations = await fetchAPI('/location')
  if (locations.status === 200 && locations.data) {
    log('\nLocations:', c.bright)
    console.log(JSON.stringify(locations.data, null, 2).substring(0, 2000))
    results['locations'] = locations.data
    saveJSON('locations.json', locations.data)
  }

  header('5. Try different Billing API endpoints')
  const billingEndpoints = [
    '/billing/invoices',
    '/billing/summary',
    '/billing/accounts',
    '/billing/merchants',
    '/invoices/summary',
  ]

  for (const endpoint of billingEndpoints) {
    const res = await fetchAPI(endpoint, '2025-07')
    if (res.status === 200) {
      log(`  Found: ${endpoint}`, c.green)
      console.log(JSON.stringify(res.data, null, 2).substring(0, 500))
    }
  }

  header('6. Try Shipments endpoint directly')
  // Get a reference_id from transactions
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const txRes = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  if (txRes.data?.items?.length > 0) {
    const shipmentId = txRes.data.items[0].reference_id
    log(`\nTrying to find shipment ${shipmentId}:`, c.bright)

    // Try all versions
    const versions = ['1.0', '2.0', '2025-07']
    const shipmentEndpoints = [
      `/shipment/${shipmentId}`,
      `/shipments/${shipmentId}`,
      `/shipment?Id=${shipmentId}`,
      `/shipments?Id=${shipmentId}`,
    ]

    for (const version of versions) {
      for (const endpoint of shipmentEndpoints) {
        const res = await fetchAPI(endpoint, version)
        if (res.status === 200 && res.data) {
          log(`  Found at ${version}${endpoint}!`, c.green)
          console.log(JSON.stringify(res.data, null, 2).substring(0, 2000))
          saveJSON('shipment-found.json', res.data)
        }
      }
    }
  }

  header('7. Check for User/Partner API endpoints')
  const userEndpoints = [
    '/user',
    '/users',
    '/partner',
    '/partners',
    '/merchant',
    '/merchants',
    '/client',
    '/clients',
    '/account',
    '/accounts',
    '/tenants',
    '/organizations',
  ]

  for (const endpoint of userEndpoints) {
    const res = await fetchAPI(endpoint)
    if (res.status === 200 && res.data) {
      log(`  Found: ${endpoint}`, c.green)
      console.log(JSON.stringify(res.data, null, 2).substring(0, 1000))
      saveJSON(`endpoint-${endpoint.replace('/', '')}.json`, res.data)
    }
  }

  header('8. Check specific transaction additional_details deeply')
  if (txRes.data?.items?.length > 0) {
    // Get unique fee types and check their additional_details
    const feeTypes = new Map<string, Record<string, unknown>>()
    txRes.data.items.forEach((tx: Record<string, unknown>) => {
      const fee = tx.transaction_fee as string
      if (!feeTypes.has(fee)) {
        feeTypes.set(fee, tx.additional_details as Record<string, unknown>)
      }
    })

    log('\nAdditional details by fee type:', c.bright)
    for (const [fee, details] of feeTypes) {
      log(`\n  ${fee}:`, c.yellow)
      if (details && Object.keys(details).length > 0) {
        Object.entries(details).forEach(([k, v]) => {
          log(`    ${k}: ${JSON.stringify(v)}`, c.dim)
        })
      } else {
        log(`    (empty)`, c.dim)
      }
    }
  }

  // Summary
  header('SUMMARY: Merchant ID Search Results')

  const findingsFile = {
    timestamp: new Date().toISOString(),
    summary: {
      orders_found: Object.keys(results).some(k => k.startsWith('orders_channel')),
      channels: channelIds,
      shipments_accessible: false,
      merchant_id_found: false,
    },
    results,
  }

  saveJSON('deep-search-results.json', findingsFile)

  log(`
${c.bright}Key Findings:${c.reset}
- Billing API transactions: ${c.green}Accessible${c.reset} (96 shipment references)
- Orders API: ${c.yellow}Returns empty arrays${c.reset}
- Shipments API: ${c.red}404 Not Found${c.reset}
- Channels: ${c.green}341684, 433646${c.reset}

${c.yellow}The Billing API appears to be isolated from Orders/Shipments.${c.reset}
${c.yellow}Merchant/User ID is NOT in the Billing API response.${c.reset}

${c.bright}Possible solutions:${c.reset}
1. Contact ShipBob support to enable Orders API access
2. Request merchant_id field to be added to Billing API
3. Use historic Excel data as a lookup table (User ID ↔ Reference ID)
4. Check if PAT permissions need to be upgraded
`, c.reset)
}

deepSearch().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
