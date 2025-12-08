/**
 * Compare XLSX OrderIDs with our DB transaction reference_ids
 * to understand the data relationship
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
  console.log('COMPARING XLSX OrderIDs WITH DB TRANSACTION reference_ids')
  console.log('='.repeat(70))

  // Get XLSX OrderIDs
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const sheet = wb.getWorksheet('Shipments')

  const xlsxOrderIds = []
  sheet.eachRow((row, idx) => {
    if (idx === 1) return
    const val = row.getCell(5).value
    if (val) xlsxOrderIds.push(String(val))
  })

  console.log('\nXLSX OrderID count:', xlsxOrderIds.length)
  console.log('First 10:', xlsxOrderIds.slice(0, 10).join(', '))

  // Get numeric values for range calculation
  const xlsxNums = xlsxOrderIds.map(Number).filter(n => n > 0)
  console.log('XLSX OrderID range:', Math.min(...xlsxNums), '-', Math.max(...xlsxNums))

  // Check if these match transaction reference_ids for shipping invoice 8633612
  console.log('\n' + '='.repeat(70))
  console.log('Checking if XLSX OrderIDs match transaction reference_ids...')

  // Get a sample of XLSX IDs to check
  const sampleIds = xlsxOrderIds.slice(0, 100)

  const { data: matchingTx, error } = await supabase
    .from('transactions')
    .select('reference_id, amount, transaction_fee, invoice_id_sb')
    .in('reference_id', sampleIds)
    .eq('reference_type', 'Shipment')

  if (error) {
    console.log('Error:', error)
    return
  }

  console.log('\nMatched', matchingTx?.length || 0, 'XLSX OrderIDs to transaction reference_ids (out of first 100)')

  if (matchingTx && matchingTx.length > 0) {
    console.log('\nSample matches:')
    for (const tx of matchingTx.slice(0, 10)) {
      console.log('  ref_id=' + tx.reference_id + ' $' + tx.amount + ' (' + tx.transaction_fee + ') invoice=' + tx.invoice_id_sb)
    }
  }

  // Get our transaction reference_ids for invoice 8633612
  console.log('\n' + '='.repeat(70))
  console.log('Our transaction reference_ids for invoice 8633612:')

  let allOurTx = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('reference_id')
      .eq('invoice_id_sb', 8633612)
      .eq('reference_type', 'Shipment')
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allOurTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  const ourIds = allOurTx.map(t => t.reference_id)
  console.log('Total count:', ourIds.length)
  console.log('First 20:', ourIds.slice(0, 20).join(', '))

  const ourNums = ourIds.map(Number).filter(n => n > 0)
  console.log('Our ref_id range:', Math.min(...ourNums), '-', Math.max(...ourNums))

  // Check overlap
  const xlsxSet = new Set(xlsxOrderIds)
  const ourSet = new Set(ourIds)

  const xlsxInOurs = xlsxOrderIds.filter(id => ourSet.has(id))
  const oursInXlsx = ourIds.filter(id => xlsxSet.has(id))

  console.log('\n' + '='.repeat(70))
  console.log('OVERLAP ANALYSIS:')
  console.log('  XLSX OrderIDs found in our transactions:', xlsxInOurs.length)
  console.log('  Our ref_ids found in XLSX:', oursInXlsx.length)

  if (xlsxInOurs.length > 0) {
    console.log('\n  Sample overlapping IDs:')
    for (const id of xlsxInOurs.slice(0, 10)) {
      console.log('    ' + id)
    }
  }

  // The key question: What IS the XLSX "OrderID"?
  // Let's check if it matches our shipment_id or shipbob_order_id
  console.log('\n' + '='.repeat(70))
  console.log('CHECKING IF XLSX OrderID = shipment_id IN OUR shipments TABLE')

  const xlsxSample = xlsxNums.slice(0, 50)
  const { data: shipmentMatches } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, client_id')
    .in('shipment_id', xlsxSample)

  console.log('Matched', shipmentMatches?.length || 0, 'as shipment_id (out of 50)')

  console.log('\n' + '='.repeat(70))
  console.log('CHECKING IF XLSX OrderID = shipbob_order_id IN OUR shipments TABLE')

  const { data: orderMatches } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_order_id, client_id')
    .in('shipbob_order_id', xlsxSample)

  console.log('Matched', orderMatches?.length || 0, 'as shipbob_order_id (out of 50)')

  if (orderMatches && orderMatches.length > 0) {
    console.log('\nSample order matches:')
    for (const s of orderMatches.slice(0, 5)) {
      console.log('  shipbob_order_id=' + s.shipbob_order_id + ' -> shipment_id=' + s.shipment_id)
    }
  }

  // Conclusion
  console.log('\n' + '='.repeat(70))
  console.log('CONCLUSION:')
  if (xlsxInOurs.length > ourIds.length * 0.5) {
    console.log('  XLSX OrderID = transaction reference_id (shipment_id)')
  } else if (shipmentMatches?.length > 25) {
    console.log('  XLSX OrderID = shipments.shipment_id')
  } else if (orderMatches?.length > 25) {
    console.log('  XLSX OrderID = shipments.shipbob_order_id')
  } else {
    console.log('  XLSX OrderID does NOT match our data!')
    console.log('  This suggests the XLSX is from a different data source (e.g., ShipBob dashboard export)')
  }
}

main().catch(console.error)
