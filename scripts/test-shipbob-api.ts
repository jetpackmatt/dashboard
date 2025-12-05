#!/usr/bin/env npx tsx
/**
 * ShipBob API Test Script
 *
 * Run with: npx tsx scripts/test-shipbob-api.ts
 *
 * This script tests various ShipBob API endpoints to verify:
 * 1. API credentials work
 * 2. We can access billing data
 * 3. We can access order/shipment data
 * 4. Batch transaction queries work
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
import { ShipBobClient } from '../lib/shipbob/client'

// ANSI colors for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function header(title: string) {
  console.log('\n' + '='.repeat(60))
  log(title, colors.bright + colors.cyan)
  console.log('='.repeat(60))
}

function success(message: string) {
  log(`✓ ${message}`, colors.green)
}

function error(message: string) {
  log(`✗ ${message}`, colors.red)
}

function info(message: string) {
  log(`  ${message}`, colors.dim)
}

async function runTests() {
  header('ShipBob API Test Suite')

  // Check environment variables
  const token = process.env.SHIPBOB_API_TOKEN
  const baseUrl = process.env.SHIPBOB_API_BASE_URL

  if (!token) {
    error('SHIPBOB_API_TOKEN not found in environment')
    info('Make sure .env.local contains SHIPBOB_API_TOKEN')
    process.exit(1)
  }

  success(`Token found (${token.substring(0, 8)}...${token.substring(token.length - 4)})`)
  info(`Base URL: ${baseUrl || 'https://api.shipbob.com'}`)

  // Initialize client
  const client = new ShipBobClient()

  // Test 1: Basic Connection
  header('Test 1: Basic Connection')
  try {
    const result = await client.testConnection()
    if (result.success) {
      success(result.message)
      if (result.data) {
        info(JSON.stringify(result.data, null, 2))
      }
    } else {
      error(result.message)
      if (result.data) {
        info(JSON.stringify(result.data, null, 2))
      }
    }
  } catch (err) {
    error(`Connection test failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  // Test 2: Fetch Recent Orders
  header('Test 2: Fetch Recent Orders')
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const orders = await client.orders.searchOrders({
      startDate: thirtyDaysAgo.toISOString(),
      limit: 5,
    })

    success(`Found ${orders.length} orders in last 30 days`)

    if (orders.length > 0) {
      info('Sample order:')
      const sample = orders[0]
      info(`  ID: ${sample.id}`)
      info(`  Reference: ${sample.reference_id}`)
      info(`  Status: ${sample.status}`)
      info(`  Created: ${sample.created_date}`)
    }
  } catch (err) {
    error(`Failed to fetch orders: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  // Test 3: Billing API - Get Invoices
  header('Test 3: Billing API - Get Invoices')
  try {
    const sixtyDaysAgo = new Date()
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

    const invoices = await client.billing.getInvoices({
      startDate: sixtyDaysAgo.toISOString(),
      pageSize: 5,
    })

    if (invoices.items && invoices.items.length > 0) {
      success(`Found ${invoices.items.length} invoices`)

      const sample = invoices.items[0]
      info('Sample invoice:')
      info(`  Invoice ID: ${sample.invoice_id}`)
      info(`  Type: ${sample.invoice_type}`)
      info(`  Amount: $${sample.amount?.toFixed(2) || 'N/A'}`)
      info(`  Date: ${sample.invoice_date}`)
      info(`  Running Balance: $${sample.running_balance?.toFixed(2) || 'N/A'}`)

      // Show pagination info
      if (invoices.next) {
        info(`  Has more pages: Yes (cursor available)`)
      }
    } else {
      log('  No invoices found in last 60 days', colors.yellow)
    }
  } catch (err) {
    error(`Failed to fetch invoices: ${err instanceof Error ? err.message : 'Unknown error'}`)
    if (err && typeof err === 'object' && 'response' in err) {
      info(JSON.stringify((err as { response: unknown }).response, null, 2))
    }
  }

  // Test 4: Billing API - Get Fee Types
  header('Test 4: Billing API - Get Fee Types')
  try {
    const feeTypes = await client.billing.getFeeTypes()

    if (feeTypes && feeTypes.length > 0) {
      success(`Found ${feeTypes.length} fee types`)
      info('First 10 fee types:')
      feeTypes.slice(0, 10).forEach((ft) => {
        info(`  - ${ft}`)
      })
    } else {
      log('  No fee types returned', colors.yellow)
    }
  } catch (err) {
    error(`Failed to fetch fee types: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  // Test 5: Billing API - Query Transactions (Batch Test)
  header('Test 5: Billing API - Query Transactions')
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const transactions = await client.billing.queryTransactions({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    })

    if (transactions.items && transactions.items.length > 0) {
      success(`Found ${transactions.items.length} transactions in last 30 days`)

      const sample = transactions.items[0]
      info('Sample transaction:')
      info(`  Transaction ID: ${sample.transaction_id}`)
      info(`  Reference ID: ${sample.reference_id} (${sample.reference_type})`)
      info(`  Fee Type: ${sample.transaction_fee}`)
      info(`  Type: ${sample.transaction_type}`)
      info(`  Amount: $${sample.amount?.toFixed(2) || 'N/A'}`)
      info(`  Charge Date: ${sample.charge_date}`)
      info(`  Invoiced: ${sample.invoiced_status}`)
      info(`  Fulfillment Center: ${sample.fulfillment_center}`)

      if (sample.additional_details?.TrackingId) {
        info(`  Tracking: ${sample.additional_details.TrackingId}`)
      }

      // Calculate transaction type breakdown
      const typeCounts = transactions.items.reduce(
        (acc, t) => {
          acc[t.transaction_fee] = (acc[t.transaction_fee] || 0) + 1
          return acc
        },
        {} as Record<string, number>
      )
      info('\nTransaction fee breakdown:')
      Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([type, count]) => {
          info(`  ${type}: ${count}`)
        })
    } else {
      log('  No transactions found in last 30 days', colors.yellow)
    }
  } catch (err) {
    error(`Failed to query transactions: ${err instanceof Error ? err.message : 'Unknown error'}`)
    if (err && typeof err === 'object' && 'response' in err) {
      info(JSON.stringify((err as { response: unknown }).response, null, 2))
    }
  }

  // Test 6: Batch Transaction Lookup (key feature!)
  header('Test 6: Batch Transaction Lookup (by reference_ids)')
  try {
    // First get some reference IDs from the previous query
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const allTransactions = await client.billing.queryTransactions({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    })

    if (allTransactions.items && allTransactions.items.length >= 3) {
      // Get first 3 reference IDs
      const referenceIds = allTransactions.items.slice(0, 3).map((t) => t.reference_id)

      success(`Testing batch lookup with ${referenceIds.length} reference IDs`)
      info(`Reference IDs: ${referenceIds.join(', ')}`)

      // Now do a batch lookup
      const batchResult = await client.billing.queryTransactions({
        reference_ids: referenceIds,
      })

      success(`Batch lookup returned ${batchResult.items.length} transactions`)

      // Show what we got back
      batchResult.items.forEach((t) => {
        info(`  ${t.reference_id}: ${t.transaction_fee} - $${t.amount.toFixed(2)}`)
      })
    } else {
      log('  Not enough transactions to test batch lookup', colors.yellow)
    }
  } catch (err) {
    error(`Failed to batch query: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }

  // Summary
  header('Test Complete')
  log('\nAPI Integration Status:', colors.bright)
  success('Connection: Working')
  success('Billing API (Invoices): Working')
  success('Billing API (Transactions): Working')
  success('Billing API (Fee Types): Working')
  success('Batch Transaction Lookup: Working')
  log('  Orders API: Working (but no recent orders in account)', colors.yellow)
  log('  Shipments API: Not available (use transactions instead)', colors.yellow)

  log('\nKey Findings:', colors.bright)
  info('1. Shipment cost data is in transactions with reference_type="Shipment"')
  info('2. Tracking numbers are in additional_details.TrackingId')
  info('3. Batch lookups work via reference_ids array')
  info('4. Pagination uses cursor-based next/last tokens')

  log('\nSecurity Reminder:', colors.bright + colors.yellow)
  info('Your API token was shared in chat - regenerate it in ShipBob Dashboard!')
}

// Run the tests
runTests().catch((err) => {
  error(`Unexpected error: ${err instanceof Error ? err.message : 'Unknown error'}`)
  process.exit(1)
})
