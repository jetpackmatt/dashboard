#!/usr/bin/env node
/**
 * Fix storage transaction costs to match xlsx values
 * Matches by Inventory ID + Location Type, then updates costs
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
  const filePath = 'reference/storage-backfills/storage-122225.xlsx'

  console.log(`Reading ${filePath}...`)
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'}`)

  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)
  const dataRows = rows.filter(r => r['Inventory ID'] && !isNaN(r['ChargeStartdate']))

  console.log(`xlsx data rows: ${dataRows.length}`)

  // Group xlsx rows by Inventory ID + Location Type
  // Each group represents daily charges for one inventory item
  const xlsxGroups = new Map()
  for (const row of dataRows) {
    const invId = String(row['Inventory ID'])
    const locType = row['Location Type']
    const key = `${invId}-${locType}`

    if (!xlsxGroups.has(key)) {
      xlsxGroups.set(key, [])
    }
    xlsxGroups.get(key).push({
      amount: parseFloat(row['Invoice']) || 0,
      merchant: row['Merchant Name'],
    })
  }

  console.log(`xlsx unique Inventory+Location groups: ${xlsxGroups.size}`)

  // Get DB transactions for invoice 8730389
  const { data: dbTx, error } = await supabase
    .from('transactions')
    .select('id, transaction_id, reference_id, cost')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  if (error) {
    console.error('DB error:', error)
    return
  }

  console.log(`DB transactions: ${dbTx.length}`)

  // Group DB transactions by Inventory ID + Location Type (extracted from reference_id)
  // reference_id format: FC_ID-InventoryId-LocationType
  const dbGroups = new Map()
  for (const tx of dbTx) {
    const parts = tx.reference_id?.split('-') || []
    if (parts.length >= 3) {
      const invId = parts[1]
      const locType = parts.slice(2).join('-') // Handle multi-part location types like "Shelf"
      const key = `${invId}-${locType}`

      if (!dbGroups.has(key)) {
        dbGroups.set(key, [])
      }
      dbGroups.get(key).push(tx)
    }
  }

  console.log(`DB unique Inventory+Location groups: ${dbGroups.size}`)

  // Compare and build updates
  const updates = []
  let matchedGroups = 0
  let mismatchedCounts = 0

  for (const [key, xlsxAmounts] of xlsxGroups) {
    const dbTransactions = dbGroups.get(key)

    if (!dbTransactions) {
      console.log(`  WARNING: No DB transactions for ${key}`)
      continue
    }

    if (xlsxAmounts.length !== dbTransactions.length) {
      console.log(`  WARNING: Count mismatch for ${key}: xlsx=${xlsxAmounts.length}, DB=${dbTransactions.length}`)
      mismatchedCounts++
      // Still try to update what we can
    }

    matchedGroups++

    // Sort both by amount to match them up
    xlsxAmounts.sort((a, b) => a.amount - b.amount)
    dbTransactions.sort((a, b) => parseFloat(a.cost) - parseFloat(b.cost))

    // Match and create updates
    const count = Math.min(xlsxAmounts.length, dbTransactions.length)
    for (let i = 0; i < count; i++) {
      const xlsxAmount = xlsxAmounts[i].amount
      const dbTx = dbTransactions[i]
      const dbCost = parseFloat(dbTx.cost)

      if (Math.abs(xlsxAmount - dbCost) > 0.001) {
        updates.push({
          id: dbTx.id,
          transaction_id: dbTx.transaction_id,
          old_cost: dbCost,
          new_cost: xlsxAmount,
          diff: xlsxAmount - dbCost,
        })
      }
    }
  }

  console.log(`\nMatched groups: ${matchedGroups}`)
  console.log(`Groups with count mismatch: ${mismatchedCounts}`)
  console.log(`Transactions to update: ${updates.length}`)

  // Show summary of changes
  const totalOld = updates.reduce((s, u) => s + u.old_cost, 0)
  const totalNew = updates.reduce((s, u) => s + u.new_cost, 0)
  console.log(`\nCost change: $${totalOld.toFixed(2)} → $${totalNew.toFixed(2)} (diff: $${(totalNew - totalOld).toFixed(2)})`)

  // Show sample updates
  console.log('\nSample updates:')
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.transaction_id}: $${u.old_cost.toFixed(4)} → $${u.new_cost.toFixed(4)} (${u.diff >= 0 ? '+' : ''}${u.diff.toFixed(4)})`)
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made.')
    return
  }

  // Perform updates in batches
  console.log(`\nUpdating ${updates.length} transactions...`)
  const BATCH_SIZE = 100
  let updated = 0
  let errors = 0

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE)

    for (const u of batch) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({ cost: u.new_cost })
        .eq('id', u.id)

      if (updateError) {
        console.error(`  Error updating ${u.transaction_id}:`, updateError.message)
        errors++
      } else {
        updated++
      }
    }

    console.log(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${updated} updated, ${errors} errors`)
  }

  console.log(`\nDone! Updated ${updated} transactions, ${errors} errors`)

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

  console.log('\nFinal totals by client:')
  for (const [cid, total] of Object.entries(byClient)) {
    console.log(`  ${cid}: $${total.toFixed(2)}`)
  }
}

main().catch(console.error)
