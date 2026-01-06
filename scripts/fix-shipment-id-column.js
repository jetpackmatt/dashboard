/**
 * Fix Shipment ID Column in Existing XLSX Files
 *
 * Downloads the XLSX, replaces order_id with shipment_id in Column E,
 * and re-uploads. Does NOT regenerate or modify any other data.
 *
 * Usage: node scripts/fix-shipment-id-column.js <invoiceNumber>
 * Example: node scripts/fix-shipment-id-column.js JPHS-0039-121525
 */

const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixShipmentIdColumn(invoiceNumber) {
  console.log(`\n=== Fixing Shipment ID column for ${invoiceNumber} ===\n`)

  // 1. Get invoice record to find client_id and file path
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select('id, client_id, invoice_number')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError)
    return
  }

  const filePath = `${invoice.client_id}/${invoice.invoice_number}/${invoice.invoice_number}-details.xlsx`
  console.log(`Downloading: ${filePath}`)

  // 2. Download existing XLSX file
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('invoices')
    .download(filePath)

  if (downloadError || !fileData) {
    console.error('Failed to download file:', downloadError)
    return
  }

  // 3. Read the XLSX file
  const arrayBuffer = await fileData.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })

  // 4. Find the Shipments sheet
  const sheetName = workbook.SheetNames.find(name => name.toLowerCase().includes('shipment'))
  if (!sheetName) {
    console.error('No Shipments sheet found. Sheets:', workbook.SheetNames)
    return
  }

  console.log(`Found sheet: ${sheetName}`)
  const sheet = workbook.Sheets[sheetName]

  // 5. Get all unique order_ids from Column E (starting from row 2)
  const range = XLSX.utils.decode_range(sheet['!ref'])
  const orderIds = new Set()

  for (let row = 1; row <= range.e.r; row++) { // Start from row 1 (0-indexed, so this is row 2)
    const cellRef = XLSX.utils.encode_cell({ r: row, c: 4 }) // Column E = index 4
    const cell = sheet[cellRef]
    if (cell && cell.v) {
      orderIds.add(String(cell.v))
    }
  }

  console.log(`Found ${orderIds.size} unique values in Column E`)

  // 6. Query shipments table to build order_id -> shipment_id map
  const orderIdArray = [...orderIds]
  const orderToShipmentMap = new Map()

  // Query in batches
  for (let i = 0; i < orderIdArray.length; i += 500) {
    const batch = orderIdArray.slice(i, i + 500)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipment_id, shipbob_order_id')
      .in('shipbob_order_id', batch)

    for (const s of shipments || []) {
      orderToShipmentMap.set(String(s.shipbob_order_id), String(s.shipment_id))
    }
  }

  console.log(`Found ${orderToShipmentMap.size} order->shipment mappings`)

  // 7. Replace values in Column E
  let replacedCount = 0
  let notFoundCount = 0

  for (let row = 1; row <= range.e.r; row++) {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: 4 })
    const cell = sheet[cellRef]
    if (cell && cell.v) {
      const orderId = String(cell.v)
      const shipmentId = orderToShipmentMap.get(orderId)
      if (shipmentId) {
        cell.v = shipmentId
        replacedCount++
      } else {
        notFoundCount++
      }
    }
  }

  console.log(`Replaced: ${replacedCount}, Not found: ${notFoundCount}`)

  // 8. Write the modified workbook to a buffer
  const newBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  console.log(`New file size: ${newBuffer.length} bytes`)

  // 9. Upload back to storage (overwrite)
  const { error: uploadError } = await supabase.storage
    .from('invoices')
    .upload(filePath, newBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true
    })

  if (uploadError) {
    console.error('Failed to upload:', uploadError)
    return
  }

  console.log(`\n=== SUCCESS ===`)
  console.log(`Fixed ${replacedCount} rows in ${invoiceNumber}`)
}

const invoiceNumber = process.argv[2]
if (!invoiceNumber) {
  console.log('Usage: node scripts/fix-shipment-id-column.js <invoiceNumber>')
  console.log('Example: node scripts/fix-shipment-id-column.js JPHS-0039-121525')
  process.exit(1)
}

fixShipmentIdColumn(invoiceNumber).catch(console.error)
