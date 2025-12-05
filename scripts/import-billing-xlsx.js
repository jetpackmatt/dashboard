#!/usr/bin/env node
/**
 * Import Billing Data from ShipBob Excel Exports
 *
 * Imports 6 billing files into Supabase:
 *   - SHIPMENTS.xlsx → billing_shipments (73,666 rows)
 *   - ADDITIONAL-SERVICES.xlsx → billing_shipment_fees (51,366 rows)
 *   - STORAGE.xlsx → billing_storage (14,466 rows)
 *   - CREDITS.xlsx → billing_credits (336 rows)
 *   - RETURNS.xlsx → billing_returns (204 rows)
 *   - RECEIVING.xlsx → billing_receiving (118 rows)
 *
 * Excel files contain data for ALL merchants (identified by "User ID" column).
 * Each row is mapped to the correct client_id based on the merchant_id.
 *
 * Usage:
 *   node scripts/import-billing-xlsx.js                    # Import all files
 *   node scripts/import-billing-xlsx.js --file=shipments   # Import single file
 *   node scripts/import-billing-xlsx.js --dry-run          # Preview without inserting
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')
const fs = require('fs')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Merchant ID → Client ID mapping
// ShipBob "User ID" in Excel → our internal client UUID
const MERCHANTS = {
  '386350': {
    client_id: '6b94c274-0446-4167-9d02-b998f8be59ad',
    name: 'Henson Shaving'
  },
  '392333': {
    client_id: 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e',
    name: 'Methyl-Life'
  }
}

// Reverse lookup: Merchant Name → Merchant ID (for storage.xlsx which uses names)
const MERCHANT_NAME_TO_ID = {
  'Henson Shaving': '386350',
  'Methyl-Life': '392333',
  'Methyl-Life®': '392333'
}

const BATCH_SIZE = 500
const DATA_DIR = path.join(__dirname, '../reference/data/historic')

// ============================================
// UTILITY FUNCTIONS
// ============================================

function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    dryRun: false,
    file: null  // null = all files
  }

  for (const arg of args) {
    if (arg === '--dry-run') config.dryRun = true
    else if (arg.startsWith('--file=')) config.file = arg.split('=')[1].toLowerCase()
  }

  return config
}

// Get client_id from merchant_id (User ID in Excel) or merchant name
// Returns { client_id, merchant_id } or null if unknown merchant
function getMerchantMapping(row) {
  // Try common column names for merchant/user ID
  let merchantId = String(row['User ID'] || row['UserID'] || row['Merchant ID'] || row['MerchantID'] || '')

  // If no ID found, try merchant name (storage.xlsx uses "Merchant Name" not "User ID")
  if (!merchantId) {
    const merchantName = row['Merchant Name'] || row['MerchantName'] || ''
    if (merchantName && MERCHANT_NAME_TO_ID[merchantName]) {
      merchantId = MERCHANT_NAME_TO_ID[merchantName]
    }
  }

  if (!merchantId) {
    return null
  }

  const merchant = MERCHANTS[merchantId]
  if (!merchant) {
    return null  // Unknown merchant - will be logged
  }

  return {
    client_id: merchant.client_id,
    merchant_id: merchantId
  }
}

// Convert Excel serial date to JavaScript Date
function excelDateToJS(excelDate) {
  if (!excelDate || typeof excelDate !== 'number') return null
  // Excel dates are days since 1899-12-30
  const date = new Date((excelDate - 25569) * 86400 * 1000)
  return date.toISOString().split('T')[0]  // Return YYYY-MM-DD
}

// Deduplicate records by conflict keys (keep last occurrence)
function dedupeByKeys(records, keyFields) {
  if (!keyFields) return records
  const keys = keyFields.split(',').map(k => k.trim())
  const seen = new Map()

  // Process in order, keeping last occurrence
  for (const record of records) {
    const key = keys.map(k => record[k]).join('|')
    seen.set(key, record)
  }

  return Array.from(seen.values())
}

// Batch upsert with progress
// If onConflict is null, uses plain insert instead of upsert
async function batchUpsert(table, records, onConflict, dryRun = false) {
  if (records.length === 0) return { success: 0, failed: 0 }

  // Dedupe records by conflict keys to avoid "cannot affect row a second time" error
  const dedupedRecords = dedupeByKeys(records, onConflict)
  if (dedupedRecords.length < records.length) {
    console.log(`  Deduped: ${records.length} → ${dedupedRecords.length} (${records.length - dedupedRecords.length} duplicates removed)`)
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would insert ${dedupedRecords.length} records into ${table}`)
    return { success: dedupedRecords.length, failed: 0 }
  }

  let successCount = 0
  let failedCount = 0

  for (let i = 0; i < dedupedRecords.length; i += BATCH_SIZE) {
    const batch = dedupedRecords.slice(i, i + BATCH_SIZE)
    let result

    if (onConflict) {
      // Upsert with conflict resolution
      result = await supabase
        .from(table)
        .upsert(batch, { onConflict, ignoreDuplicates: false })
    } else {
      // Plain insert (no unique constraint to conflict on)
      result = await supabase
        .from(table)
        .insert(batch)
    }

    if (result.error) {
      console.log(`  ERROR batch ${Math.floor(i / BATCH_SIZE) + 1}: ${result.error.message}`)
      failedCount += batch.length
    } else {
      successCount += batch.length
    }

    // Progress indicator
    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= dedupedRecords.length) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, dedupedRecords.length)}/${dedupedRecords.length}`)
    }
  }

  return { success: successCount, failed: failedCount }
}

// ============================================
// IMPORT FUNCTIONS FOR EACH FILE TYPE
// ============================================

async function importShipments(dryRun) {
  console.log('\n=== IMPORTING SHIPMENTS ===')
  const filepath = path.join(DATA_DIR, 'shipments.xlsx')

  if (!fs.existsSync(filepath)) {
    console.log('  File not found:', filepath)
    return { success: 0, failed: 0, skipped: 0 }
  }

  const workbook = XLSX.readFile(filepath)
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  console.log(`  Loaded ${data.length} rows`)

  const records = []
  const unknownMerchants = new Set()

  for (const row of data) {
    const mapping = getMerchantMapping(row)
    if (!mapping) {
      unknownMerchants.add(row['User ID'] || row['UserID'] || 'unknown')
      continue
    }

    records.push({
      client_id: mapping.client_id,
      merchant_id: mapping.merchant_id,
      shipment_id: row['TrackingId'] ? String(row['TrackingId']) : null,
      order_id: row['OrderID'] ? parseInt(row['OrderID']) : null,
      transaction_status: row['Transaction Status'] || null,
      transaction_type: row['Transaction Type'] || null,
      invoice_number: row['Invoice Number'] ? parseInt(row['Invoice Number']) : null,
      invoice_date: excelDateToJS(row['Invoice Date']),
      transaction_date: excelDateToJS(row['Transaction Date']),
      fulfillment_cost: row['Fulfillment without Surcharge'] || null,
      surcharge: row['Surcharge Applied'] || null,
      total_amount: row['Original Invoice'] || null,
      pick_fees: row['Pick Fees'] || null,
      b2b_fees: row['B2B Fees'] || null,
      insurance: row['Insurance Amount'] || null,
      store_integration_name: row['StoreIntegrationName'] || null,
      products_sold: row['Products Sold'] || null,
      total_quantity: row['Total Quantity'] ? parseInt(row['Total Quantity']) : null,
      order_category: row['Order Category'] || null,
      transit_time_days: row['Transit Time (Days)'] || null,
      source: 'excel_import'
    })
  }

  if (unknownMerchants.size > 0) {
    console.log(`  WARNING: Skipped ${data.length - records.length} rows with unknown merchants: ${[...unknownMerchants].join(', ')}`)
  }

  const result = await batchUpsert('billing_shipments', records, 'client_id,shipment_id,transaction_type,invoice_number', dryRun)
  result.skipped = data.length - records.length
  return result
}

async function importShipmentFees(dryRun) {
  console.log('\n=== IMPORTING SHIPMENT FEES ===')
  const filepath = path.join(DATA_DIR, 'additional-services.xlsx')

  if (!fs.existsSync(filepath)) {
    console.log('  File not found:', filepath)
    return { success: 0, failed: 0, skipped: 0 }
  }

  const workbook = XLSX.readFile(filepath)
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  console.log(`  Loaded ${data.length} rows`)

  const records = []
  const unknownMerchants = new Set()

  for (const row of data) {
    const mapping = getMerchantMapping(row)
    if (!mapping) {
      unknownMerchants.add(row['User ID'] || row['UserID'] || 'unknown')
      continue
    }

    records.push({
      client_id: mapping.client_id,
      merchant_id: mapping.merchant_id,
      shipment_id: row['Reference ID'] ? String(row['Reference ID']) : '',
      fee_type: row['Fee Type'] || null,
      amount: row['Invoice Amount'] || null,
      transaction_date: excelDateToJS(row['Transaction Date']),
      invoice_number: row['Invoice Number'] && row['Invoice Number'] !== '0' ? parseInt(row['Invoice Number']) : null,
      // Note: additional-services.xlsx doesn't have Invoice Date column
      transaction_status: row['Transaction Status'] || null,
      source: 'excel_import'
    })
  }

  if (unknownMerchants.size > 0) {
    console.log(`  WARNING: Skipped ${data.length - records.length} rows with unknown merchants: ${[...unknownMerchants].join(', ')}`)
  }

  const result = await batchUpsert('billing_shipment_fees', records, null, dryRun)
  result.skipped = data.length - records.length
  return result
}

async function importStorage(dryRun) {
  console.log('\n=== IMPORTING STORAGE ===')
  const filepath = path.join(DATA_DIR, 'storage.xlsx')

  if (!fs.existsSync(filepath)) {
    console.log('  File not found:', filepath)
    return { success: 0, failed: 0, skipped: 0 }
  }

  const workbook = XLSX.readFile(filepath)
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  console.log(`  Loaded ${data.length} rows`)

  // Regex to parse Comment field: "| N type(s) @$X/month"
  const commentRegex = /\|\s*(\d+)\s+(\w+)\(s\)\s+@\$([0-9.]+)\/month/i

  const records = []
  const unknownMerchants = new Set()

  for (const row of data) {
    const mapping = getMerchantMapping(row)
    if (!mapping) {
      unknownMerchants.add(row['User ID'] || row['UserID'] || 'unknown')
      continue
    }

    const comment = row['Comment'] || ''
    const match = comment.match(commentRegex)

    let quantity = null
    let ratePerMonth = null

    if (match) {
      quantity = parseInt(match[1])
      ratePerMonth = parseFloat(match[3])
    }

    records.push({
      client_id: mapping.client_id,
      merchant_id: mapping.merchant_id,
      inventory_id: row['Inventory ID'] ? parseInt(row['Inventory ID']) : 0,
      charge_start_date: excelDateToJS(row['ChargeStartdate']),
      fc_name: row['FC Name'] || null,
      location_type: row['Location Type'] || null,
      quantity: quantity,
      rate_per_month: ratePerMonth,
      amount: row['Invoice'] || null,
      invoice_number: row['Invoice Number'] ? parseInt(row['Invoice Number']) : null,
      invoice_date: excelDateToJS(row['Invoice Date']),
      transaction_status: row['Transaction Status'] || null,
      comment: comment || null,
      source: 'excel_import'
    })
  }

  if (unknownMerchants.size > 0) {
    console.log(`  WARNING: Skipped ${data.length - records.length} rows with unknown merchants: ${[...unknownMerchants].join(', ')}`)
  }

  const result = await batchUpsert('billing_storage', records, 'client_id,inventory_id,charge_start_date', dryRun)
  result.skipped = data.length - records.length
  return result
}

async function importCredits(dryRun) {
  console.log('\n=== IMPORTING CREDITS ===')
  const filepath = path.join(DATA_DIR, 'credits.xlsx')

  if (!fs.existsSync(filepath)) {
    console.log('  File not found:', filepath)
    return { success: 0, failed: 0, skipped: 0 }
  }

  const workbook = XLSX.readFile(filepath)
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  console.log(`  Loaded ${data.length} rows`)

  const records = []
  const unknownMerchants = new Set()

  for (const row of data) {
    const mapping = getMerchantMapping(row)
    if (!mapping) {
      unknownMerchants.add(row['User ID'] || row['UserID'] || 'unknown')
      continue
    }

    records.push({
      client_id: mapping.client_id,
      merchant_id: mapping.merchant_id,
      reference_id: row['Reference ID'] ? String(row['Reference ID']) : null,
      credit_reason: row['Credit Reason'] || null,
      credit_amount: row['Credit Amount'] || null,
      transaction_date: excelDateToJS(row['Transaction Date']),
      credit_invoice_number: row['Credit Invoice Number'] ? parseInt(row['Credit Invoice Number']) : null,
      invoice_date: excelDateToJS(row['Invoice Date']),
      transaction_status: row['Transaction Status'] || null,
      source: 'excel_import'
    })
  }

  if (unknownMerchants.size > 0) {
    console.log(`  WARNING: Skipped ${data.length - records.length} rows with unknown merchants: ${[...unknownMerchants].join(', ')}`)
  }

  const result = await batchUpsert('billing_credits', records, null, dryRun)
  result.skipped = data.length - records.length
  return result
}

async function importReturns(dryRun) {
  console.log('\n=== IMPORTING RETURNS ===')
  const filepath = path.join(DATA_DIR, 'returns.xlsx')

  if (!fs.existsSync(filepath)) {
    console.log('  File not found:', filepath)
    return { success: 0, failed: 0, skipped: 0 }
  }

  const workbook = XLSX.readFile(filepath)
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  console.log(`  Loaded ${data.length} rows`)

  const records = []
  const unknownMerchants = new Set()

  for (const row of data) {
    const mapping = getMerchantMapping(row)
    if (!mapping) {
      unknownMerchants.add(row['User ID'] || row['UserID'] || 'unknown')
      continue
    }

    records.push({
      client_id: mapping.client_id,
      merchant_id: mapping.merchant_id,
      return_id: row['Return ID'] ? parseInt(row['Return ID']) : 0,
      original_order_id: row['Original Order ID'] ? parseInt(row['Original Order ID']) : null,
      tracking_id: row['Tracking ID'] ? String(row['Tracking ID']) : null,
      transaction_type: row['Transaction Type'] || null,
      return_status: row['Return Status'] || null,
      return_type: row['Return Type'] || null,
      return_creation_date: excelDateToJS(row['Return Creation Date']),
      fc_name: row['FC Name'] || null,
      amount: row['Invoice'] || null,
      invoice_number: row['Invoice Number'] && row['Invoice Number'] !== 0 ? parseInt(row['Invoice Number']) : null,
      // Note: returns.xlsx doesn't have Invoice Date column
      transaction_status: row['Transaction Status'] || null,
      source: 'excel_import'
    })
  }

  if (unknownMerchants.size > 0) {
    console.log(`  WARNING: Skipped ${data.length - records.length} rows with unknown merchants: ${[...unknownMerchants].join(', ')}`)
  }

  const result = await batchUpsert('billing_returns', records, 'client_id,return_id', dryRun)
  result.skipped = data.length - records.length
  return result
}

async function importReceiving(dryRun) {
  console.log('\n=== IMPORTING RECEIVING ===')
  const filepath = path.join(DATA_DIR, 'receiving.xlsx')

  if (!fs.existsSync(filepath)) {
    console.log('  File not found:', filepath)
    return { success: 0, failed: 0, skipped: 0 }
  }

  const workbook = XLSX.readFile(filepath)
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
  console.log(`  Loaded ${data.length} rows`)

  const records = []
  const unknownMerchants = new Set()

  for (const row of data) {
    const mapping = getMerchantMapping(row)
    if (!mapping) {
      unknownMerchants.add(row['User ID'] || row['UserID'] || 'unknown')
      continue
    }

    records.push({
      client_id: mapping.client_id,
      merchant_id: mapping.merchant_id,
      reference_id: row['Reference ID'] ? String(row['Reference ID']) : '',
      fee_type: row['Fee Type'] || null,
      amount: row['Invoice Amount'] || null,
      transaction_type: row['Transaction Type'] || null,
      transaction_date: excelDateToJS(row['Transaction Date']),
      invoice_number: row['Invoice Number'] ? parseInt(row['Invoice Number']) : null,
      invoice_date: excelDateToJS(row['Invoice Date']),
      transaction_status: row['Transaction Status'] || null,
      source: 'excel_import'
    })
  }

  if (unknownMerchants.size > 0) {
    console.log(`  WARNING: Skipped ${data.length - records.length} rows with unknown merchants: ${[...unknownMerchants].join(', ')}`)
  }

  const result = await batchUpsert('billing_receiving', records, 'client_id,reference_id,fee_type', dryRun)
  result.skipped = data.length - records.length
  return result
}

// ============================================
// MAIN
// ============================================

async function main() {
  const config = parseArgs()

  console.log('='.repeat(60))
  console.log('BILLING DATA IMPORT (Multi-Merchant)')
  console.log('='.repeat(60))
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Dry run: ${config.dryRun}`)
  console.log(`File filter: ${config.file || 'all'}`)
  console.log(`Data directory: ${DATA_DIR}`)
  console.log(`Known merchants: ${Object.entries(MERCHANTS).map(([id, m]) => `${id} (${m.name})`).join(', ')}`)

  const results = {}
  const startTime = Date.now()

  // Import each file type
  const importers = {
    'shipments': importShipments,
    'fees': importShipmentFees,
    'storage': importStorage,
    'credits': importCredits,
    'returns': importReturns,
    'receiving': importReceiving
  }

  for (const [name, importFn] of Object.entries(importers)) {
    if (config.file && config.file !== name) continue
    results[name] = await importFn(config.dryRun)
  }

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  const totalSuccess = Object.values(results).reduce((sum, r) => sum + r.success, 0)
  const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0)
  const totalSkipped = Object.values(results).reduce((sum, r) => sum + (r.skipped || 0), 0)

  console.log('\n' + '='.repeat(60))
  console.log('IMPORT COMPLETE')
  console.log('='.repeat(60))
  console.log(`Total time: ${totalTime}s`)
  console.log(`Total records: ${totalSuccess} success, ${totalFailed} failed, ${totalSkipped} skipped (unknown merchant)`)
  console.log('\nPer table:')
  for (const [name, result] of Object.entries(results)) {
    console.log(`  ${name}: ${result.success} success, ${result.failed} failed, ${result.skipped || 0} skipped`)
  }

  if (config.dryRun) {
    console.log('\n[DRY RUN] No data was actually inserted.')
  }
}

main().catch(console.error)
