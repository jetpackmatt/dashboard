#!/usr/bin/env node
/**
 * Complete exploration of all billing API endpoints with CORRECT parameters
 * Goal: Find all available fields, especially breakdown data (fulfillment_cost, surcharge, etc.)
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return {
    data: response.ok ? await response.json() : null,
    status: response.status,
    headers: response.headers
  }
}

async function queryTransactions(params) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...params, page_size: 1000 })
    })

    if (!response.ok) return []

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null

    if (pageNum >= 20) break // Safety limit
  } while (cursor)

  return allItems
}

async function main() {
  console.log('═'.repeat(100))
  console.log('COMPLETE BILLING API FIELD EXPLORATION (WITH CORRECT PARAMS)')
  console.log('═'.repeat(100))

  // ============================================================
  // PART 1: GET /transaction-fees - All available fee types
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 1: GET /transaction-fees')
  console.log('█'.repeat(80))

  const { data: feeData } = await fetchJson(`${BASE_URL}/2025-07/transaction-fees`)
  const feeList = feeData?.fee_list || feeData || []

  console.log(`\nTotal fee types available: ${feeList.length}`)
  console.log('\nComplete list:')
  feeList.forEach((fee, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${fee}`))

  // ============================================================
  // PART 2: GET /invoices - Invoice metadata
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 2: GET /invoices')
  console.log('█'.repeat(80))

  const { data: invoicesData } = await fetchJson(
    `${BASE_URL}/2025-07/invoices?FromDate=2025-10-01&ToDate=2025-12-05&PageSize=50`
  )
  const invoices = invoicesData?.items || []

  console.log(`\nInvoices fetched: ${invoices.length}`)

  if (invoices.length > 0) {
    console.log('\nSample invoice object (ALL FIELDS):')
    console.log(JSON.stringify(invoices[0], null, 2))

    // Group by type
    const byType = {}
    for (const inv of invoices) {
      byType[inv.invoice_type] = (byType[inv.invoice_type] || 0) + 1
    }
    console.log('\nInvoices by type:')
    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type}: ${count}`)
    }
  }

  // ============================================================
  // PART 3: POST /transactions:query - ALL FIELDS ANALYSIS
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 3: POST /transactions:query - FIELD ANALYSIS')
  console.log('█'.repeat(80))

  // Get unbilled transactions (full set, includes all types)
  console.log('\nFetching ALL unbilled transactions...')
  const unbilled = await queryTransactions({ invoiced_status: false })
  console.log(`Total unbilled: ${unbilled.length}`)

  // Get invoiced transactions (last 30 days)
  console.log('\nFetching invoiced transactions (last 30 days)...')
  const invoiced = await queryTransactions({
    invoiced_status: true,
    from_date: '2025-11-01T00:00:00Z',
    to_date: '2025-12-05T23:59:59Z'
  })
  console.log(`Total invoiced: ${invoiced.length}`)

  const allTxs = [...unbilled, ...invoiced]
  console.log(`Combined: ${allTxs.length} transactions`)

  // ============================================================
  // PART 4: ANALYZE ALL FIELDS IN TRANSACTION RESPONSES
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 4: TOP-LEVEL FIELD ANALYSIS')
  console.log('█'.repeat(80))

  // Get all unique top-level keys across all transactions
  const topLevelKeys = new Set()
  for (const tx of allTxs) {
    Object.keys(tx).forEach(k => topLevelKeys.add(k))
  }

  console.log(`\nAll top-level fields found (${topLevelKeys.size}):`)
  for (const key of [...topLevelKeys].sort()) {
    const sampleVal = allTxs.find(t => t[key] !== undefined && t[key] !== null)?.[key]
    const type = typeof sampleVal
    console.log(`  ${key}: ${type} (sample: ${JSON.stringify(sampleVal).slice(0, 60)})`)
  }

  // ============================================================
  // PART 5: ANALYZE additional_details BY invoice_type
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 5: additional_details BY invoice_type')
  console.log('█'.repeat(80))

  const detailsByInvoiceType = {}
  for (const tx of allTxs) {
    const iType = tx.invoice_type || 'Unknown'
    if (!detailsByInvoiceType[iType]) {
      detailsByInvoiceType[iType] = { keys: {}, samples: [] }
    }

    const details = tx.additional_details || {}
    for (const key of Object.keys(details)) {
      if (!detailsByInvoiceType[iType].keys[key]) {
        detailsByInvoiceType[iType].keys[key] = { count: 0, samples: [] }
      }
      detailsByInvoiceType[iType].keys[key].count++
      if (detailsByInvoiceType[iType].keys[key].samples.length < 3 && details[key]) {
        detailsByInvoiceType[iType].keys[key].samples.push(details[key])
      }
    }

    if (detailsByInvoiceType[iType].samples.length < 2) {
      detailsByInvoiceType[iType].samples.push(tx)
    }
  }

  for (const [iType, data] of Object.entries(detailsByInvoiceType)) {
    console.log(`\n${iType}:`)
    console.log('  Fields in additional_details:')
    for (const [key, kd] of Object.entries(data.keys)) {
      console.log(`    ${key}: ${kd.count} occurrences`)
      if (kd.samples.length > 0) {
        console.log(`      Samples: ${kd.samples.slice(0, 2).map(s => JSON.stringify(s).slice(0, 80)).join(', ')}`)
      }
    }
    console.log('  Sample full transaction:')
    if (data.samples[0]) {
      console.log(JSON.stringify(data.samples[0], null, 4))
    }
  }

  // ============================================================
  // PART 6: ANALYZE BY transaction_fee (the detailed fee type)
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 6: BREAKDOWN BY transaction_fee')
  console.log('█'.repeat(80))

  const byTransactionFee = {}
  for (const tx of allTxs) {
    const fee = tx.transaction_fee || 'Unknown'
    if (!byTransactionFee[fee]) {
      byTransactionFee[fee] = { count: 0, totalAmount: 0, samples: [] }
    }
    byTransactionFee[fee].count++
    byTransactionFee[fee].totalAmount += tx.amount || 0
    if (byTransactionFee[fee].samples.length < 1) {
      byTransactionFee[fee].samples.push(tx)
    }
  }

  console.log('\nAll transaction_fee types found:')
  for (const [fee, data] of Object.entries(byTransactionFee).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${fee}: ${data.count} txs, $${data.totalAmount.toFixed(2)} total`)
  }

  // ============================================================
  // PART 7: DEEP DIVE - Shipping transactions (look for fulfillment_cost breakdown)
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 7: SHIPPING TRANSACTIONS - LOOKING FOR BREAKDOWN')
  console.log('█'.repeat(80))

  const shippingTxs = allTxs.filter(t => t.invoice_type === 'Shipping')
  console.log(`\nShipping transactions: ${shippingTxs.length}`)

  // Get unique transaction_fee types within Shipping
  const shippingFeeTypes = {}
  for (const tx of shippingTxs) {
    shippingFeeTypes[tx.transaction_fee] = (shippingFeeTypes[tx.transaction_fee] || 0) + 1
  }

  console.log('\nShipping transaction_fee breakdown:')
  for (const [fee, count] of Object.entries(shippingFeeTypes).sort((a, b) => b - a)) {
    console.log(`  ${fee}: ${count}`)
  }

  // Show full sample for each shipping fee type
  console.log('\n--- Full samples for each shipping fee type ---')
  const seenShipFees = new Set()
  for (const tx of shippingTxs) {
    if (!seenShipFees.has(tx.transaction_fee)) {
      seenShipFees.add(tx.transaction_fee)
      console.log(`\n${tx.transaction_fee}:`)
      console.log(JSON.stringify(tx, null, 2))
    }
    if (seenShipFees.size >= 10) break
  }

  // ============================================================
  // PART 8: LOOK FOR THESE SPECIFIC FIELDS FROM EXCEL
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 8: SEARCHING FOR EXCEL FIELDS IN API RESPONSE')
  console.log('█'.repeat(80))

  const excelFields = [
    'fulfillment_cost', 'FulfillmentCost', 'Fulfillment Cost',
    'surcharge', 'Surcharge', 'SurchargeAmount',
    'pick_fees', 'PickFees', 'Pick Fees',
    'b2b_fees', 'B2BFees', 'B2B',
    'insurance', 'Insurance',
    'carrier', 'Carrier', 'CarrierName',
    'service', 'Service', 'ServiceName',
    'zone', 'Zone',
    'weight', 'Weight', 'BillableWeight',
    'dim_weight', 'DimWeight', 'DimensionalWeight'
  ]

  console.log('\nSearching all transactions for Excel-like fields...\n')

  // Check top-level
  for (const field of excelFields) {
    const found = allTxs.filter(t => t[field] !== undefined)
    if (found.length > 0) {
      console.log(`✅ FOUND TOP-LEVEL: ${field} in ${found.length} transactions`)
      console.log(`   Sample: ${JSON.stringify(found[0][field])}`)
    }
  }

  // Check inside additional_details
  for (const field of excelFields) {
    const found = allTxs.filter(t => t.additional_details?.[field] !== undefined)
    if (found.length > 0) {
      console.log(`✅ FOUND IN additional_details: ${field} in ${found.length} transactions`)
      console.log(`   Sample: ${JSON.stringify(found[0].additional_details[field])}`)
    }
  }

  // Also do a case-insensitive search
  console.log('\nCase-insensitive search in additional_details...')
  const allDetailKeys = new Set()
  for (const tx of allTxs) {
    if (tx.additional_details) {
      Object.keys(tx.additional_details).forEach(k => allDetailKeys.add(k))
    }
  }
  console.log(`\nAll unique keys found in additional_details (${allDetailKeys.size}):`)
  for (const key of [...allDetailKeys].sort()) {
    console.log(`  ${key}`)
  }

  // ============================================================
  // PART 9: LOOK FOR SURCHARGES/FEES BREAKDOWN
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 9: SEARCHING FOR SURCHARGES/FEE BREAKDOWN')
  console.log('█'.repeat(80))

  // Look for transactions that might be surcharges
  const surchargeKeywords = ['Surcharge', 'DIM', 'Oversize', 'Residential', 'Delivery Area', 'Peak', 'Fuel']

  for (const keyword of surchargeKeywords) {
    const matches = allTxs.filter(t =>
      t.transaction_fee?.includes(keyword) ||
      t.additional_details?.Comment?.includes(keyword)
    )
    if (matches.length > 0) {
      console.log(`\n${keyword}: ${matches.length} transactions found`)
      console.log('  Sample:')
      console.log(JSON.stringify(matches[0], null, 2))
    }
  }

  // ============================================================
  // PART 10: CHECK IF ONE SHIPMENT HAS MULTIPLE TRANSACTIONS
  // ============================================================
  console.log('\n' + '█'.repeat(80))
  console.log('PART 10: SHIPMENT → MULTIPLE TRANSACTIONS ANALYSIS')
  console.log('█'.repeat(80))

  // Group by reference_id (shipment_id)
  const byRefId = {}
  for (const tx of allTxs.filter(t => t.reference_type === 'Shipment')) {
    if (!byRefId[tx.reference_id]) {
      byRefId[tx.reference_id] = []
    }
    byRefId[tx.reference_id].push(tx)
  }

  const multiTxShipments = Object.entries(byRefId).filter(([_, txs]) => txs.length > 1)
  console.log(`\nShipments with MULTIPLE transactions: ${multiTxShipments.length}`)

  if (multiTxShipments.length > 0) {
    const [shipmentId, txs] = multiTxShipments[0]
    console.log(`\nSample shipment ${shipmentId} has ${txs.length} transactions:`)
    for (const tx of txs) {
      console.log(`  ${tx.transaction_fee}: $${tx.amount.toFixed(2)} (${tx.transaction_id})`)
    }
    console.log('\nFull details:')
    for (const tx of txs) {
      console.log(JSON.stringify(tx, null, 2))
      console.log('---')
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('SUMMARY: API FIELD AVAILABILITY')
  console.log('█'.repeat(100))

  console.log(`
FIELDS AVAILABLE IN API:
========================

TOP-LEVEL TRANSACTION FIELDS:
- transaction_id: Unique ID
- amount: Charge amount
- charge_date: Date of charge
- transaction_type: Charge/Refund/Credit/Payment
- transaction_fee: Specific fee type (e.g., "Ground", "Per Pick Fee")
- invoice_type: Category (Shipping, AdditionalFee, etc.)
- reference_id: Links to shipment/order/return/etc.
- reference_type: Type of reference (Shipment, Return, FC, etc.)
- invoiced_status: Boolean (billed or not)
- invoice_id: Which invoice this belongs to
- fulfillment_center: FC info (id + name)
- taxes: Array of tax objects
- additional_details: JSONB with extra info

ADDITIONAL_DETAILS CONTENTS:
- Comment: Text description
- TrackingId: Tracking number
- CreditReason: For credits
- InventoryId: For storage (often empty)
- LocationType: For storage (often empty)

CRITICAL FINDING:
The API does NOT break down a single shipment's cost into:
- Base fulfillment cost
- Surcharge amounts
- Pick fees
- etc.

INSTEAD: Each fee is a SEPARATE TRANSACTION with the same reference_id!
A single shipment may have:
- 1 transaction for "Ground" (base shipping)
- 1 transaction for "Per Pick Fee"
- 1 transaction for "Surcharge" (if applicable)
- etc.

This means we can COMPUTE the breakdown by grouping transactions by reference_id!
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
