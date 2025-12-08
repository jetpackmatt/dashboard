/**
 * Import ALL tabs from historical invoice XLS files
 *
 * Tabs and their key columns:
 * - Shipping: OrderID → reference_id (shipment_id)
 * - Additional Fees: Reference ID → reference_id
 * - Returns: Return ID → reference_id
 * - Credits: Reference ID → reference_id
 * - Receiving: WRO Number → reference_id
 * - Storage: Inventory ID → reference_id
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

const DRY_RUN = process.argv.includes('--dry-run')
const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')
const BATCH_SIZE = 500

// Map XLS fee types to DB transaction_fee values
const FEE_TYPE_MAP = {
  'Per Order Fee': 'Per Order Fee',
  'Per Pick Fee': 'Per Pick Fee',
  'Kitting Fee': 'Kitting Fee',
  'Box Fee': 'Box Fee',
  'Material Handling Fee': 'Material Handling Fee',
  'Custom Packaging Fee': 'Custom Packaging Fee',
  // Add more as needed
}

async function getInvoiceMap() {
  // Get all Jetpack invoices with their IDs
  const { data: invoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number')
    .like('invoice_number', 'JPHS%')

  const map = new Map()
  invoices?.forEach(inv => {
    // Extract JPHS-XXXX from invoice_number like "JPHS-0001-032425"
    const match = inv.invoice_number.match(/JPHS-(\d+)/)
    if (match) {
      map.set(`JPHS-${match[1]}`, inv.id)
    }
  })
  return map
}

async function getClientId() {
  const { data } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'Henson Shaving')
    .single()
  return data?.id
}

async function processAdditionalFees(workbook, invoiceId, clientId, stats) {
  const sheetName = workbook.SheetNames.find(n =>
    n.toLowerCase().includes('additional') || n.toLowerCase().includes('fees')
  )
  if (!sheetName) return

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`  Additional Fees: ${rows.length} rows`)

  // Extract Reference IDs and their fee types
  const refIdToFeeType = new Map()
  rows.forEach(row => {
    const refId = String(row['Reference ID'] || '').trim()
    const feeType = row['Fee Type']
    if (refId && refId !== 'undefined') {
      if (!refIdToFeeType.has(refId)) {
        refIdToFeeType.set(refId, [])
      }
      refIdToFeeType.get(refId).push(feeType)
    }
  })

  const refIds = [...refIdToFeeType.keys()]
  stats.additionalFeesXls += rows.length

  // Batch query transactions
  let matched = 0
  let notFound = 0

  for (let i = 0; i < refIds.length; i += BATCH_SIZE) {
    const batch = refIds.slice(i, i + BATCH_SIZE)

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, invoice_id_jp')
      .eq('client_id', clientId)
      .not('transaction_fee', 'in', '("Shipping","Shipping Zone","Dimensional Shipping Upgrade")')
      .in('reference_id', batch)

    if (error) {
      console.log('    Error:', error.message)
      continue
    }

    const updates = []
    txs?.forEach(tx => {
      if (!tx.invoice_id_jp) {
        matched++
        updates.push({ id: tx.id, invoiceId })
      }
    })

    // Count not found
    const foundRefIds = new Set(txs?.map(t => t.reference_id) || [])
    batch.forEach(refId => {
      if (!foundRefIds.has(refId)) notFound++
    })

    // Execute updates
    if (!DRY_RUN && updates.length > 0) {
      for (const { id, invoiceId } of updates) {
        await supabase
          .from('transactions')
          .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
          .eq('id', id)
      }
    }
  }

  stats.additionalFeesMatched += matched
  stats.additionalFeesNotFound += notFound
  console.log(`    Matched: ${matched}, Not found: ${notFound}`)
}

async function processCredits(workbook, invoiceId, clientId, stats) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('credit'))
  if (!sheetName) return

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`  Credits: ${rows.length} rows`)

  const refIds = rows
    .map(row => String(row['Reference ID'] || '').trim())
    .filter(id => id && id !== 'undefined')

  stats.creditsXls += rows.length

  if (refIds.length === 0) return

  // Query credit transactions
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, reference_id, invoice_id_jp')
    .eq('client_id', clientId)
    .eq('transaction_fee', 'Credit')
    .in('reference_id', refIds)

  let matched = 0
  const updates = []
  txs?.forEach(tx => {
    if (!tx.invoice_id_jp) {
      matched++
      updates.push({ id: tx.id })
    }
  })

  if (!DRY_RUN && updates.length > 0) {
    for (const { id } of updates) {
      await supabase
        .from('transactions')
        .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
        .eq('id', id)
    }
  }

  stats.creditsMatched += matched
  console.log(`    Matched: ${matched}`)
}

async function processReturns(workbook, invoiceId, clientId, stats) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('return'))
  if (!sheetName) return

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`  Returns: ${rows.length} rows`)

  // Returns use "Return ID" as the unique identifier
  const returnIds = rows
    .map(row => String(row['Return ID'] || '').trim())
    .filter(id => id && id !== 'undefined')

  stats.returnsXls += rows.length

  if (returnIds.length === 0) return

  // Query return transactions (they should have Return ID as reference_id)
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, reference_id, invoice_id_jp')
    .eq('client_id', clientId)
    .eq('transaction_fee', 'Return Processing')
    .in('reference_id', returnIds)

  let matched = 0
  const updates = []
  txs?.forEach(tx => {
    if (!tx.invoice_id_jp) {
      matched++
      updates.push({ id: tx.id })
    }
  })

  if (!DRY_RUN && updates.length > 0) {
    for (const { id } of updates) {
      await supabase
        .from('transactions')
        .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
        .eq('id', id)
    }
  }

  stats.returnsMatched += matched
  console.log(`    Matched: ${matched}`)
}

async function processStorage(workbook, invoiceId, clientId, stats) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('storage'))
  if (!sheetName) return

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`  Storage: ${rows.length} rows`)

  // Storage uses "Inventory ID" as the unique identifier
  const inventoryIds = rows
    .map(row => String(row['Inventory ID'] || '').trim())
    .filter(id => id && id !== 'undefined')

  stats.storageXls += rows.length

  if (inventoryIds.length === 0) return

  // Query storage transactions (Warehousing Fee uses inventory_id as reference_id)
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, reference_id, invoice_id_jp')
    .eq('client_id', clientId)
    .eq('transaction_fee', 'Warehousing Fee')
    .in('reference_id', inventoryIds)

  let matched = 0
  const updates = []
  txs?.forEach(tx => {
    if (!tx.invoice_id_jp) {
      matched++
      updates.push({ id: tx.id })
    }
  })

  if (!DRY_RUN && updates.length > 0) {
    for (const { id } of updates) {
      await supabase
        .from('transactions')
        .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
        .eq('id', id)
    }
  }

  stats.storageMatched += matched
  console.log(`    Matched: ${matched}`)
}

async function processReceiving(workbook, invoiceId, clientId, stats) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('receiv'))
  if (!sheetName) return

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`  Receiving: ${rows.length} rows`)

  // Receiving uses "WRO Number" as the unique identifier
  const wroNumbers = rows
    .map(row => String(row['WRO Number'] || '').trim())
    .filter(id => id && id !== 'undefined')

  stats.receivingXls += rows.length

  if (wroNumbers.length === 0) return

  // Query receiving transactions
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, reference_id, invoice_id_jp')
    .eq('client_id', clientId)
    .eq('transaction_fee', 'Receiving')
    .in('reference_id', wroNumbers)

  let matched = 0
  const updates = []
  txs?.forEach(tx => {
    if (!tx.invoice_id_jp) {
      matched++
      updates.push({ id: tx.id })
    }
  })

  if (!DRY_RUN && updates.length > 0) {
    for (const { id } of updates) {
      await supabase
        .from('transactions')
        .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
        .eq('id', id)
    }
  }

  stats.receivingMatched += matched
  console.log(`    Matched: ${matched}`)
}

async function main() {
  console.log('=== IMPORT ALL TABS FROM HISTORICAL INVOICES ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  const invoiceMap = await getInvoiceMap()
  const clientId = await getClientId()

  console.log(`Found ${invoiceMap.size} invoices in DB`)
  console.log(`Client ID: ${clientId}\n`)

  const files = fs.readdirSync(HISTORICAL_DIR)
    .filter(f => f.endsWith('.xlsx') && f.includes('INVOICE-DETAILS'))
    .sort()

  console.log(`Processing ${files.length} XLS files...\n`)

  const stats = {
    additionalFeesXls: 0,
    additionalFeesMatched: 0,
    additionalFeesNotFound: 0,
    creditsXls: 0,
    creditsMatched: 0,
    returnsXls: 0,
    returnsMatched: 0,
    storageXls: 0,
    storageMatched: 0,
    receivingXls: 0,
    receivingMatched: 0
  }

  for (const file of files) {
    // Extract invoice number from filename (e.g., JPHS-0001)
    const match = file.match(/JPHS-(\d+)/)
    if (!match) {
      console.log(`Skipping ${file} - no invoice number found`)
      continue
    }

    const invoiceKey = `JPHS-${match[1]}`
    const invoiceId = invoiceMap.get(invoiceKey)

    if (!invoiceId) {
      console.log(`Skipping ${file} - invoice ${invoiceKey} not found in DB`)
      continue
    }

    console.log(`\n${file} → ${invoiceKey}`)

    const xlsPath = path.join(HISTORICAL_DIR, file)
    const workbook = XLSX.readFile(xlsPath)

    console.log(`  Sheets: ${workbook.SheetNames.join(', ')}`)

    // Process all tabs
    await processAdditionalFees(workbook, invoiceId, clientId, stats)
    await processCredits(workbook, invoiceId, clientId, stats)
    await processReturns(workbook, invoiceId, clientId, stats)
    await processStorage(workbook, invoiceId, clientId, stats)
    await processReceiving(workbook, invoiceId, clientId, stats)
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Additional Fees: ${stats.additionalFeesMatched} matched of ${stats.additionalFeesXls} XLS rows`)
  console.log(`Credits: ${stats.creditsMatched} matched of ${stats.creditsXls} XLS rows`)
  console.log(`Returns: ${stats.returnsMatched} matched of ${stats.returnsXls} XLS rows`)
  console.log(`Storage: ${stats.storageMatched} matched of ${stats.storageXls} XLS rows`)
  console.log(`Receiving: ${stats.receivingMatched} matched of ${stats.receivingXls} XLS rows`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made')
  }
}

main().catch(console.error)
