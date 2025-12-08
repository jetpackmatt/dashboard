/**
 * Fix remaining unmatched Shipping/Per Pick Fee transactions
 * Strategy: Look up each unmatched reference_id in XLS files to find the invoice
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
const BATCH_SIZE = 1000

async function getInvoiceMap() {
  // Get all Jetpack invoices
  const { data: invoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number')

  const map = new Map()
  invoices?.forEach(inv => {
    // Extract JPHS-XXXX or JPML-XXXX from invoice_number
    const match = inv.invoice_number.match(/(JP[HM][SL])-(\d+)/)
    if (match) {
      map.set(`${match[1]}-${match[2]}`, inv.invoice_number)
    }
  })
  return map
}

async function buildOrderIdToInvoiceMap() {
  // Build map: OrderID -> invoice_number
  const orderIdToInvoice = new Map()
  const invoiceMap = await getInvoiceMap()

  const files = fs.readdirSync(HISTORICAL_DIR).filter(f => f.endsWith('.xlsx'))

  console.log(`Processing ${files.length} XLS files...`)

  for (const file of files) {
    // Extract invoice key from filename (handle typos like JPHS-0001-0302425)
    const match = file.match(/(JP[HM][SL])-(\d+)/)
    if (!match) continue

    const invoiceKey = `${match[1]}-${match[2]}`
    const invoiceNumber = invoiceMap.get(invoiceKey)

    if (!invoiceNumber) {
      console.log(`  No DB invoice found for ${invoiceKey} (file: ${file})`)
      continue
    }

    const xlsPath = path.join(HISTORICAL_DIR, file)
    const workbook = XLSX.readFile(xlsPath)

    // Find shipping sheet
    const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))
    if (!sheetName) continue

    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet)

    rows.forEach(row => {
      const orderId = String(row['OrderID'] || '').trim()
      if (orderId && orderId !== 'undefined') {
        orderIdToInvoice.set(orderId, invoiceNumber)
      }
    })
  }

  console.log(`Built map of ${orderIdToInvoice.size} OrderIDs to invoices`)
  return orderIdToInvoice
}

async function fix() {
  console.log('=== FIX REMAINING SHIPPING/PER PICK FEE ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  const orderIdToInvoice = await buildOrderIdToInvoiceMap()

  // Get unmatched Shipping and Per Pick Fee transactions
  console.log('\nFetching unmatched Shipping/Per Pick Fee transactions...')
  let unmatchedTxs = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, reference_id, transaction_fee')
      .is('invoice_id_jp', null)
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade', 'Per Pick Fee', 'Per Order Fee', 'Box Fee'])
      .lte('charge_date', '2025-12-01')
      .range(offset, offset + BATCH_SIZE - 1)

    if (error || !data || data.length === 0) break
    unmatchedTxs = unmatchedTxs.concat(data)
    offset += BATCH_SIZE
  }

  console.log(`Found ${unmatchedTxs.length} unmatched transactions`)

  // Match transactions
  const updates = []
  let notFound = 0

  for (const tx of unmatchedTxs) {
    const invoiceNumber = orderIdToInvoice.get(tx.reference_id)
    if (invoiceNumber) {
      updates.push({ id: tx.id, invoiceNumber })
    } else {
      notFound++
    }
  }

  console.log(`Matched: ${updates.length}`)
  console.log(`Not found in XLS: ${notFound}`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update', updates.length, 'transactions')
    if (updates.length > 0) {
      console.log('Sample:', updates.slice(0, 5))
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

      const results = await Promise.all(batch.map(async ({ id, invoiceNumber }) => {
        const { error } = await supabase
          .from('transactions')
          .update({ invoice_id_jp: invoiceNumber, invoiced_status_jp: true })
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

fix().catch(console.error)
