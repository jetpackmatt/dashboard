/**
 * Compare shipment amounts between XLSX and our DB
 * XLSX has: shipment_id (OrderID), base shipping, surcharge, total
 * Our DB has: reference_id (shipment_id), amount (total per tx), multiple tx per shipment
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
  console.log('COMPARING SHIPMENT AMOUNTS: XLSX vs DB')
  console.log('='.repeat(70))

  // Load XLSX data - build map of shipment_id -> total shipping cost
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const sheet = wb.getWorksheet('Shipments')

  const xlsxData = {} // shipment_id -> { base, surcharge, total, userId }
  let xlsxTotal = 0
  let xlsxHensonTotal = 0

  sheet.eachRow((row, idx) => {
    if (idx === 1) return

    const userId = row.getCell(1).value
    const shipmentId = String(row.getCell(5).value)
    const base = Number(row.getCell(10).value) || 0
    const surcharge = Number(row.getCell(11).value) || 0
    const total = Number(row.getCell(12).value) || 0

    xlsxData[shipmentId] = { base, surcharge, total, userId }
    xlsxTotal += total

    // User ID 143668 is Henson (based on merchant name in XLSX)
    if (userId === 143668) {
      xlsxHensonTotal += total
    }
  })

  console.log('\nXLSX Summary:')
  console.log('  Total shipments:', Object.keys(xlsxData).length)
  console.log('  Total amount (all clients):', '$' + xlsxTotal.toFixed(2))
  console.log('  Henson subtotal (userId=143668):', '$' + xlsxHensonTotal.toFixed(2))

  // Get Henson client ID
  const { data: henson } = await supabase
    .from('clients')
    .select('id, merchant_id')
    .ilike('company_name', '%henson%')
    .single()

  console.log('\n  Henson client_id:', henson?.id)
  console.log('  Henson merchant_id:', henson?.merchant_id)

  // Get all Shipping transactions from invoice 8633612
  console.log('\n' + '='.repeat(70))
  console.log('Loading DB shipping transactions for invoice 8633612...')

  let allTx = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('reference_id, amount, transaction_fee, client_id')
      .eq('invoice_id_sb', 8633612)
      .eq('reference_type', 'Shipment')
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  console.log('  Total shipping transactions:', allTx.length)

  // Group by shipment_id
  const dbByShipment = {}
  for (const tx of allTx) {
    const sid = tx.reference_id
    if (!dbByShipment[sid]) {
      dbByShipment[sid] = { total: 0, fees: [], clientId: tx.client_id }
    }
    dbByShipment[sid].total += Number(tx.amount)
    dbByShipment[sid].fees.push(tx.transaction_fee)
  }

  const dbTotal = allTx.reduce((s, t) => s + Number(t.amount), 0)
  const dbHensonTx = allTx.filter(t => t.client_id === henson?.id)
  const dbHensonTotal = dbHensonTx.reduce((s, t) => s + Number(t.amount), 0)

  console.log('  Total amount (all clients):', '$' + dbTotal.toFixed(2))
  console.log('  Henson subtotal:', '$' + dbHensonTotal.toFixed(2))
  console.log('  Unique shipments:', Object.keys(dbByShipment).length)

  // Compare XLSX vs DB totals
  console.log('\n' + '='.repeat(70))
  console.log('TOTAL COMPARISON:')
  console.log('='.repeat(70))
  console.log('  XLSX Total (all):     $' + xlsxTotal.toFixed(2))
  console.log('  DB Total (all):       $' + dbTotal.toFixed(2))
  console.log('  Difference:           $' + (dbTotal - xlsxTotal).toFixed(2))
  console.log('')
  console.log('  XLSX Henson:          $' + xlsxHensonTotal.toFixed(2))
  console.log('  DB Henson:            $' + dbHensonTotal.toFixed(2))
  console.log('  Difference:           $' + (dbHensonTotal - xlsxHensonTotal).toFixed(2))

  // Find shipments with different amounts
  console.log('\n' + '='.repeat(70))
  console.log('PER-SHIPMENT COMPARISON:')
  console.log('='.repeat(70))

  let matchCount = 0
  let diffCount = 0
  const diffs = []

  for (const [sid, xlsx] of Object.entries(xlsxData)) {
    const db = dbByShipment[sid]
    if (!db) {
      diffs.push({ sid, xlsxTotal: xlsx.total, dbTotal: 0, diff: -xlsx.total, reason: 'Missing in DB' })
      diffCount++
      continue
    }

    const diff = db.total - xlsx.total
    if (Math.abs(diff) < 0.01) {
      matchCount++
    } else {
      diffCount++
      diffs.push({
        sid,
        xlsxTotal: xlsx.total,
        xlsxBase: xlsx.base,
        xlsxSurcharge: xlsx.surcharge,
        dbTotal: db.total,
        diff,
        dbFees: db.fees.join(', ')
      })
    }
  }

  // Check for extra shipments in DB not in XLSX
  const xlsxIds = new Set(Object.keys(xlsxData))
  const extraInDb = Object.keys(dbByShipment).filter(sid => !xlsxIds.has(sid))

  console.log('  Matching amounts:', matchCount)
  console.log('  Different amounts:', diffCount)
  console.log('  Extra in DB (not in XLSX):', extraInDb.length)

  if (diffs.length > 0) {
    console.log('\nSample differences (first 20):')
    const sorted = diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    for (const d of sorted.slice(0, 20)) {
      console.log(`  Shipment ${d.sid}:`)
      console.log(`    XLSX: $${d.xlsxTotal?.toFixed(2)} (base=$${d.xlsxBase?.toFixed(2)}, surcharge=$${d.xlsxSurcharge?.toFixed(2)})`)
      console.log(`    DB:   $${d.dbTotal.toFixed(2)} (fees: ${d.dbFees || 'N/A'})`)
      console.log(`    Diff: $${d.diff.toFixed(2)} ${d.reason || ''}`)
    }

    const totalDiff = diffs.reduce((s, d) => s + d.diff, 0)
    console.log('\nTotal difference from per-shipment comparison: $' + totalDiff.toFixed(2))
  }

  // Analyze extra shipments in DB
  if (extraInDb.length > 0) {
    console.log('\n' + '='.repeat(70))
    console.log('EXTRA SHIPMENTS IN DB (not in XLSX):')
    let extraTotal = 0
    for (const sid of extraInDb.slice(0, 20)) {
      const db = dbByShipment[sid]
      extraTotal += db.total
      console.log(`  ${sid}: $${db.total.toFixed(2)} (${db.fees.join(', ')})`)
    }
    const allExtraTotal = extraInDb.reduce((s, sid) => s + dbByShipment[sid].total, 0)
    console.log(`\n  Total from ${extraInDb.length} extra shipments: $${allExtraTotal.toFixed(2)}`)
  }

  // Check client attribution
  console.log('\n' + '='.repeat(70))
  console.log('CLIENT ATTRIBUTION CHECK:')
  console.log('='.repeat(70))

  // For each XLSX Henson shipment, check if DB has it attributed to Henson
  let hensonMisattributed = 0
  let hensonMisattributedAmount = 0

  for (const [sid, xlsx] of Object.entries(xlsxData)) {
    if (xlsx.userId !== 143668) continue // Not Henson in XLSX

    const db = dbByShipment[sid]
    if (!db) continue

    if (db.clientId !== henson?.id) {
      hensonMisattributed++
      hensonMisattributedAmount += db.total
    }
  }

  console.log('  Henson shipments misattributed:', hensonMisattributed)
  console.log('  Amount misattributed:', '$' + hensonMisattributedAmount.toFixed(2))
}

main().catch(console.error)
