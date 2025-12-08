/**
 * Analyze markup separately for base vs surcharge
 * Hypothesis: Base is marked up ~17-18%, surcharges passed through at cost
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
  console.log('BASE vs SURCHARGE MARKUP ANALYSIS')
  console.log('='.repeat(70))

  // Load reference XLSX
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const shipments = wb.getWorksheet('Shipments')

  // Extract Henson data (userId 386350)
  const xlsxData = {}
  shipments.eachRow((row, idx) => {
    if (idx === 1) return
    const userId = row.getCell(1).value
    if (userId !== 386350) return

    const shipmentId = String(row.getCell(5).value)
    const base = Number(row.getCell(10).value) || 0
    const surcharge = Number(row.getCell(11).value) || 0
    const total = Number(row.getCell(12).value) || 0
    xlsxData[shipmentId] = { base, surcharge, total }
  })

  console.log('\nXLSX Henson shipments:', Object.keys(xlsxData).length)

  // Get DB Shipping costs
  const shipmentIds = Object.keys(xlsxData)
  const dbData = {}

  const batchSize = 100
  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize)
    const { data: txs } = await supabase
      .from('transactions')
      .select('reference_id, amount')
      .eq('reference_type', 'Shipment')
      .eq('transaction_fee', 'Shipping')
      .in('reference_id', batch)

    for (const tx of txs || []) {
      dbData[tx.reference_id] = (dbData[tx.reference_id] || 0) + Number(tx.amount)
    }
  }

  // Analyze markup patterns
  const analysis = []
  for (const [sid, xlsx] of Object.entries(xlsxData)) {
    const dbCost = dbData[sid]
    if (!dbCost) continue

    const totalMarkup = xlsx.total - dbCost
    const totalRatio = xlsx.total / dbCost

    // If surcharge is passed through at cost, then:
    // marked_up_base = xlsxTotal - surcharge
    // raw_base = dbCost - surcharge (if surcharge is at cost)

    // Try hypothesis: surcharge = 0 markup
    // Then: rawBase = dbCost
    // markedBase = xlsx.base
    // baseMarkup = xlsx.base / (dbCost - (xlsx.surcharge / 1.0))
    // But we don't know raw surcharge...

    // Alternative: if surcharge is passed through exactly
    // rawBase = dbCost - rawSurcharge
    // But if xlsxSurcharge = rawSurcharge (0% markup on surcharge)
    // Then rawBase = dbCost - xlsx.surcharge
    const hypotheticalRawBase = dbCost - xlsx.surcharge

    let baseMarkupRatio = null
    if (hypotheticalRawBase > 0 && xlsx.surcharge >= 0) {
      baseMarkupRatio = xlsx.base / hypotheticalRawBase
    }

    analysis.push({
      sid,
      xlsxBase: xlsx.base,
      xlsxSurcharge: xlsx.surcharge,
      xlsxTotal: xlsx.total,
      dbCost,
      totalRatio,
      hypotheticalRawBase,
      baseMarkupRatio,
      surchargePercent: xlsx.surcharge / xlsx.total * 100
    })
  }

  // Filter to valid base markup ratios
  const validBaseMarkups = analysis.filter(a =>
    a.baseMarkupRatio &&
    a.baseMarkupRatio > 0.9 &&
    a.baseMarkupRatio < 1.5 &&
    a.hypotheticalRawBase > 0
  )

  console.log('\nHYPOTHESIS: Surcharges passed through at cost (0% markup)')
  console.log('='.repeat(70))
  console.log('Valid samples for base markup analysis:', validBaseMarkups.length)

  if (validBaseMarkups.length > 0) {
    const baseRatios = validBaseMarkups.map(a => a.baseMarkupRatio)
    baseRatios.sort((a, b) => a - b)

    const avgBaseRatio = baseRatios.reduce((s, r) => s + r, 0) / baseRatios.length
    const basePercentages = baseRatios.map(r => (r - 1) * 100)
    const avgBasePercent = basePercentages.reduce((s, p) => s + p, 0) / basePercentages.length
    const variance = basePercentages.reduce((s, p) => s + Math.pow(p - avgBasePercent, 2), 0) / basePercentages.length
    const stdDev = Math.sqrt(variance)

    console.log('\nBase Markup Distribution (if surcharge = 0% markup):')
    console.log('  Min:    ' + baseRatios[0].toFixed(4) + 'x (' + ((baseRatios[0] - 1) * 100).toFixed(1) + '%)')
    console.log('  P10:    ' + baseRatios[Math.floor(baseRatios.length * 0.10)].toFixed(4) + 'x')
    console.log('  P25:    ' + baseRatios[Math.floor(baseRatios.length * 0.25)].toFixed(4) + 'x')
    console.log('  Median: ' + baseRatios[Math.floor(baseRatios.length * 0.50)].toFixed(4) + 'x')
    console.log('  P75:    ' + baseRatios[Math.floor(baseRatios.length * 0.75)].toFixed(4) + 'x')
    console.log('  P90:    ' + baseRatios[Math.floor(baseRatios.length * 0.90)].toFixed(4) + 'x')
    console.log('  Max:    ' + baseRatios[baseRatios.length - 1].toFixed(4) + 'x (' + ((baseRatios[baseRatios.length - 1] - 1) * 100).toFixed(1) + '%)')

    console.log('\n  Average base markup: ' + avgBasePercent.toFixed(2) + '%')
    console.log('  Std deviation:       ' + stdDev.toFixed(2) + '%')

    if (stdDev < 5) {
      console.log('\n  => CONSISTENT: Base marked up ~' + avgBasePercent.toFixed(0) + '%, surcharges at cost')
    }

    // Verify: reconstruct totals and compare
    console.log('\n' + '='.repeat(70))
    console.log('FORMULA VALIDATION')
    console.log('Formula: markedUpTotal = rawBase * 1.175 + rawSurcharge')
    console.log('Where: rawBase = dbCost - xlsxSurcharge')
    console.log('='.repeat(70))

    let totalErrors = 0
    let maxError = 0
    const errors = []

    for (const a of validBaseMarkups) {
      const rawBase = a.dbCost - a.xlsxSurcharge
      const predictedTotal = rawBase * 1.175 + a.xlsxSurcharge
      const error = Math.abs(predictedTotal - a.xlsxTotal)

      totalErrors += error
      if (error > maxError) maxError = error

      if (error > 0.10) {  // Track significant errors
        errors.push({ ...a, predictedTotal, error })
      }
    }

    const avgError = totalErrors / validBaseMarkups.length

    console.log('\nUsing 17.5% base markup:')
    console.log('  Average error: $' + avgError.toFixed(4))
    console.log('  Max error:     $' + maxError.toFixed(4))
    console.log('  Errors > $0.10:', errors.length)

    // Try other percentages
    console.log('\n' + '='.repeat(70))
    console.log('TESTING DIFFERENT BASE MARKUP PERCENTAGES')
    console.log('='.repeat(70))

    for (const pct of [14, 15, 16, 17, 17.5, 18, 19, 20]) {
      const multiplier = 1 + pct / 100
      let sumSqError = 0
      let count = 0

      for (const a of validBaseMarkups) {
        const rawBase = a.dbCost - a.xlsxSurcharge
        if (rawBase <= 0) continue
        const predicted = rawBase * multiplier + a.xlsxSurcharge
        const error = predicted - a.xlsxTotal
        sumSqError += error * error
        count++
      }

      const rmse = Math.sqrt(sumSqError / count)
      console.log(`  ${pct}% markup: RMSE = $${rmse.toFixed(4)}`)
    }

    // Sample shipments with calculations
    console.log('\n' + '='.repeat(70))
    console.log('SAMPLE CALCULATIONS')
    console.log('='.repeat(70))

    const samples = validBaseMarkups
      .sort((a, b) => b.xlsxSurcharge - a.xlsxSurcharge)
      .slice(0, 10)

    for (const s of samples) {
      const rawBase = s.dbCost - s.xlsxSurcharge
      const predicted175 = rawBase * 1.175 + s.xlsxSurcharge

      console.log(`\nShipment ${s.sid}:`)
      console.log(`  DB raw cost:       $${s.dbCost.toFixed(2)}`)
      console.log(`  XLSX surcharge:    $${s.xlsxSurcharge.toFixed(2)}`)
      console.log(`  => Raw base:       $${rawBase.toFixed(2)}`)
      console.log(`  XLSX base:         $${s.xlsxBase.toFixed(2)}`)
      console.log(`  Base markup:       ${((s.xlsxBase / rawBase - 1) * 100).toFixed(1)}%`)
      console.log(`  XLSX total:        $${s.xlsxTotal.toFixed(2)}`)
      console.log(`  Predicted (17.5%): $${predicted175.toFixed(2)} (diff: $${(predicted175 - s.xlsxTotal).toFixed(2)})`)
    }
  }

  // Also check: what if both base AND surcharge are marked up?
  console.log('\n' + '='.repeat(70))
  console.log('ALTERNATIVE HYPOTHESIS: Flat % on total')
  console.log('='.repeat(70))

  const allTotals = analysis.filter(a => a.totalRatio > 0.9 && a.totalRatio < 1.5)
  const flatRatios = allTotals.map(a => a.totalRatio)
  flatRatios.sort((a, b) => a - b)

  const avgFlatRatio = flatRatios.reduce((s, r) => s + r, 0) / flatRatios.length
  const flatPercentages = flatRatios.map(r => (r - 1) * 100)
  const avgFlatPercent = flatPercentages.reduce((s, p) => s + p, 0) / flatPercentages.length
  const flatVariance = flatPercentages.reduce((s, p) => s + Math.pow(p - avgFlatPercent, 2), 0) / flatPercentages.length
  const flatStdDev = Math.sqrt(flatVariance)

  console.log('Average total markup: ' + avgFlatPercent.toFixed(2) + '%')
  console.log('Std deviation:        ' + flatStdDev.toFixed(2) + '%')

  // Correlation with surcharge percentage
  console.log('\nCorrelation: Markup % vs Surcharge %')
  const lowSurcharge = allTotals.filter(a => a.surchargePercent < 10)
  const highSurcharge = allTotals.filter(a => a.surchargePercent >= 30)

  if (lowSurcharge.length > 0) {
    const lowAvg = lowSurcharge.reduce((s, a) => s + (a.totalRatio - 1) * 100, 0) / lowSurcharge.length
    console.log(`  Low surcharge (<10%):  ${lowAvg.toFixed(1)}% markup (${lowSurcharge.length} shipments)`)
  }
  if (highSurcharge.length > 0) {
    const highAvg = highSurcharge.reduce((s, a) => s + (a.totalRatio - 1) * 100, 0) / highSurcharge.length
    console.log(`  High surcharge (>30%): ${highAvg.toFixed(1)}% markup (${highSurcharge.length} shipments)`)
  }

  if (flatStdDev > 3) {
    console.log('\n=> High variance in flat % markup')
    console.log('=> Confirms: Base and surcharge have DIFFERENT markup rates')
  }
}

main().catch(console.error)
