/**
 * Analyze markup patterns by comparing:
 * - Reference XLSX (correct marked-up amounts created by Jetpack)
 * - DB raw costs (from ShipBob API)
 *
 * Goal: Understand what markup is being applied to generate correct invoices
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
  console.log('MARKUP PATTERN ANALYSIS')
  console.log('Comparing Reference XLSX (marked-up) vs DB (raw cost)')
  console.log('='.repeat(70))

  // Load reference XLSX - this has the CORRECT marked-up amounts
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  // Get Henson's User ID from XLSX (first data row, column 1)
  const shipments = wb.getWorksheet('Shipments')

  // Extract shipment data from XLSX
  // Column structure from earlier investigation:
  // Col 5 = OrderID (which is actually shipment_id)
  // Col 10 = Base shipping (Fulfillment w/o Surcharge)
  // Col 11 = Surcharge Applied
  // Col 12 = Original Invoice (total marked-up amount)

  const xlsxData = {} // shipment_id -> { base, surcharge, total, userId }
  let hensonUserId = null

  shipments.eachRow((row, idx) => {
    if (idx === 1) return // Skip header

    const userId = row.getCell(1).value
    const shipmentId = String(row.getCell(5).value)
    const base = Number(row.getCell(10).value) || 0
    const surcharge = Number(row.getCell(11).value) || 0
    const total = Number(row.getCell(12).value) || 0

    // Henson's User ID from previous analysis
    if (userId === 386350) {
      hensonUserId = userId
      xlsxData[shipmentId] = { base, surcharge, total, userId }
    }
  })

  console.log('\nXLSX Summary (Henson only):')
  console.log('  Shipments:', Object.keys(xlsxData).length)
  const xlsxTotal = Object.values(xlsxData).reduce((s, d) => s + d.total, 0)
  console.log('  Total marked-up amount: $' + xlsxTotal.toFixed(2))

  // Get Henson client ID from DB
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .ilike('company_name', '%henson%')
    .single()

  console.log('\n  Henson client_id:', henson?.id)
  console.log('  Henson merchant_id:', henson?.merchant_id)

  // Get DB raw costs for these exact shipment IDs
  const shipmentIds = Object.keys(xlsxData)
  console.log('\n' + '='.repeat(70))
  console.log('Fetching DB raw costs for', shipmentIds.length, 'shipments...')

  // Query transactions for these shipment_ids
  const dbData = {} // shipment_id -> { amount, fees: [] }

  // Batch query since we have many IDs
  const batchSize = 100
  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize)

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('reference_id, amount, transaction_fee')
      .eq('reference_type', 'Shipment')
      .in('reference_id', batch)

    if (error) {
      console.log('Error:', error)
      continue
    }

    for (const tx of txs || []) {
      const sid = tx.reference_id
      if (!dbData[sid]) {
        dbData[sid] = { total: 0, fees: [] }
      }
      dbData[sid].total += Number(tx.amount)
      dbData[sid].fees.push(tx.transaction_fee)
    }
  }

  console.log('  Found DB data for', Object.keys(dbData).length, 'shipments')
  const dbTotal = Object.values(dbData).reduce((s, d) => s + d.total, 0)
  console.log('  Total raw cost: $' + dbTotal.toFixed(2))

  // Compare per-shipment
  console.log('\n' + '='.repeat(70))
  console.log('PER-SHIPMENT MARKUP ANALYSIS')
  console.log('='.repeat(70))

  const markups = []
  let matchCount = 0
  let missingCount = 0

  for (const [sid, xlsx] of Object.entries(xlsxData)) {
    const db = dbData[sid]

    if (!db) {
      missingCount++
      continue
    }

    matchCount++
    const markup = xlsx.total - db.total
    const ratio = xlsx.total / db.total

    markups.push({
      shipmentId: sid,
      xlsxTotal: xlsx.total,
      xlsxBase: xlsx.base,
      xlsxSurcharge: xlsx.surcharge,
      dbTotal: db.total,
      markup,
      ratio,
      dbFees: db.fees
    })
  }

  console.log('  Matched shipments:', matchCount)
  console.log('  Missing from DB:', missingCount)

  // Analyze markup patterns
  if (markups.length > 0) {
    const totalXlsx = markups.reduce((s, m) => s + m.xlsxTotal, 0)
    const totalDb = markups.reduce((s, m) => s + m.dbTotal, 0)
    const totalMarkup = markups.reduce((s, m) => s + m.markup, 0)
    const avgRatio = totalXlsx / totalDb

    console.log('\n' + '='.repeat(70))
    console.log('OVERALL MARKUP STATISTICS')
    console.log('='.repeat(70))
    console.log('  Total XLSX (marked-up):  $' + totalXlsx.toFixed(2))
    console.log('  Total DB (raw cost):     $' + totalDb.toFixed(2))
    console.log('  Total markup applied:    $' + totalMarkup.toFixed(2))
    console.log('  Average markup ratio:    ' + avgRatio.toFixed(4) + 'x (' + ((avgRatio - 1) * 100).toFixed(2) + '%)')

    // Distribution of markup ratios
    const ratios = markups.map(m => m.ratio).filter(r => r > 0 && r < 10)
    ratios.sort((a, b) => a - b)

    console.log('\n  Markup Ratio Distribution:')
    console.log('    Min:    ' + Math.min(...ratios).toFixed(4) + 'x')
    console.log('    P25:    ' + ratios[Math.floor(ratios.length * 0.25)].toFixed(4) + 'x')
    console.log('    Median: ' + ratios[Math.floor(ratios.length * 0.5)].toFixed(4) + 'x')
    console.log('    P75:    ' + ratios[Math.floor(ratios.length * 0.75)].toFixed(4) + 'x')
    console.log('    Max:    ' + Math.max(...ratios).toFixed(4) + 'x')

    // Sample shipments showing markup
    console.log('\n' + '='.repeat(70))
    console.log('SAMPLE SHIPMENTS (showing markup calculation)')
    console.log('='.repeat(70))

    // Sort by total to get varied sample
    const sorted = markups.sort((a, b) => b.xlsxTotal - a.xlsxTotal)

    for (const m of sorted.slice(0, 10)) {
      console.log(`\nShipment ${m.shipmentId}:`)
      console.log(`  XLSX (correct marked-up):`)
      console.log(`    Base (w/o surcharge): $${m.xlsxBase.toFixed(2)}`)
      console.log(`    Surcharge:            $${m.xlsxSurcharge.toFixed(2)}`)
      console.log(`    Total:                $${m.xlsxTotal.toFixed(2)}`)
      console.log(`  DB (raw cost):          $${m.dbTotal.toFixed(2)}`)
      console.log(`  Markup applied:         $${m.markup.toFixed(2)} (${((m.ratio - 1) * 100).toFixed(1)}%)`)
    }

    // Check if there's a consistent formula
    console.log('\n' + '='.repeat(70))
    console.log('MARKUP FORMULA ANALYSIS')
    console.log('='.repeat(70))

    // Test hypothesis: Is markup a fixed percentage?
    const percentages = markups.map(m => ((m.ratio - 1) * 100))
    const avgPct = percentages.reduce((s, p) => s + p, 0) / percentages.length
    const variance = percentages.reduce((s, p) => s + Math.pow(p - avgPct, 2), 0) / percentages.length
    const stdDev = Math.sqrt(variance)

    console.log('  Average markup %:', avgPct.toFixed(2) + '%')
    console.log('  Standard deviation:', stdDev.toFixed(2) + '%')

    if (stdDev < 5) {
      console.log('\n  => CONSISTENT MARKUP: ~' + avgPct.toFixed(1) + '% across shipments')
    } else {
      console.log('\n  => VARIABLE MARKUP: Different rates applied')

      // Group by ratio buckets
      const buckets = {}
      for (const m of markups) {
        const bucket = Math.round(m.ratio * 100) / 100
        if (!buckets[bucket]) buckets[bucket] = { count: 0, total: 0 }
        buckets[bucket].count++
        buckets[bucket].total += m.xlsxTotal
      }

      console.log('\n  Ratio buckets:')
      const sortedBuckets = Object.entries(buckets)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)

      for (const [ratio, data] of sortedBuckets) {
        console.log(`    ${ratio}x: ${data.count} shipments ($${data.total.toFixed(2)})`)
      }
    }
  }
}

main().catch(console.error)
