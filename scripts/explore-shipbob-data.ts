#!/usr/bin/env npx tsx
/**
 * ShipBob Data Explorer
 *
 * Pulls comprehensive data samples and saves them for inspection.
 * Run with: npx tsx scripts/explore-shipbob-data.ts
 *
 * Output: scripts/output/ directory with JSON files
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const token = process.env.SHIPBOB_API_TOKEN!
const baseUrl = process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

// Create output directory
const outputDir = path.resolve(process.cwd(), 'scripts/output')
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
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

async function fetchAPI(endpoint: string, version = '2025-07', options: RequestInit = {}) {
  const url = `${baseUrl}/${version}${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  return text ? JSON.parse(text) : {}
}

function saveJSON(filename: string, data: unknown) {
  const filepath = path.join(outputDir, filename)
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2))
  log(`  Saved: scripts/output/${filename}`, c.dim)
}

interface Transaction {
  transaction_id: string
  reference_id: string
  reference_type: string
  transaction_fee: string
  transaction_type: string
  amount: number
  charge_date: string
  invoiced_status: boolean
  invoice_id: number | null
  invoice_type: string | null
  fulfillment_center: string
  additional_details: Record<string, unknown>
}

interface Invoice {
  invoice_id: number
  invoice_date: string
  invoice_type: string
  amount: number
  currency_code: string
  running_balance: number
}

async function explore() {
  header('ShipBob Data Explorer')
  log(`Token: ${token.substring(0, 8)}...${token.substring(token.length - 4)}`)
  log(`Output directory: scripts/output/`)

  // ============================================================
  // 1. Get ALL invoices (up to 100)
  // ============================================================
  header('1. Fetching All Invoice Types')

  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

  let allInvoices: Invoice[] = []
  let cursor: string | undefined

  // Paginate through invoices
  do {
    const params = new URLSearchParams({
      startDate: ninetyDaysAgo.toISOString(),
      pageSize: '100',
    })
    if (cursor) params.set('cursor', cursor)

    const response = await fetchAPI(`/invoices?${params}`)
    allInvoices = allInvoices.concat(response.items || [])
    cursor = response.next
  } while (cursor && allInvoices.length < 500)

  log(`\nFound ${allInvoices.length} invoices in last 90 days`, c.green)

  // Group by invoice type
  const invoicesByType = allInvoices.reduce((acc, inv) => {
    acc[inv.invoice_type] = acc[inv.invoice_type] || []
    acc[inv.invoice_type].push(inv)
    return acc
  }, {} as Record<string, Invoice[]>)

  log('\nInvoice Types Found:', c.bright)
  Object.entries(invoicesByType)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([type, invoices]) => {
      const total = invoices.reduce((sum, i) => sum + i.amount, 0)
      log(`  ${type}: ${invoices.length} invoices, $${total.toFixed(2)} total`, c.dim)
    })

  saveJSON('invoices-all.json', allInvoices)
  saveJSON('invoices-by-type.json', invoicesByType)

  // ============================================================
  // 2. Get ALL transactions (up to 500)
  // ============================================================
  header('2. Fetching All Transaction Types')

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const transactionsResponse = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      start_date: thirtyDaysAgo.toISOString(),
      end_date: new Date().toISOString(),
    }),
  })

  const allTransactions: Transaction[] = transactionsResponse.items || []
  log(`\nFound ${allTransactions.length} transactions in last 30 days`, c.green)

  // Group by fee type
  const transactionsByFee = allTransactions.reduce((acc, tx) => {
    acc[tx.transaction_fee] = acc[tx.transaction_fee] || []
    acc[tx.transaction_fee].push(tx)
    return acc
  }, {} as Record<string, Transaction[]>)

  log('\nTransaction Fee Types Found:', c.bright)
  Object.entries(transactionsByFee)
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([type, txs]) => {
      const total = txs.reduce((sum, t) => sum + t.amount, 0)
      log(`  ${type}: ${txs.length} transactions, $${total.toFixed(2)} total`, c.dim)
    })

  // Group by reference type
  const transactionsByRefType = allTransactions.reduce((acc, tx) => {
    acc[tx.reference_type] = acc[tx.reference_type] || []
    acc[tx.reference_type].push(tx)
    return acc
  }, {} as Record<string, Transaction[]>)

  log('\nReference Types Found:', c.bright)
  Object.entries(transactionsByRefType).forEach(([type, txs]) => {
    log(`  ${type}: ${txs.length} transactions`, c.dim)
  })

  // Group by transaction type
  const transactionsByTxType = allTransactions.reduce((acc, tx) => {
    acc[tx.transaction_type] = acc[tx.transaction_type] || []
    acc[tx.transaction_type].push(tx)
    return acc
  }, {} as Record<string, Transaction[]>)

  log('\nTransaction Types (Charge/Refund/Credit):', c.bright)
  Object.entries(transactionsByTxType).forEach(([type, txs]) => {
    const total = txs.reduce((sum, t) => sum + t.amount, 0)
    log(`  ${type}: ${txs.length} transactions, $${total.toFixed(2)} total`, c.dim)
  })

  saveJSON('transactions-all.json', allTransactions)
  saveJSON('transactions-by-fee-type.json', transactionsByFee)
  saveJSON('transactions-by-reference-type.json', transactionsByRefType)

  // ============================================================
  // 3. ID Relationship Analysis
  // ============================================================
  header('3. ID Relationship Analysis')

  log('\nKey ID Fields in Transactions:', c.bright)
  if (allTransactions.length > 0) {
    const sample = allTransactions[0]
    log(`  transaction_id: "${sample.transaction_id}" (unique per fee line item)`, c.dim)
    log(`  reference_id: "${sample.reference_id}" (the Shipment/Order/Return ID)`, c.dim)
    log(`  reference_type: "${sample.reference_type}" (what reference_id refers to)`, c.dim)
    log(`  invoice_id: ${sample.invoice_id} (null until invoiced)`, c.dim)
  }

  // Find transactions with same reference_id (multi-fee shipments)
  const refIdCounts = allTransactions.reduce((acc, tx) => {
    acc[tx.reference_id] = (acc[tx.reference_id] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const multiFeeTxs = Object.entries(refIdCounts).filter(([, count]) => count > 1)

  log('\nMulti-Fee Reference IDs (same shipment, multiple fees):', c.bright)
  if (multiFeeTxs.length > 0) {
    const examples = multiFeeTxs.slice(0, 5)
    for (const [refId, count] of examples) {
      const txs = allTransactions.filter(t => t.reference_id === refId)
      log(`  reference_id: ${refId} has ${count} transactions:`, c.dim)
      txs.forEach(tx => {
        log(`    - ${tx.transaction_fee}: $${tx.amount.toFixed(2)}`, c.dim)
      })
    }
  } else {
    log('  (No multi-fee transactions found in sample)', c.yellow)
  }

  // Save a detailed breakdown for one reference_id
  if (multiFeeTxs.length > 0) {
    const exampleRefId = multiFeeTxs[0][0]
    const exampleTxs = allTransactions.filter(t => t.reference_id === exampleRefId)
    saveJSON('example-multi-fee-shipment.json', {
      reference_id: exampleRefId,
      transactions: exampleTxs,
      explanation: {
        note: 'This shows all fee line items for a single shipment',
        reference_id: 'The shipment/order ID that links all fees together',
        transaction_id: 'Unique ID for each fee line item',
        total_cost: exampleTxs.reduce((sum, t) => sum + t.amount, 0),
      },
    })
  }

  // ============================================================
  // 4. Check for Orders with embedded data
  // ============================================================
  header('4. Orders API Structure')

  try {
    const orders = await fetchAPI('/order?Limit=5', '1.0')
    if (Array.isArray(orders) && orders.length > 0) {
      log(`Found ${orders.length} orders`, c.green)
      log('\nOrder structure keys:', c.bright)
      log(`  ${Object.keys(orders[0]).join(', ')}`, c.dim)
      saveJSON('orders-sample.json', orders)
    } else {
      log('No orders found in account (or empty array)', c.yellow)
    }
  } catch (err) {
    log(`Orders API error: ${err instanceof Error ? err.message : 'Unknown'}`, c.yellow)
  }

  // ============================================================
  // 5. Summary and Recommendations
  // ============================================================
  header('5. Summary: Universal ID Strategy')

  log(`
${c.bright}Key Finding: reference_id is the universal linker${c.reset}

${c.cyan}How IDs work in ShipBob:${c.reset}

  1. ${c.bright}reference_id${c.reset} - The shipment/order/return ID
     - Links multiple fee transactions to one shipment
     - Example: Shipment #320263454 has Shipping + Per Pick Fee
     - This is your JOIN key for cost rollups

  2. ${c.bright}transaction_id${c.reset} - Unique per fee line item
     - Example: "01KAYV6C5T8FSYNG67B5PTAP50"
     - Use for deduplication (primary key in our DB)

  3. ${c.bright}reference_type${c.reset} - What the reference_id refers to
     - "Shipment" = B2C shipment
     - "Return" = Customer return
     - "Order" = B2B order
     - etc.

  4. ${c.bright}invoice_id${c.reset} - Weekly billing invoice
     - null until ShipBob invoices the charge
     - Links to invoices table for reconciliation

${c.yellow}For our schema:${c.reset}
  - Store transaction_id as PRIMARY KEY (dedup)
  - Store reference_id + reference_type for linking
  - Query: "All costs for shipment X" = WHERE reference_id = X
  - Query: "All shipments" = WHERE reference_type = 'Shipment'
`, c.reset)

  // ============================================================
  // Done
  // ============================================================
  header('Exploration Complete')
  log(`\nOutput files saved to: ${c.bright}scripts/output/${c.reset}`)
  log('\nFiles created:', c.dim)
  fs.readdirSync(outputDir).forEach(file => {
    const stats = fs.statSync(path.join(outputDir, file))
    log(`  ${file} (${(stats.size / 1024).toFixed(1)} KB)`, c.dim)
  })

  log(`\n${c.bright}Open these files to inspect the raw data:${c.reset}`)
  log(`  code scripts/output/invoices-by-type.json`, c.dim)
  log(`  code scripts/output/transactions-by-fee-type.json`, c.dim)
  log(`  code scripts/output/example-multi-fee-shipment.json`, c.dim)
}

explore().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
