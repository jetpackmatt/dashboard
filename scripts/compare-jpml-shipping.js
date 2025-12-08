/**
 * Compare JPML-0021 shipping amounts: Reference vs DB
 */
require('dotenv').config({ path: '.env.local' })
const xlsx = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Load reference XLSX
  const wb = xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPML-0021-120125.xlsx')
  const ws = wb.Sheets['Shipments']
  const data = xlsx.utils.sheet_to_json(ws)

  // Build map of reference amounts by OrderID (excluding totals row)
  const refMap = {}
  for (const row of data) {
    const orderId = String(row['OrderID'])
    if (orderId !== 'undefined') {
      refMap[orderId] = {
        fulfillment: parseFloat(row['Fulfillment without Surcharge'] || 0),
        surcharge: parseFloat(row['Surcharge Applied'] || 0),
        insurance: parseFloat(row['Insurance Amount'] || 0),
        original: parseFloat(row['Original Invoice'] || 0)
      }
    }
  }
  console.log('Reference shipments:', Object.keys(refMap).length)

  // Get DB data
  const { data: dbRows, error } = await supabase
    .from('transactions')
    .select('reference_id, cost, base_cost, surcharge, insurance_cost, billed_amount, markup_percentage')
    .eq('client_id', 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e')
    .eq('transaction_fee', 'Shipping')
    .eq('invoice_id_jp', 'JPML-0021-120125')

  if (error) {
    console.error('DB error:', error.message)
    return
  }
  console.log('DB shipments:', dbRows.length)

  // Build DB map
  const dbMap = {}
  for (const row of dbRows) {
    dbMap[row.reference_id] = {
      cost: parseFloat(row.cost || 0),
      baseCost: parseFloat(row.base_cost || 0),
      surcharge: parseFloat(row.surcharge || 0),
      insurance: parseFloat(row.insurance_cost || 0),
      billed: parseFloat(row.billed_amount || 0),
      markupPct: parseFloat(row.markup_percentage || 0)
    }
  }

  // Compare and find discrepancies
  let refTotal = 0
  let dbTotal = 0
  const discrepancies = []

  for (const orderId of Object.keys(refMap)) {
    const ref = refMap[orderId]
    const db = dbMap[orderId]

    const refBilled = ref.fulfillment + ref.surcharge + ref.insurance
    refTotal += refBilled

    if (!db) {
      discrepancies.push({ orderId, issue: 'Missing from DB', refBilled })
      continue
    }

    dbTotal += db.billed

    const diff = Math.abs(refBilled - db.billed)
    if (diff > 0.01) {
      discrepancies.push({
        orderId,
        issue: 'Amount mismatch',
        refBilled: refBilled.toFixed(2),
        dbBilled: db.billed.toFixed(2),
        diff: diff.toFixed(2),
        refFulfillment: ref.fulfillment.toFixed(2),
        refSurcharge: ref.surcharge.toFixed(2),
        dbBaseCost: db.baseCost.toFixed(2),
        dbSurcharge: db.surcharge.toFixed(2),
        dbMarkup: (db.markupPct * 100).toFixed(2) + '%'
      })
    }
  }

  // Check for extra in DB
  for (const orderId of Object.keys(dbMap)) {
    if (!refMap[orderId]) {
      dbTotal += dbMap[orderId].billed
      discrepancies.push({ orderId, issue: 'Extra in DB (not in ref)', dbBilled: dbMap[orderId].billed })
    }
  }

  console.log('\n=== TOTALS ===')
  console.log('Reference total:', refTotal.toFixed(2))
  console.log('DB total:', dbTotal.toFixed(2))
  console.log('Difference:', (refTotal - dbTotal).toFixed(2))

  console.log('\n=== DISCREPANCIES ===')
  console.log('Count:', discrepancies.length)

  if (discrepancies.length > 0) {
    // Sort by diff amount
    discrepancies.sort((a, b) => {
      const diffA = parseFloat(a.diff || '0')
      const diffB = parseFloat(b.diff || '0')
      return diffB - diffA
    })

    console.log('\nTop 20 discrepancies:')
    for (const d of discrepancies.slice(0, 20)) {
      console.log(d)
    }

    // Sum of all diffs
    const totalDiff = discrepancies
      .filter(d => d.diff)
      .reduce((sum, d) => sum + parseFloat(d.diff), 0)
    console.log('\nTotal diff from mismatches:', totalDiff.toFixed(2))
  }
}

main().catch(console.error)
