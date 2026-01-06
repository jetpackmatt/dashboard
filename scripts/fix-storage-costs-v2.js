#!/usr/bin/env node
/**
 * Fix storage costs v2 - direct replacement without sorting
 * For each group (InventoryID + LocationType), replace DB costs with xlsx costs in order
 */

require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'}`)

  const workbook = XLSX.readFile('reference/storage-backfills/storage-122225.xlsx')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)
  const dataRows = rows.filter(r => r['Inventory ID'] && !isNaN(r['ChargeStartdate']))

  console.log(`xlsx rows: ${dataRows.length}`)

  // Group xlsx by Inventory ID + Location Type
  const xlsxGroups = new Map()
  for (const row of dataRows) {
    const invId = String(row['Inventory ID'])
    const locType = row['Location Type']
    const key = `${invId}-${locType}`
    const amount = parseFloat(row['Invoice']) || 0

    if (!xlsxGroups.has(key)) {
      xlsxGroups.set(key, [])
    }
    xlsxGroups.get(key).push(amount)
  }

  console.log(`xlsx groups: ${xlsxGroups.size}`)

  // Get DB transactions
  const { data: dbTx } = await supabase
    .from('transactions')
    .select('id, reference_id, cost')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)
    .order('id', { ascending: true })

  console.log(`DB transactions: ${dbTx.length}`)

  // Group DB by Inventory ID + Location Type (preserve order by id)
  const dbGroups = new Map()
  for (const tx of dbTx) {
    const parts = tx.reference_id?.split('-') || []
    if (parts.length >= 3) {
      const invId = parts[1]
      const locType = parts.slice(2).join('-')
      const key = `${invId}-${locType}`

      if (!dbGroups.has(key)) {
        dbGroups.set(key, [])
      }
      dbGroups.get(key).push(tx)
    }
  }

  console.log(`DB groups: ${dbGroups.size}`)

  // Build updates - for each group, replace costs in order
  const updates = []

  for (const [key, xlsxAmounts] of xlsxGroups) {
    const dbTransactions = dbGroups.get(key)
    if (!dbTransactions) continue

    if (xlsxAmounts.length !== dbTransactions.length) {
      console.log(`WARNING: ${key} count mismatch: xlsx=${xlsxAmounts.length}, db=${dbTransactions.length}`)
      continue
    }

    // Replace costs 1:1 (no sorting)
    for (let i = 0; i < xlsxAmounts.length; i++) {
      const newCost = xlsxAmounts[i]
      const tx = dbTransactions[i]
      const oldCost = parseFloat(tx.cost)

      if (Math.abs(newCost - oldCost) > 0.0001) {
        updates.push({
          id: tx.id,
          old_cost: oldCost,
          new_cost: newCost,
        })
      }
    }
  }

  console.log(`\nTransactions to update: ${updates.length}`)

  // Calculate totals
  const totalOld = updates.reduce((s, u) => s + u.old_cost, 0)
  const totalNew = updates.reduce((s, u) => s + u.new_cost, 0)
  console.log(`Cost change: $${totalOld.toFixed(4)} → $${totalNew.toFixed(4)} (diff: $${(totalNew - totalOld).toFixed(4)})`)

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made.')
    return
  }

  // Apply updates
  console.log(`\nUpdating ${updates.length} transactions...`)
  let updated = 0
  let errors = 0

  for (const u of updates) {
    const { error } = await supabase
      .from('transactions')
      .update({ cost: u.new_cost })
      .eq('id', u.id)

    if (error) {
      errors++
    } else {
      updated++
    }
  }

  console.log(`Done! Updated ${updated}, errors ${errors}`)

  // Verify final totals
  const { data: finalTx } = await supabase
    .from('transactions')
    .select('client_id, cost')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  const byClient = {}
  for (const tx of finalTx || []) {
    const cid = tx.client_id || 'NULL'
    byClient[cid] = (byClient[cid] || 0) + parseFloat(tx.cost)
  }

  console.log('\nFinal totals:')
  for (const [cid, total] of Object.entries(byClient)) {
    console.log('  ', cid, ':', total.toFixed(4))
  }
}

main().catch(console.error)
