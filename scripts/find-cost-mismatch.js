#!/usr/bin/env node
/**
 * Find transactions with mismatched costs between xlsx and DB
 */

require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const workbook = XLSX.readFile('reference/storage-backfills/storage-122225.xlsx')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)
  const dataRows = rows.filter(r => r['Inventory ID'] && !isNaN(r['ChargeStartdate']))

  // Group xlsx by Inventory ID + Location Type, sum amounts
  const xlsxGroups = new Map()
  for (const row of dataRows) {
    const invId = String(row['Inventory ID'])
    const locType = row['Location Type']
    const key = `${invId}-${locType}`
    const amount = parseFloat(row['Invoice']) || 0

    if (!xlsxGroups.has(key)) {
      xlsxGroups.set(key, { amounts: [], merchant: row['Merchant Name'] })
    }
    xlsxGroups.get(key).amounts.push(amount)
  }

  // Get DB transactions
  const { data: dbTx } = await supabase
    .from('transactions')
    .select('id, reference_id, cost, client_id')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  // Group DB by extracted Inventory ID + Location Type
  const dbGroups = new Map()
  for (const tx of dbTx) {
    const parts = tx.reference_id?.split('-') || []
    if (parts.length >= 3) {
      const invId = parts[1]
      const locType = parts.slice(2).join('-')
      const key = `${invId}-${locType}`

      if (!dbGroups.has(key)) {
        dbGroups.set(key, { costs: [], ids: [], clientId: tx.client_id })
      }
      dbGroups.get(key).costs.push(parseFloat(tx.cost))
      dbGroups.get(key).ids.push(tx.id)
    }
  }

  // Compare groups
  let totalXlsxDiff = 0
  const mismatches = []

  for (const [key, xlsx] of xlsxGroups) {
    const db = dbGroups.get(key)
    if (!db) {
      console.log(`Missing in DB: ${key}`)
      continue
    }

    const xlsxSum = xlsx.amounts.reduce((s, a) => s + a, 0)
    const dbSum = db.costs.reduce((s, c) => s + c, 0)
    const diff = dbSum - xlsxSum

    if (Math.abs(diff) > 0.001) {
      totalXlsxDiff += diff
      mismatches.push({
        key,
        merchant: xlsx.merchant,
        xlsxCount: xlsx.amounts.length,
        dbCount: db.costs.length,
        xlsxSum: xlsxSum.toFixed(4),
        dbSum: dbSum.toFixed(4),
        diff: diff.toFixed(4),
      })
    }
  }

  console.log(`Total groups with mismatches: ${mismatches.length}`)
  console.log(`Total diff: $${totalXlsxDiff.toFixed(2)}`)

  // Show mismatches sorted by diff
  mismatches.sort((a, b) => parseFloat(b.diff) - parseFloat(a.diff))
  console.log('\nMismatches (sorted by diff):')
  for (const m of mismatches.slice(0, 20)) {
    console.log(`  ${m.key} (${m.merchant}): xlsx=${m.xlsxSum}, db=${m.dbSum}, diff=${m.diff}`)
  }
}

main().catch(console.error)
