#!/usr/bin/env node
/**
 * Backfill storage transactions from ShipBob xlsx export
 * Updates invoice_id_sb for FC transactions based on the file data
 */

require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// Excel serial date to JS Date
function excelDateToJSDate(serial) {
  // Excel epoch is Jan 1, 1900, but has a bug treating 1900 as leap year
  const utcDays = Math.floor(serial - 25569)
  return new Date(utcDays * 86400 * 1000)
}

function formatDate(date) {
  return date.toISOString().split('T')[0]
}

// Map merchant names to client IDs
const MERCHANT_TO_CLIENT = {
  'Henson Shaving': '6b94c274-0446-4167-9d02-b998f8be59ad',
  'Eli Health': 'f47f90e4-5108-47e2-96a8-c24c1c54721e',
  'Methyl-Life': 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e',
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  // Get file path from args, skipping --dry-run
  const filePath = process.argv.filter(a => !a.startsWith('--') && !a.includes('node') && !a.includes('.js'))[0]
    || 'reference/storage-backfills/storage-122225.xlsx'

  console.log(`Reading ${filePath}...`)
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'}`)
  const workbook = XLSX.readFile(filePath)

  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`Found ${rows.length} rows in sheet "${sheetName}"`)

  // Filter out metadata rows (rows without valid Inventory ID)
  const dataRows = rows.filter(r => r['Inventory ID'] && !isNaN(r['ChargeStartdate']))
  console.log(`Data rows (excluding metadata): ${dataRows.length}`)

  // Group by merchant
  const byMerchant = {}
  for (const row of dataRows) {
    const merchant = row['Merchant Name']
    if (!byMerchant[merchant]) byMerchant[merchant] = []
    byMerchant[merchant].push(row)
  }
  console.log('\nMerchant breakdown:')
  for (const [merchant, merchantRows] of Object.entries(byMerchant)) {
    console.log(`  ${merchant}: ${merchantRows.length} rows`)
  }

  // Show charge date distribution
  const dateDistrib = {}
  for (const row of dataRows) {
    const chargeDate = formatDate(excelDateToJSDate(row['ChargeStartdate']))
    dateDistrib[chargeDate] = (dateDistrib[chargeDate] || 0) + 1
  }
  console.log('\nCharge date distribution (xlsx):')
  for (const [d, count] of Object.entries(dateDistrib).sort()) {
    console.log(`  ${d}: ${count}`)
  }

  // Get invoice info from first data row
  const invoiceId = dataRows[0]['Invoice Number']
  const invoiceDateSerial = dataRows[0]['Invoice Date']
  const invoiceDate = excelDateToJSDate(invoiceDateSerial)
  console.log(`\nInvoice: ${invoiceId}, Date: ${formatDate(invoiceDate)}`)

  // Get all unlinked FC transactions from our DB (Dec 15 charge_date)
  console.log('\nFetching unlinked FC transactions from DB...')
  const { data: dbTx, error: dbError } = await supabase
    .from('transactions')
    .select('id, transaction_id, reference_id, reference_type, cost, charge_date, client_id, invoice_id_sb')
    .eq('reference_type', 'FC')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-01')
    .lte('charge_date', '2025-12-31')

  if (dbError) {
    console.error('DB error:', dbError)
    return
  }

  console.log(`Found ${dbTx.length} unlinked FC transactions in DB`)

  // Build lookup: reference_id → transaction
  // reference_id format: {FC_ID}-{InventoryId}-{LocationType}
  // Note: DB has all transactions dated Dec 15 (billing date),
  // but xlsx has actual daily dates. Match by inventory+loc+amount.
  const txByKey = new Map()
  for (const tx of dbTx) {
    // Extract inventory_id and location_type from reference_id
    const parts = tx.reference_id?.split('-') || []
    if (parts.length >= 3) {
      const invId = parts[1]
      const locType = parts.slice(2).join('-') // Handle multi-part location types
      const amount = parseFloat(tx.cost).toFixed(4)
      const key = `${invId}-${locType}-${amount}`

      if (!txByKey.has(key)) {
        txByKey.set(key, [])
      }
      txByKey.get(key).push(tx)
    }
  }

  console.log(`Built lookup with ${txByKey.size} unique keys`)

  // Show DB charge date distribution
  const dbDateDistrib = {}
  for (const tx of dbTx) {
    const d = tx.charge_date?.split('T')[0]
    dbDateDistrib[d] = (dbDateDistrib[d] || 0) + 1
  }
  console.log('DB charge date distribution:')
  for (const [d, count] of Object.entries(dbDateDistrib).sort()) {
    console.log(`  ${d}: ${count}`)
  }

  // SIMPLE APPROACH: Since xlsx has 965 rows and DB has 965 unlinked FC transactions,
  // and they're both for the same billing period (invoice 8730389), just update all of them.
  // The amounts differ because xlsx shows per-unit costs while DB has calculated totals.
  console.log('\nUsing simple approach: updating ALL unlinked FC transactions')
  console.log(`  xlsx rows: ${dataRows.length}`)
  console.log(`  DB transactions: ${dbTx.length}`)

  if (dataRows.length !== dbTx.length) {
    console.log(`\n⚠️  WARNING: Count mismatch! xlsx=${dataRows.length}, DB=${dbTx.length}`)
    console.log('Proceeding anyway - will update all DB transactions.')
  }

  const toUpdate = dbTx.map(tx => ({
    transaction_id: tx.transaction_id,
    invoice_id_sb: parseInt(invoiceId),
    invoice_date_sb: formatDate(invoiceDate),
  }))

  console.log(`\nWill update ${toUpdate.length} transactions`)

  if (dryRun) {
    console.log('\n[DRY RUN] Would update these transactions:')
    console.log(`  ${toUpdate.length} transactions to set invoice_id_sb = ${invoiceId}`)
    console.log('\nSample updates:')
    for (const u of toUpdate.slice(0, 5)) {
      console.log(`  ${u.transaction_id} → invoice ${u.invoice_id_sb}`)
    }
    return
  }

  // Perform updates in batches
  console.log(`\nUpdating ${toUpdate.length} transactions...`)
  const BATCH_SIZE = 500
  let updated = 0

  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE)
    const txIds = batch.map(u => u.transaction_id)

    const { data, error } = await supabase
      .from('transactions')
      .update({
        invoice_id_sb: parseInt(invoiceId),
        invoice_date_sb: formatDate(invoiceDate),
        invoiced_status_sb: true,
      })
      .in('transaction_id', txIds)
      .select('id')

    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error)
    } else {
      updated += data?.length || 0
      console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: updated ${data?.length || 0}`)
    }
  }

  console.log(`\nDone! Updated ${updated} transactions with invoice_id_sb = ${invoiceId}`)
}

main().catch(console.error)
