#!/usr/bin/env npx tsx
/**
 * Find Merchant/Channel ID in ShipBob API
 *
 * Goal: Find the field that identifies child merchants in a parent account setup
 *
 * Run with: npx tsx scripts/find-merchant-id.ts
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

  log(`  Status: ${response.status} ${response.statusText}`, c.dim)

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
  log(`  Saved: scripts/output/${filename}`, c.dim)
}

async function findMerchantId() {
  header('Finding Merchant/Channel ID in ShipBob API')

  // 1. Check /channels endpoint (common for multi-merchant setups)
  header('1. Checking /channels endpoint')
  const channels = await fetchAPI('/channel')
  if (channels) {
    log('\nChannels response:', c.bright)
    console.log(JSON.stringify(channels, null, 2).substring(0, 2000))
    saveJSON('channels.json', channels)
  }

  // 2. Check /merchants endpoint
  header('2. Checking /merchants endpoint')
  const merchants = await fetchAPI('/merchant')
  if (merchants) {
    log('\nMerchants response:', c.bright)
    console.log(JSON.stringify(merchants, null, 2).substring(0, 2000))
    saveJSON('merchants.json', merchants)
  }

  // 3. Check /account or /me endpoint
  header('3. Checking account/user endpoints')
  const account = await fetchAPI('/account')
  const me = await fetchAPI('/me')
  const user = await fetchAPI('/user')

  if (account) {
    log('\n/account response:', c.bright)
    console.log(JSON.stringify(account, null, 2).substring(0, 1000))
    saveJSON('account.json', account)
  }
  if (me) {
    log('\n/me response:', c.bright)
    console.log(JSON.stringify(me, null, 2).substring(0, 1000))
    saveJSON('me.json', me)
  }
  if (user) {
    log('\n/user response:', c.bright)
    console.log(JSON.stringify(user, null, 2).substring(0, 1000))
  }

  // 4. Get a single order and inspect ALL fields
  header('4. Inspecting Order fields for merchant/channel ID')
  const orders = await fetchAPI('/order?Limit=1')
  if (orders && Array.isArray(orders) && orders.length > 0) {
    log('\nFull order structure (all keys):', c.bright)
    console.log(JSON.stringify(orders[0], null, 2))
    saveJSON('order-full-structure.json', orders[0])
  } else {
    log('No orders found, trying with longer date range...', c.yellow)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const oldOrders = await fetchAPI(`/order?StartDate=${oneYearAgo.toISOString()}&Limit=1`)
    if (oldOrders && Array.isArray(oldOrders) && oldOrders.length > 0) {
      console.log(JSON.stringify(oldOrders[0], null, 2))
      saveJSON('order-full-structure.json', oldOrders[0])
    }
  }

  // 5. Check transactions for any merchant-related fields in additional_details
  header('5. Inspecting Transaction additional_details for merchant info')
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const transactions = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  if (transactions?.items) {
    // Get unique additional_details keys across all transactions
    const allKeys = new Set<string>()
    const sampleDetails: Record<string, unknown>[] = []

    transactions.items.forEach((tx: Record<string, unknown>) => {
      const details = tx.additional_details as Record<string, unknown>
      if (details) {
        Object.keys(details).forEach(k => allKeys.add(k))
        if (sampleDetails.length < 5) {
          sampleDetails.push(details)
        }
      }
    })

    log('\nAll additional_details keys found:', c.bright)
    log(`  ${Array.from(allKeys).join(', ')}`, c.dim)

    log('\nSample additional_details values:', c.bright)
    sampleDetails.forEach((d, i) => {
      log(`  Transaction ${i + 1}:`, c.dim)
      Object.entries(d).forEach(([k, v]) => {
        log(`    ${k}: ${JSON.stringify(v)}`, c.dim)
      })
    })
  }

  // 6. Check for shipments via products/inventory (might have channel info)
  header('6. Checking Product/Inventory endpoints')
  const products = await fetchAPI('/product?Limit=5')
  if (products && Array.isArray(products) && products.length > 0) {
    log('\nProduct structure:', c.bright)
    console.log(JSON.stringify(products[0], null, 2))
    saveJSON('product-structure.json', products[0])
  }

  // 7. Try different API versions for channels
  header('7. Trying different API versions')
  const channelsV2 = await fetchAPI('/channels', '2.0')
  const channelsV2025 = await fetchAPI('/channels', '2025-07')

  if (channelsV2) {
    log('\n/channels v2.0:', c.bright)
    console.log(JSON.stringify(channelsV2, null, 2).substring(0, 1000))
  }
  if (channelsV2025) {
    log('\n/channels 2025-07:', c.bright)
    console.log(JSON.stringify(channelsV2025, null, 2).substring(0, 1000))
  }

  // Summary
  header('Summary')
  log(`
${c.bright}Looking for a field that identifies child merchants...${c.reset}

Possible field names to look for:
- channel_id / channel_name
- merchant_id / merchant_name
- store_id / store_name
- user_id / user_name
- account_id
- company_id
- client_id (ShipBob's term)

${c.yellow}Check the saved JSON files in scripts/output/ for detailed inspection.${c.reset}
`, c.reset)
}

findMerchantId().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
