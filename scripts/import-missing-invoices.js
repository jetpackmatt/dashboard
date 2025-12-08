/**
 * Import Shipping tab transactions for JPHS-0016 and JPHS-0027
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')
const BATCH_SIZE = 500

async function importShipping(xlsFile, invoiceNumber) {
  console.log(`\n=== Importing ${invoiceNumber} ===`)

  // Get invoice ID from DB
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('id')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (!invoice) {
    console.log('Invoice not found in DB!')
    return
  }

  const invoiceId = invoice.id
  console.log('Invoice ID:', invoiceId)

  // Get client ID
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'Henson Shaving')
    .single()

  const clientId = client.id

  // Read XLS
  const xlsPath = path.join(HISTORICAL_DIR, xlsFile)
  const workbook = XLSX.readFile(xlsPath)

  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))
  if (!sheetName) {
    console.log('No shipping sheet found!')
    return
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`Shipping rows: ${rows.length}`)

  // Extract OrderIDs (shipment IDs)
  const orderIds = rows
    .map(row => String(row['OrderID'] || '').trim())
    .filter(id => id && id !== 'undefined')

  const uniqueOrderIds = [...new Set(orderIds)]
  console.log(`Unique OrderIDs: ${uniqueOrderIds.length}`)

  // Batch query transactions and update
  let matched = 0
  let alreadyMatched = 0
  let notFound = 0

  for (let i = 0; i < uniqueOrderIds.length; i += BATCH_SIZE) {
    const batch = uniqueOrderIds.slice(i, i + BATCH_SIZE)

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, invoice_id_jp')
      .eq('client_id', clientId)
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
      .in('reference_id', batch)

    if (error) {
      console.log('Error:', error.message)
      continue
    }

    // Update unmatched transactions
    for (const tx of txs || []) {
      if (tx.invoice_id_jp) {
        alreadyMatched++
      } else {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({ invoice_id_jp: invoiceId, invoiced_status_jp: true })
          .eq('id', tx.id)

        if (!updateError) matched++
      }
    }

    // Count not found
    const foundRefs = new Set(txs?.map(t => t.reference_id) || [])
    batch.forEach(refId => {
      if (!foundRefs.has(refId)) notFound++
    })
  }

  console.log(`Matched: ${matched}`)
  console.log(`Already matched: ${alreadyMatched}`)
  console.log(`Not found: ${notFound}`)
}

async function main() {
  await importShipping('INVOICE-DETAILS-JPHS-0016-070725.xlsx', 'JPHS-0016-070725')
  await importShipping('INVOICE-DETAILS-JPHS-0027-092225.xlsx', 'JPHS-0027-092225')

  console.log('\n=== DONE ===')
}

main().catch(console.error)
