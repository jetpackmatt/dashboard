#!/usr/bin/env node
/**
 * Backfill taxes_charge for transactions that have taxes but no taxes_charge
 *
 * The taxes field contains raw tax amounts from ShipBob API.
 * The taxes_charge field should contain marked-up tax amounts calculated as:
 *   tax_amount = billed_amount * (tax_rate / 100)
 *
 * This script:
 * 1. Finds all transactions with taxes but no taxes_charge
 * 2. Calculates taxes_charge using billed_amount * tax_rate
 * 3. Updates the transactions
 *
 * Usage:
 *   node scripts/backfill-taxes-charge.js --dry-run          # Preview changes
 *   node scripts/backfill-taxes-charge.js                    # Apply changes
 *   node scripts/backfill-taxes-charge.js --client-id UUID   # Specific client
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Parse command line args
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const clientIndex = args.indexOf('--client-id')
const clientIdFilter = clientIndex !== -1 ? args[clientIndex + 1] : null

console.log('='.repeat(60))
console.log('Backfill taxes_charge Script')
console.log('='.repeat(60))
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`)
if (clientIdFilter) console.log(`Client Filter: ${clientIdFilter}`)
console.log('')

async function main() {
  // Find all transactions that have taxes but no taxes_charge, and have billed_amount
  console.log('Finding transactions that need taxes_charge backfill...')

  const BATCH_SIZE = 500
  let lastId = null
  let totalProcessed = 0
  let totalUpdated = 0
  let totalSkipped = 0
  let totalErrors = 0

  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, taxes, billed_amount, client_id, fee_type, charge_date')
      .not('taxes', 'is', null)
      .not('billed_amount', 'is', null)
      .or('taxes_charge.is.null')
      .order('id', { ascending: true })
      .limit(BATCH_SIZE)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    if (clientIdFilter) {
      query = query.eq('client_id', clientIdFilter)
    }

    const { data: transactions, error } = await query

    if (error) {
      console.error('Error fetching transactions:', error.message)
      break
    }

    if (!transactions || transactions.length === 0) {
      break
    }

    // Filter to only those with actual taxes array content
    const needsBackfill = transactions.filter(tx => {
      if (!tx.taxes || !Array.isArray(tx.taxes) || tx.taxes.length === 0) {
        return false
      }
      return true
    })

    console.log(`\nBatch: ${transactions.length} fetched, ${needsBackfill.length} need backfill`)

    for (const tx of needsBackfill) {
      totalProcessed++

      const billedAmount = parseFloat(tx.billed_amount) || 0

      if (billedAmount === 0) {
        totalSkipped++
        if (dryRun) {
          console.log(`  [SKIP] ${tx.id} - billed_amount is 0`)
        }
        continue
      }

      // Calculate taxes_charge
      const taxesCharge = tx.taxes.map(taxEntry => ({
        tax_type: taxEntry.tax_type,
        tax_rate: taxEntry.tax_rate,
        tax_amount: Math.round(billedAmount * ((taxEntry.tax_rate || 0) / 100) * 100) / 100,
      }))

      if (dryRun) {
        const originalTotal = tx.taxes.reduce((sum, t) => sum + (t.tax_amount || 0), 0)
        const newTotal = taxesCharge.reduce((sum, t) => sum + (t.tax_amount || 0), 0)
        console.log(`  [DRY RUN] ${tx.id}`)
        console.log(`    fee_type: ${tx.fee_type}, charge_date: ${tx.charge_date}`)
        console.log(`    billed_amount: $${billedAmount.toFixed(2)}`)
        console.log(`    taxes (raw): ${JSON.stringify(tx.taxes)} = $${originalTotal.toFixed(2)}`)
        console.log(`    taxes_charge (calculated): ${JSON.stringify(taxesCharge)} = $${newTotal.toFixed(2)}`)
        totalUpdated++
      } else {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({
            taxes_charge: taxesCharge,
            updated_at: new Date().toISOString()
          })
          .eq('id', tx.id)

        if (updateError) {
          console.error(`  [ERROR] ${tx.id}: ${updateError.message}`)
          totalErrors++
        } else {
          totalUpdated++
        }
      }
    }

    lastId = transactions[transactions.length - 1].id

    if (transactions.length < BATCH_SIZE) {
      break
    }
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))
  console.log(`Total processed: ${totalProcessed}`)
  console.log(`Total ${dryRun ? 'would update' : 'updated'}: ${totalUpdated}`)
  console.log(`Total skipped (no billed_amount): ${totalSkipped}`)
  console.log(`Total errors: ${totalErrors}`)

  if (dryRun) {
    console.log('')
    console.log('This was a dry run. Run without --dry-run to apply changes.')
  }
}

main().catch(console.error)
