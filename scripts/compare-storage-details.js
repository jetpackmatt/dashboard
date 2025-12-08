#!/usr/bin/env node
/**
 * Compare storage details between reference file and our DB
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Convert Excel serial to date string
function excelDateToString(serial) {
  if (typeof serial !== 'number') return String(serial)
  try {
    const date = new Date((serial - 25569) * 86400 * 1000)
    if (isNaN(date.getTime())) return String(serial)
    return date.toISOString().split('T')[0]
  } catch {
    return String(serial)
  }
}

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const storageInvoiceId = 8633618

  console.log('='.repeat(70))
  console.log('STORAGE COMPARISON: REFERENCE vs DATABASE')
  console.log('='.repeat(70))

  // Load reference file
  const refPath = path.join(__dirname, '../reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const workbook = XLSX.readFile(refPath)
  const storageSheet = workbook.Sheets['Storage']
  const refData = XLSX.utils.sheet_to_json(storageSheet)

  // Load DB data
  const { data: dbData, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', hensonId)
    .eq('invoice_id_sb', storageInvoiceId)

  if (error) {
    console.log('Error loading DB data:', error.message)
    return
  }

  console.log('\n--- ROW COUNTS ---')
  console.log('Reference rows:', refData.length)
  console.log('Database rows:', dbData.length)
  console.log('Discrepancy:', refData.length - dbData.length)

  // Analyze reference dates
  console.log('\n--- REFERENCE DATE DISTRIBUTION ---')
  const refByDate = {}
  const refByItem = {}
  for (const row of refData) {
    const dateStr = excelDateToString(row['ChargeStartdate'])
    const invId = String(row['Inventory ID'])

    refByDate[dateStr] = (refByDate[dateStr] || 0) + 1
    refByItem[invId] = (refByItem[invId] || 0) + 1
  }

  for (const [date, count] of Object.entries(refByDate).sort()) {
    console.log(`  ${date}: ${count}`)
  }
  console.log('Total dates:', Object.keys(refByDate).length)
  console.log('Date range:', Object.keys(refByDate).sort()[0], 'to', Object.keys(refByDate).sort().pop())

  // Analyze DB inventory IDs
  console.log('\n--- DATABASE INVENTORY IDs ---')
  const dbByItem = {}
  for (const tx of dbData) {
    const invId = tx.additional_details?.InventoryId || tx.reference_id.split('-')[1]
    dbByItem[invId] = (dbByItem[invId] || 0) + 1
  }

  console.log('Unique inventory IDs in DB:', Object.keys(dbByItem).length)
  console.log('Unique inventory IDs in ref:', Object.keys(refByItem).length)

  // Compare inventory IDs
  const refItems = new Set(Object.keys(refByItem))
  const dbItems = new Set(Object.keys(dbByItem))

  const inRefNotDb = [...refItems].filter(id => !dbItems.has(id))
  const inDbNotRef = [...dbItems].filter(id => !refItems.has(id))

  console.log('\n--- INVENTORY ID COMPARISON ---')
  console.log('In reference but not DB:', inRefNotDb.length)
  if (inRefNotDb.length > 0 && inRefNotDb.length <= 20) {
    for (const id of inRefNotDb) {
      console.log(`  ${id}: ${refByItem[id]} days`)
    }
  }

  console.log('In DB but not reference:', inDbNotRef.length)
  if (inDbNotRef.length > 0 && inDbNotRef.length <= 20) {
    for (const id of inDbNotRef) {
      console.log(`  ${id}: ${dbByItem[id]} transactions`)
    }
  }

  // Compare common items
  console.log('\n--- COMMON ITEMS COMPARISON ---')
  const commonItems = [...refItems].filter(id => dbItems.has(id))
  console.log('Common inventory IDs:', commonItems.length)

  let totalRefDays = 0
  let totalDbTx = 0
  const mismatches = []

  for (const id of commonItems) {
    const refDays = refByItem[id]
    const dbTx = dbByItem[id]
    totalRefDays += refDays
    totalDbTx += dbTx

    if (refDays !== dbTx) {
      mismatches.push({ id, refDays, dbTx, diff: dbTx - refDays })
    }
  }

  console.log('Total ref row-days for common items:', totalRefDays)
  console.log('Total DB transactions for common items:', totalDbTx)

  if (mismatches.length > 0) {
    console.log('\n--- MISMATCHED COUNTS FOR COMMON ITEMS ---')
    mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    for (const m of mismatches.slice(0, 20)) {
      console.log(`  Inventory ${m.id}: ref=${m.refDays}, db=${m.dbTx}, diff=${m.diff > 0 ? '+' : ''}${m.diff}`)
    }
  }

  // Check if reference includes items from other clients
  console.log('\n--- CHECKING FOR FC ID PATTERN ---')
  const fcIds = new Set()
  for (const tx of dbData) {
    const parts = tx.reference_id.split('-')
    if (parts.length >= 1) {
      fcIds.add(parts[0])
    }
  }
  console.log('FC IDs in DB storage:', [...fcIds])

  // Check reference FC Names
  const refFCs = new Set()
  for (const row of refData) {
    refFCs.add(row['FC Name'])
  }
  console.log('FC Names in reference:', [...refFCs])

  // Summary
  console.log('\n--- SUMMARY ---')
  console.log('Reference: 48 unique items × varying days = 981 rows')
  console.log('Database: 67 unique items × varying days = 969 rows')
  console.log('')
  console.log('The discrepancy appears to be:')
  console.log('  - Items in ref but not DB:', inRefNotDb.length, 'items')
  console.log('  - Items in DB but not ref:', inDbNotRef.length, 'items')
  console.log('  - Row count diff from common items:', totalRefDays - totalDbTx)
}

main().catch(console.error)
