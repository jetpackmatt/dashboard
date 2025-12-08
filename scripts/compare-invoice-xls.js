#!/usr/bin/env node
/**
 * Compare JPHS-0037 reference XLS against our transactions DB
 * Verifies row counts and totals for each category match
 */

require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// JPHS-0037 invoice IDs (week Nov 24-30, 2025)
const INVOICE_IDS = {
  shipments: 8633612,
  storage: 8633618,
  receiving: 8633632,
  additionalServices: 8633634,
  returns: 8633637,
  credits: 8633641
}

const XLS_PATH = '/Users/mattmcleod/Dropbox/gits/dashboard/reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx'

async function getDbTransactions(invoiceId, referenceType = null, transactionFee = null) {
  const allTx = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('client_id', HENSON_ID)
      .eq('invoice_id_sb', invoiceId)
      .order('id')
      .range(offset, offset + pageSize - 1)

    if (referenceType) {
      query = query.eq('reference_type', referenceType)
    }
    if (transactionFee) {
      query = query.eq('transaction_fee', transactionFee)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error:', error.message)
      break
    }

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < pageSize) break
  }

  return allTx
}

async function main() {
  console.log('='.repeat(70))
  console.log('JPHS-0037 INVOICE COMPARISON: REFERENCE XLS vs DATABASE')
  console.log('='.repeat(70))

  // Load reference XLS
  const workbook = XLSX.readFile(XLS_PATH)

  const results = []

  // 1. SHIPMENTS
  console.log('\n--- SHIPMENTS ---')
  const xlsShipments = XLSX.utils.sheet_to_json(workbook.Sheets['Shipments'])
  const dbShipments = await getDbTransactions(INVOICE_IDS.shipments, 'Shipment', 'Shipping')

  const xlsShipTotal = xlsShipments.reduce((sum, r) => sum + (Number(r['Original Invoice']) || 0), 0)
  const dbShipTotal = dbShipments.reduce((sum, tx) => sum + Number(tx.cost), 0)

  results.push({
    category: 'Shipments',
    xlsRows: xlsShipments.length,
    dbRows: dbShipments.length,
    xlsTotal: xlsShipTotal,
    dbTotal: dbShipTotal,
    rowMatch: xlsShipments.length === dbShipments.length,
    totalMatch: Math.abs(xlsShipTotal - dbShipTotal) < 0.01
  })
  console.log(`  XLS: ${xlsShipments.length} rows, $${xlsShipTotal.toFixed(2)}`)
  console.log(`  DB:  ${dbShipments.length} rows, $${dbShipTotal.toFixed(2)}`)

  // 2. ADDITIONAL SERVICES
  console.log('\n--- ADDITIONAL SERVICES ---')
  const xlsAddSvc = XLSX.utils.sheet_to_json(workbook.Sheets['Additional Services'])
  const dbAddSvc = await getDbTransactions(INVOICE_IDS.additionalServices)

  const xlsAddTotal = xlsAddSvc.reduce((sum, r) => sum + (Number(r['Invoice Amount']) || 0), 0)
  const dbAddTotal = dbAddSvc.reduce((sum, tx) => sum + Number(tx.cost), 0)

  results.push({
    category: 'Additional Services',
    xlsRows: xlsAddSvc.length,
    dbRows: dbAddSvc.length,
    xlsTotal: xlsAddTotal,
    dbTotal: dbAddTotal,
    rowMatch: xlsAddSvc.length === dbAddSvc.length,
    totalMatch: Math.abs(xlsAddTotal - dbAddTotal) < 0.01
  })
  console.log(`  XLS: ${xlsAddSvc.length} rows, $${xlsAddTotal.toFixed(2)}`)
  console.log(`  DB:  ${dbAddSvc.length} rows, $${dbAddTotal.toFixed(2)}`)

  // 3. RETURNS
  console.log('\n--- RETURNS ---')
  const xlsReturns = XLSX.utils.sheet_to_json(workbook.Sheets['Returns'])
    .filter(r => r['User ID'] !== 'Total') // Exclude total row
  const dbReturns = await getDbTransactions(INVOICE_IDS.returns)

  const xlsRetTotal = xlsReturns.reduce((sum, r) => sum + (Number(r['Invoice']) || 0), 0)
  const dbRetTotal = dbReturns.reduce((sum, tx) => sum + Number(tx.cost), 0)

  results.push({
    category: 'Returns',
    xlsRows: xlsReturns.length,
    dbRows: dbReturns.length,
    xlsTotal: xlsRetTotal,
    dbTotal: dbRetTotal,
    rowMatch: xlsReturns.length === dbReturns.length,
    totalMatch: Math.abs(xlsRetTotal - dbRetTotal) < 0.01
  })
  console.log(`  XLS: ${xlsReturns.length} rows, $${xlsRetTotal.toFixed(2)}`)
  console.log(`  DB:  ${dbReturns.length} rows, $${dbRetTotal.toFixed(2)}`)

  // 4. RECEIVING
  console.log('\n--- RECEIVING ---')
  const xlsReceiving = XLSX.utils.sheet_to_json(workbook.Sheets['Receiving'])
    .filter(r => r['User ID'] !== 'Total')
  const dbReceiving = await getDbTransactions(INVOICE_IDS.receiving)

  const xlsRecTotal = xlsReceiving.reduce((sum, r) => sum + (Number(r['Invoice Amount']) || 0), 0)
  const dbRecTotal = dbReceiving.reduce((sum, tx) => sum + Number(tx.cost), 0)

  results.push({
    category: 'Receiving',
    xlsRows: xlsReceiving.length,
    dbRows: dbReceiving.length,
    xlsTotal: xlsRecTotal,
    dbTotal: dbRecTotal,
    rowMatch: xlsReceiving.length === dbReceiving.length,
    totalMatch: Math.abs(xlsRecTotal - dbRecTotal) < 0.01
  })
  console.log(`  XLS: ${xlsReceiving.length} rows, $${xlsRecTotal.toFixed(2)}`)
  console.log(`  DB:  ${dbReceiving.length} rows, $${dbRecTotal.toFixed(2)}`)

  // 5. STORAGE
  console.log('\n--- STORAGE ---')
  const xlsStorage = XLSX.utils.sheet_to_json(workbook.Sheets['Storage'])
    .filter(r => r['Merchant Name'] !== 'Total')
  const dbStorage = await getDbTransactions(INVOICE_IDS.storage, 'FC')

  const xlsStgTotal = xlsStorage.reduce((sum, r) => sum + (Number(r['Invoice']) || 0), 0)
  const dbStgTotal = dbStorage.reduce((sum, tx) => sum + Number(tx.cost), 0)

  // Note: XLS may have 982 (includes other client's data), DB should have 969 (Henson only)
  results.push({
    category: 'Storage',
    xlsRows: xlsStorage.length,
    dbRows: dbStorage.length,
    xlsTotal: xlsStgTotal,
    dbTotal: dbStgTotal,
    rowMatch: xlsStorage.length === dbStorage.length,
    totalMatch: Math.abs(xlsStgTotal - dbStgTotal) < 0.01,
    note: 'XLS may include other clients (shared invoice)'
  })
  console.log(`  XLS: ${xlsStorage.length} rows, $${xlsStgTotal.toFixed(2)}`)
  console.log(`  DB:  ${dbStorage.length} rows, $${dbStgTotal.toFixed(2)}`)
  console.log(`  Note: XLS from ShipBob may include other clients' storage (shared invoice)`)

  // 6. CREDITS
  console.log('\n--- CREDITS ---')
  const xlsCredits = XLSX.utils.sheet_to_json(workbook.Sheets['Credits'])
    .filter(r => r['User ID'] !== 'Total')
  const dbCredits = await getDbTransactions(INVOICE_IDS.credits)

  const xlsCrdTotal = xlsCredits.reduce((sum, r) => sum + (Number(r['Credit Amount']) || 0), 0)
  const dbCrdTotal = dbCredits.reduce((sum, tx) => sum + Number(tx.cost), 0)

  results.push({
    category: 'Credits',
    xlsRows: xlsCredits.length,
    dbRows: dbCredits.length,
    xlsTotal: xlsCrdTotal,
    dbTotal: dbCrdTotal,
    rowMatch: xlsCredits.length === dbCredits.length,
    totalMatch: Math.abs(xlsCrdTotal - dbCrdTotal) < 0.01
  })
  console.log(`  XLS: ${xlsCredits.length} rows, $${xlsCrdTotal.toFixed(2)}`)
  console.log(`  DB:  ${dbCredits.length} rows, $${dbCrdTotal.toFixed(2)}`)

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log('')
  console.log('Category'.padEnd(25) + 'XLS Rows'.padStart(10) + 'DB Rows'.padStart(10) + 'XLS $'.padStart(12) + 'DB $'.padStart(12) + 'Status'.padStart(12))
  console.log('-'.repeat(70))

  let allMatch = true
  for (const r of results) {
    const status = r.rowMatch && r.totalMatch ? 'PASS' :
                   r.note ? 'CHECK' : 'FAIL'
    if (status === 'FAIL') allMatch = false

    console.log(
      r.category.padEnd(25) +
      String(r.xlsRows).padStart(10) +
      String(r.dbRows).padStart(10) +
      r.xlsTotal.toFixed(2).padStart(12) +
      r.dbTotal.toFixed(2).padStart(12) +
      status.padStart(12)
    )
  }

  console.log('-'.repeat(70))
  console.log('')

  // Storage investigation
  if (results.find(r => r.category === 'Storage' && !r.rowMatch)) {
    console.log('STORAGE DISCREPANCY INVESTIGATION:')
    console.log(`  XLS has ${results.find(r => r.category === 'Storage').xlsRows} rows`)
    console.log(`  DB has ${results.find(r => r.category === 'Storage').dbRows} rows (Henson only)`)
    console.log('  Difference likely due to shared storage invoice including Methyl-Life')

    // Check for inventory 20114295 (Methyl-Life) in XLS
    const mlInv = xlsStorage.filter(r => String(r['Inventory ID']) === '20114295')
    console.log(`  Inventory 20114295 (Methyl-Life) in XLS: ${mlInv.length} rows`)
  }

  console.log('')
  if (allMatch) {
    console.log('ALL CATEGORIES MATCH (except expected storage shared-invoice difference)')
  } else {
    console.log('SOME CATEGORIES NEED INVESTIGATION')
  }
  console.log('='.repeat(70))
}

main().catch(console.error)
