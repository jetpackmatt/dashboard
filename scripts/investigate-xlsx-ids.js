/**
 * Investigate whether XLSX "OrderID" column actually contains shipment_ids
 * The XLSX has OrderIDs in range 314479977-319175986
 * Our shipment_id values should be in a similar range
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const ExcelJS = require('exceljs')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('INVESTIGATING XLSX "OrderID" - IS IT ACTUALLY SHIPMENT_ID?')
  console.log('='.repeat(70))

  // Load the manual XLSX
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  const shipments = wb.getWorksheet('Shipments')

  // Extract first 20 "OrderID" values from XLSX
  const xlsxOrderIds = []
  shipments.eachRow((row, rowNum) => {
    if (rowNum === 1) return // Skip header
    if (xlsxOrderIds.length >= 20) return
    const orderId = row.getCell(5).value // Column 5 is "OrderID"
    if (orderId && typeof orderId === 'number') {
      xlsxOrderIds.push(orderId)
    }
  })

  console.log('\nFirst 20 "OrderID" values from XLSX:')
  console.log(xlsxOrderIds.join(', '))
  console.log(`\nRange: ${Math.min(...xlsxOrderIds)} - ${Math.max(...xlsxOrderIds)}`)

  // Check if these exist as shipment_id in our DB
  console.log('\n' + '='.repeat(70))
  console.log('CHECKING IF THESE ARE SHIPMENT_IDS IN OUR DB')
  console.log('='.repeat(70))

  const { data: matchingShipments, error: shipErr } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, client_id, shipped_date')
    .in('shipment_id', xlsxOrderIds)

  if (shipErr) {
    console.log('Error:', shipErr)
  } else {
    console.log(`\nMatched ${matchingShipments?.length || 0} as shipment_id`)
    if (matchingShipments && matchingShipments.length > 0) {
      console.log('\nSamples:')
      for (const s of matchingShipments.slice(0, 10)) {
        console.log(`  shipment_id ${s.shipment_id} -> order ${s.shipbob_order_id}, shipped ${s.shipped_date}`)
      }
    }
  }

  // Check if these exist as shipbob_order_id
  console.log('\n' + '='.repeat(70))
  console.log('CHECKING IF THESE ARE ORDER_IDS (shipbob_order_id) IN OUR DB')
  console.log('='.repeat(70))

  const { data: matchingOrders, error: ordErr } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, client_id, shipped_date')
    .in('shipbob_order_id', xlsxOrderIds)

  if (ordErr) {
    console.log('Error:', ordErr)
  } else {
    console.log(`\nMatched ${matchingOrders?.length || 0} as shipbob_order_id`)
    if (matchingOrders && matchingOrders.length > 0) {
      console.log('\nSamples:')
      for (const s of matchingOrders.slice(0, 10)) {
        console.log(`  order ${s.shipbob_order_id} -> shipment_id ${s.shipment_id}, shipped ${s.shipped_date}`)
      }
    }
  }

  // Now let's check what ranges we actually have in our DB
  console.log('\n' + '='.repeat(70))
  console.log('OUR DB RANGES FOR NOV 24-30')
  console.log('='.repeat(70))

  const { data: dbShipments } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id')
    .gte('shipped_date', '2025-11-24')
    .lte('shipped_date', '2025-11-30')
    .order('shipment_id', { ascending: true })
    .limit(5)

  const { data: dbShipmentsDesc } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id')
    .gte('shipped_date', '2025-11-24')
    .lte('shipped_date', '2025-11-30')
    .order('shipment_id', { ascending: false })
    .limit(5)

  console.log('\nOur shipment_id range (Nov 24-30):')
  if (dbShipments && dbShipments.length > 0) {
    const minId = dbShipments[0]?.shipment_id
    const maxId = dbShipmentsDesc?.[0]?.shipment_id
    console.log(`  Min: ${minId}`)
    console.log(`  Max: ${maxId}`)
    console.log(`\nSamples (ascending):`)
    for (const s of dbShipments) {
      console.log(`  shipment_id: ${s.shipment_id}, order: ${s.shipbob_order_id}`)
    }
  }

  // Check the transactions table for reference_id ranges
  console.log('\n' + '='.repeat(70))
  console.log('TRANSACTION reference_id RANGES FOR INVOICE 8633612')
  console.log('='.repeat(70))

  const { data: txSamples } = await supabase
    .from('transactions')
    .select('reference_id, reference_type, amount, transaction_fee')
    .eq('invoice_id_sb', 8633612)
    .eq('reference_type', 'Shipment')
    .limit(20)

  if (txSamples && txSamples.length > 0) {
    console.log('\nSample transaction reference_ids (these are shipment_ids):')
    for (const tx of txSamples) {
      console.log(`  ${tx.reference_id}: $${Number(tx.amount).toFixed(2)} (${tx.transaction_fee})`)
    }

    // Check if these shipment_ids exist in our shipments table
    const txShipmentIds = txSamples.map(t => Number(t.reference_id))
    console.log('\n\nChecking if these transaction shipment_ids exist in shipments table...')

    const { data: linkedShipments } = await supabase
      .from('shipments')
      .select('shipment_id, shipbob_order_id, shipped_date')
      .in('shipment_id', txShipmentIds)

    console.log(`\nFound ${linkedShipments?.length || 0} / ${txShipmentIds.length} in shipments table`)
    if (linkedShipments && linkedShipments.length > 0) {
      for (const s of linkedShipments.slice(0, 10)) {
        console.log(`  shipment ${s.shipment_id} -> order ${s.shipbob_order_id}, shipped ${s.shipped_date}`)
      }
    }
  }

  // Key test: Do XLSX "OrderIDs" match ANY transaction reference_ids?
  console.log('\n' + '='.repeat(70))
  console.log('KEY TEST: DO XLSX "OrderIDs" MATCH TRANSACTION reference_id?')
  console.log('='.repeat(70))

  const { data: matchingTx } = await supabase
    .from('transactions')
    .select('reference_id, amount, transaction_fee, invoice_id_sb')
    .in('reference_id', xlsxOrderIds.map(String))
    .eq('reference_type', 'Shipment')

  console.log(`\nXLSX "OrderIDs" that match transaction reference_ids: ${matchingTx?.length || 0}`)
  if (matchingTx && matchingTx.length > 0) {
    console.log('\nMatches found! These XLSX "OrderIDs" are actually shipment_ids:')
    for (const tx of matchingTx.slice(0, 10)) {
      console.log(`  ${tx.reference_id}: $${Number(tx.amount).toFixed(2)} - invoice ${tx.invoice_id_sb}`)
    }
  }

  // Let's also check the column headers in the XLSX to see what they call it
  console.log('\n' + '='.repeat(70))
  console.log('XLSX COLUMN HEADERS')
  console.log('='.repeat(70))

  const headerRow = shipments.getRow(1)
  const headers = []
  headerRow.eachCell((cell, colNum) => {
    headers.push(`Col ${colNum}: ${cell.value}`)
  })
  console.log(headers.join('\n'))
}

main().catch(console.error)
