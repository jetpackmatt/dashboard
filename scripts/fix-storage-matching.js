/**
 * Fix Storage/Warehousing Fee matching
 *
 * Problem: DB reference_id is "88-20101221-Shelf" but XLS has just "20101221"
 * Solution: Extract inventory_id from reference_id and match
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

async function getInvoiceMap() {
  const { data: invoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, period_start, period_end')
    .like('invoice_number', 'JPHS%')

  const map = new Map()
  invoices?.forEach(inv => {
    const match = inv.invoice_number.match(/JPHS-(\d+)/)
    if (match) {
      map.set(`JPHS-${match[1]}`, {
        id: inv.id,
        periodStart: inv.period_start,
        periodEnd: inv.period_end
      })
    }
  })
  return map
}

async function getAllClients() {
  const { data } = await supabase
    .from('clients')
    .select('id, company_name')
  return data || []
}

function extractInventoryId(referenceId) {
  // Format: "88-20101221-Shelf" or "19-20114281-Pallet"
  // Extract the middle number (inventory ID)
  const parts = referenceId.split('-')
  if (parts.length >= 2) {
    return parts[1]
  }
  return null
}

async function main() {
  console.log('=== FIX STORAGE/WAREHOUSING FEE MATCHING (ALL CLIENTS) ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  const invoiceMap = await getInvoiceMap()
  const clients = await getAllClients()

  console.log(`Found ${invoiceMap.size} invoices in DB`)
  console.log(`Clients: ${clients.map(c => c.company_name).join(', ')}\n`)

  // Build map of inventory_id -> invoice_number from XLS files (ALL invoices - JPHS and JPML)
  const inventoryToInvoice = new Map()

  const files = fs.readdirSync(HISTORICAL_DIR)
    .filter(f => f.endsWith('.xlsx') && f.includes('INVOICE-DETAILS'))
    .sort()

  console.log(`Processing ${files.length} XLS files for Storage tabs...\n`)

  for (const file of files) {
    // Match both JPHS and JPML invoice patterns
    const match = file.match(/(JP[HM][SL])-(\d+)/)
    if (!match) continue

    const invoiceKey = `${match[1]}-${match[2]}`
    const invoiceInfo = invoiceMap.get(invoiceKey)
    if (!invoiceInfo) continue

    const xlsPath = path.join(HISTORICAL_DIR, file)
    const workbook = XLSX.readFile(xlsPath)

    // Find storage sheet
    const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('storage'))
    if (!sheetName) continue

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    for (const row of rows) {
      const inventoryId = String(row['Inventory ID'] || '').trim()
      if (inventoryId && inventoryId !== 'undefined') {
        // Store invoice_number (not UUID) for human-readable format
        inventoryToInvoice.set(inventoryId, invoiceInfo.id)
      }
    }
  }

  console.log(`Built map of ${inventoryToInvoice.size} inventory IDs to invoices`)

  // Get ALL unmatched Warehousing Fee transactions (no client filter)
  console.log('\nFetching unmatched Warehousing Fee transactions (ALL clients)...')
  let unmatchedTxs = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, reference_id')
      .eq('transaction_fee', 'Warehousing Fee')
      .is('invoice_id_jp', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error || !data || data.length === 0) break
    unmatchedTxs = unmatchedTxs.concat(data)
    offset += BATCH_SIZE
  }

  console.log(`Found ${unmatchedTxs.length} unmatched Warehousing Fee transactions`)

  // Match transactions by extracting inventory ID
  const updates = []
  let notFound = 0

  for (const tx of unmatchedTxs) {
    const inventoryId = extractInventoryId(tx.reference_id)
    if (!inventoryId) {
      notFound++
      continue
    }

    const invoiceId = inventoryToInvoice.get(inventoryId)
    if (invoiceId) {
      updates.push({ id: tx.id, invoiceId })
    } else {
      notFound++
    }
  }

  console.log(`Matched: ${updates.length}`)
  console.log(`Not found in XLS: ${notFound}`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update', updates.length, 'transactions')
    if (updates.length > 0) {
      console.log('Sample:', updates.slice(0, 3))
    }
    return
  }

  // Execute updates
  if (updates.length > 0) {
    console.log(`\nUpdating ${updates.length} transactions...`)

    let successCount = 0
    const PARALLEL_SIZE = 50

    for (let i = 0; i < updates.length; i += PARALLEL_SIZE) {
      const batch = updates.slice(i, i + PARALLEL_SIZE)

      const results = await Promise.all(batch.map(async ({ id, invoiceId }) => {
        const { error } = await supabase
          .from('transactions')
          .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
          .eq('id', id)

        return !error
      }))

      successCount += results.filter(Boolean).length

      if ((i + PARALLEL_SIZE) % 500 === 0) {
        console.log(`  Updated ${i + PARALLEL_SIZE}...`)
      }
    }

    console.log(`Successfully updated: ${successCount} transactions`)
  }

  console.log('\n=== COMPLETE ===')
}

main().catch(console.error)
