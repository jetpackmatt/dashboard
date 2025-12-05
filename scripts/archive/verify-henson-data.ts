#!/usr/bin/env npx tsx
/**
 * Verify Henson Data from Historic Excel
 *
 * Goal: Find Henson's reference IDs in historic data, then check if they exist in billing API
 *
 * Run with: npx tsx scripts/verify-henson-data.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as XLSX from 'xlsx'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

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

async function verify() {
  header('Step 1: Load Historic Shipments Excel')

  const shipmentsPath = path.resolve(process.cwd(), 'reference/data/historic/shipments.xlsx')
  const workbook = XLSX.readFile(shipmentsPath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]

  log(`Total rows in shipments.xlsx: ${data.length}`, c.dim)

  // Get column names
  if (data.length > 0) {
    log(`\nColumns: ${Object.keys(data[0]).join(', ')}`, c.dim)
  }

  header('Step 2: Find Henson Shaving Data')

  // Find Henson rows - check various possible column names
  const hensonRows = data.filter(row => {
    const merchantName = row['Merchant Name'] || row['MerchantName'] || row['merchant_name']
    return merchantName && String(merchantName).toLowerCase().includes('henson')
  })

  log(`\nHenson rows found: ${hensonRows.length}`, hensonRows.length > 0 ? c.green : c.red)

  if (hensonRows.length > 0) {
    // Get Henson's User ID
    const sampleRow = hensonRows[0]
    const userId = sampleRow['User ID'] || sampleRow['UserId'] || sampleRow['user_id']
    const merchantName = sampleRow['Merchant Name'] || sampleRow['MerchantName'] || sampleRow['merchant_name']

    log(`\nHenson User ID: ${userId}`, c.bright)
    log(`Merchant Name: ${merchantName}`, c.dim)

    // Get sample reference IDs
    const referenceIds = hensonRows
      .slice(0, 20)
      .map(row => row['Reference ID'] || row['ReferenceId'] || row['reference_id'])
      .filter(Boolean)

    log(`\nSample Reference IDs from Henson:`, c.bright)
    log(referenceIds.join(', '), c.dim)

    // Get date range
    const dates = hensonRows
      .map(row => row['Transaction Date'] || row['TransactionDate'] || row['transaction_date'])
      .filter(Boolean)
      .sort()

    log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}`, c.dim)

    header('Step 3: Check if Henson Reference IDs exist in Billing API')

    // Get billing transactions for the last 90 days
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const txRes = await fetchAPI('/transactions:query', '2025-07', {
      method: 'POST',
      body: JSON.stringify({
        start_date: ninetyDaysAgo.toISOString(),
        end_date: new Date().toISOString(),
      }),
    })

    if (txRes.data?.items) {
      const billingRefIds = new Set(txRes.data.items.map((tx: Record<string, unknown>) => String(tx.reference_id)))

      log(`\nBilling API reference_ids (last 90 days): ${billingRefIds.size}`, c.dim)

      // Check if any Henson reference IDs are in billing
      const matchingRefs = referenceIds.filter(id => billingRefIds.has(String(id)))

      log(`\nHenson Reference IDs found in Billing API: ${matchingRefs.length}`, matchingRefs.length > 0 ? c.green : c.yellow)

      if (matchingRefs.length > 0) {
        log(`Matching IDs: ${matchingRefs.join(', ')}`, c.green)

        header('Step 4: Test Orders API with matching Reference ID')

        const testRefId = matchingRefs[0]
        log(`\nTesting with Reference ID: ${testRefId}`, c.bright)

        // Try to get this order with Henson's User ID
        log(`\nTrying: GET /order?ReferenceId=${testRefId} with shipbob_user_id: ${userId}`, c.dim)
        const orderRes = await fetchAPI(
          `/order?ReferenceId=${testRefId}`,
          '1.0',
          {},
          { 'shipbob_user_id': String(userId) }
        )

        log(`Status: ${orderRes.status}`, orderRes.status === 200 ? c.green : c.red)
        if (orderRes.data) {
          const orders = Array.isArray(orderRes.data) ? orderRes.data : [orderRes.data]
          log(`Orders returned: ${orders.length}`, orders.length > 0 ? c.green : c.yellow)

          if (orders.length > 0) {
            log(`\nOrder found:`, c.green)
            console.log(JSON.stringify(orders[0], null, 2).substring(0, 2000))
          }
        }

        // Also try without user ID
        log(`\nTrying: GET /order?ReferenceId=${testRefId} WITHOUT user ID header`, c.dim)
        const orderRes2 = await fetchAPI(`/order?ReferenceId=${testRefId}`, '1.0')
        log(`Status: ${orderRes2.status}`, orderRes2.status === 200 ? c.green : c.red)
        if (orderRes2.data && Array.isArray(orderRes2.data)) {
          log(`Orders returned: ${orderRes2.data.length}`, orderRes2.data.length > 0 ? c.green : c.yellow)
        }

      } else {
        log(`\nHistoric Henson data may be older than 90 days`, c.yellow)

        // Get most recent Henson rows by date
        const recentHenson = hensonRows
          .filter(row => {
            const dateStr = row['Transaction Date'] || row['TransactionDate']
            if (!dateStr) return false
            const date = new Date(String(dateStr))
            return date > ninetyDaysAgo
          })
          .slice(0, 10)

        if (recentHenson.length > 0) {
          log(`\nRecent Henson rows (within 90 days): ${recentHenson.length}`, c.green)
          const recentRefs = recentHenson.map(row => row['Reference ID'] || row['ReferenceId'])
          log(`Recent Reference IDs: ${recentRefs.join(', ')}`, c.dim)
        } else {
          log(`No Henson data within last 90 days in Excel`, c.yellow)
        }
      }
    }
  }

  // Also check what merchants are in the billing transactions
  header('Step 5: Analyze Billing Transactions - Who are they from?')

  // Get unique fulfillment centers from billing to see distribution
  const txRes = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  if (txRes.data?.items) {
    const fcCounts = new Map<string, number>()
    const refIds = new Set<string>()

    txRes.data.items.forEach((tx: Record<string, unknown>) => {
      const fc = tx.fulfillment_center as string
      fcCounts.set(fc, (fcCounts.get(fc) || 0) + 1)
      refIds.add(tx.reference_id as string)
    })

    log(`\nFulfillment center distribution (last 30 days):`, c.bright)
    for (const [fc, count] of fcCounts) {
      log(`  ${fc}: ${count} transactions`, c.dim)
    }

    log(`\nTotal unique shipments: ${refIds.size}`, c.dim)
    log(`Sample reference_ids from billing: ${[...refIds].slice(0, 5).join(', ')}`, c.dim)
  }

  header('SUMMARY')
  log(`
${c.bright}The billing transactions exist and have reference_ids.${c.reset}
${c.bright}We need to determine which child account(s) they belong to.${c.reset}

${c.yellow}Possible issues:${c.reset}
1. The PAT token may only have billing access, not orders access
2. The shipbob_user_id header may not grant cross-account access
3. Child accounts may need their own PAT tokens

${c.bright}Next steps:${c.reset}
1. Check ShipBob documentation for parent/child account API access
2. Verify with ShipBob support how to access child account Orders API
3. Consider if a different authentication approach is needed
`, c.reset)
}

verify().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
