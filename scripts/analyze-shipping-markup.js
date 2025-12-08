/**
 * Analyze SHIPPING-ONLY markup patterns
 * Filter to only "Shipping" transaction_fee type for comparison with XLSX Shipments tab
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
  console.log('SHIPPING-ONLY MARKUP ANALYSIS')
  console.log('Comparing XLSX Shipments tab vs DB "Shipping" fee type only')
  console.log('='.repeat(70))

  // Load reference XLSX
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const shipments = wb.getWorksheet('Shipments')

  // Extract Henson shipments from XLSX (userId 386350)
  const xlsxData = {}
  shipments.eachRow((row, idx) => {
    if (idx === 1) return
    const userId = row.getCell(1).value
    if (userId !== 386350) return // Only Henson

    const shipmentId = String(row.getCell(5).value)
    const base = Number(row.getCell(10).value) || 0
    const surcharge = Number(row.getCell(11).value) || 0
    const total = Number(row.getCell(12).value) || 0
    xlsxData[shipmentId] = { base, surcharge, total }
  })

  console.log('\nXLSX Henson Shipments:', Object.keys(xlsxData).length)
  const xlsxTotal = Object.values(xlsxData).reduce((s, d) => s + d.total, 0)
  console.log('  Total marked-up: $' + xlsxTotal.toFixed(2))

  // Get DB "Shipping" transactions ONLY for these shipment IDs
  const shipmentIds = Object.keys(xlsxData)
  const dbData = {}

  const batchSize = 100
  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize)

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('reference_id, amount, transaction_fee, invoice_id_sb')
      .eq('reference_type', 'Shipment')
      .eq('transaction_fee', 'Shipping')  // ONLY Shipping fee type
      .in('reference_id', batch)

    if (error) {
      console.log('Error:', error)
      continue
    }

    for (const tx of txs || []) {
      const sid = tx.reference_id
      if (!dbData[sid]) {
        dbData[sid] = { total: 0, invoices: [] }
      }
      dbData[sid].total += Number(tx.amount)
      if (!dbData[sid].invoices.includes(tx.invoice_id_sb)) {
        dbData[sid].invoices.push(tx.invoice_id_sb)
      }
    }
  }

  console.log('\nDB Shipping-only transactions found:', Object.keys(dbData).length)
  const dbTotal = Object.values(dbData).reduce((s, d) => s + d.total, 0)
  console.log('  Total raw cost: $' + dbTotal.toFixed(2))

  // Compare
  const markups = []
  let missing = 0

  for (const [sid, xlsx] of Object.entries(xlsxData)) {
    const db = dbData[sid]
    if (!db) {
      missing++
      continue
    }

    const markup = xlsx.total - db.total
    const ratio = db.total > 0 ? xlsx.total / db.total : 0

    markups.push({
      shipmentId: sid,
      xlsxTotal: xlsx.total,
      xlsxBase: xlsx.base,
      xlsxSurcharge: xlsx.surcharge,
      dbTotal: db.total,
      markup,
      ratio
    })
  }

  console.log('\n' + '='.repeat(70))
  console.log('MARKUP STATISTICS (Shipping Only)')
  console.log('='.repeat(70))
  console.log('  Matched:', markups.length)
  console.log('  Missing from DB:', missing)

  if (markups.length > 0) {
    const totalXlsx = markups.reduce((s, m) => s + m.xlsxTotal, 0)
    const totalDb = markups.reduce((s, m) => s + m.dbTotal, 0)
    const totalMarkup = markups.reduce((s, m) => s + m.markup, 0)
    const avgRatio = totalXlsx / totalDb

    console.log('\n  Total XLSX (marked-up):  $' + totalXlsx.toFixed(2))
    console.log('  Total DB (raw cost):     $' + totalDb.toFixed(2))
    console.log('  Total markup:            $' + totalMarkup.toFixed(2))
    console.log('  Average markup ratio:    ' + avgRatio.toFixed(4) + 'x (' + ((avgRatio - 1) * 100).toFixed(2) + '%)')

    // Check for anomalies (DB > XLSX)
    const anomalies = markups.filter(m => m.dbTotal > m.xlsxTotal)
    console.log('\n  Anomalies (DB > XLSX):   ' + anomalies.length)

    if (anomalies.length > 0) {
      console.log('\n  Sample anomalies:')
      for (const a of anomalies.slice(0, 5)) {
        console.log(`    ${a.shipmentId}: XLSX $${a.xlsxTotal.toFixed(2)} vs DB $${a.dbTotal.toFixed(2)}`)
      }
    }

    // Distribution
    const ratios = markups.map(m => m.ratio).filter(r => r > 0 && r < 5)
    ratios.sort((a, b) => a - b)

    console.log('\n  Markup Ratio Distribution:')
    console.log('    Min:    ' + Math.min(...ratios).toFixed(4) + 'x')
    console.log('    P10:    ' + ratios[Math.floor(ratios.length * 0.10)].toFixed(4) + 'x')
    console.log('    P25:    ' + ratios[Math.floor(ratios.length * 0.25)].toFixed(4) + 'x')
    console.log('    Median: ' + ratios[Math.floor(ratios.length * 0.50)].toFixed(4) + 'x')
    console.log('    P75:    ' + ratios[Math.floor(ratios.length * 0.75)].toFixed(4) + 'x')
    console.log('    P90:    ' + ratios[Math.floor(ratios.length * 0.90)].toFixed(4) + 'x')
    console.log('    Max:    ' + Math.max(...ratios).toFixed(4) + 'x')

    // Sample normal shipments
    console.log('\n' + '='.repeat(70))
    console.log('SAMPLE SHIPMENTS')
    console.log('='.repeat(70))

    const normal = markups.filter(m => m.ratio > 1.0 && m.ratio < 1.3).slice(0, 10)
    for (const m of normal) {
      console.log(`\n  Shipment ${m.shipmentId}:`)
      console.log(`    XLSX: $${m.xlsxTotal.toFixed(2)} (base $${m.xlsxBase.toFixed(2)} + surcharge $${m.xlsxSurcharge.toFixed(2)})`)
      console.log(`    DB:   $${m.dbTotal.toFixed(2)}`)
      console.log(`    Markup: $${m.markup.toFixed(2)} (${((m.ratio - 1) * 100).toFixed(1)}%)`)
    }

    // Formula analysis
    console.log('\n' + '='.repeat(70))
    console.log('MARKUP FORMULA ANALYSIS')
    console.log('='.repeat(70))

    const percentages = markups.filter(m => m.ratio > 0.5 && m.ratio < 2).map(m => (m.ratio - 1) * 100)
    const avg = percentages.reduce((s, p) => s + p, 0) / percentages.length
    const variance = percentages.reduce((s, p) => s + Math.pow(p - avg, 2), 0) / percentages.length
    const stdDev = Math.sqrt(variance)

    console.log('  Average markup %: ' + avg.toFixed(2) + '%')
    console.log('  Std deviation:    ' + stdDev.toFixed(2) + '%')

    if (stdDev < 3) {
      console.log('\n  => CONSISTENT: Apply ~' + avg.toFixed(1) + '% markup to shipping')
    } else {
      console.log('\n  => VARIABLE: Markup varies by shipment')

      // Check if it correlates with amount
      console.log('\n  Checking if markup % varies with shipment size...')

      const small = markups.filter(m => m.dbTotal < 10)
      const medium = markups.filter(m => m.dbTotal >= 10 && m.dbTotal < 20)
      const large = markups.filter(m => m.dbTotal >= 20)

      if (small.length > 0) {
        const smallAvg = small.reduce((s, m) => s + (m.ratio - 1) * 100, 0) / small.length
        console.log(`    Small (<$10):  avg ${smallAvg.toFixed(1)}% markup (${small.length} shipments)`)
      }
      if (medium.length > 0) {
        const medAvg = medium.reduce((s, m) => s + (m.ratio - 1) * 100, 0) / medium.length
        console.log(`    Medium ($10-20): avg ${medAvg.toFixed(1)}% markup (${medium.length} shipments)`)
      }
      if (large.length > 0) {
        const largeAvg = large.reduce((s, m) => s + (m.ratio - 1) * 100, 0) / large.length
        console.log(`    Large (>$20):  avg ${largeAvg.toFixed(1)}% markup (${large.length} shipments)`)
      }
    }
  }
}

main().catch(console.error)
