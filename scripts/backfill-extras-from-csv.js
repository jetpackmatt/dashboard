#!/usr/bin/env node
/**
 * Backfill base_cost, surcharge, insurance_cost from local CSV
 * Uses reference/data/extras-backfill.csv
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const { parse } = require('csv-parse/sync')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function parseCurrency(value) {
  if (!value) return 0
  const cleaned = value.replace(/[$,]/g, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

async function main() {
  const csvPath = './reference/data/extras-backfill.csv'

  console.log('Reading CSV:', csvPath)
  const csvContent = fs.readFileSync(csvPath, 'utf-8')

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  })

  console.log('Parsed', records.length, 'rows')

  // Build lookup by OrderID (shipment_id)
  const lookup = {}
  for (const row of records) {
    const shipmentId = String(row['OrderID'] || '')
    if (shipmentId) {
      lookup[shipmentId] = {
        base_cost: parseCurrency(row['Fulfillment without Surcharge']),
        surcharge: parseCurrency(row['Surcharge Applied']),
        insurance_cost: parseCurrency(row['Insurance Amount'])
      }
    }
  }

  console.log('Built lookup with', Object.keys(lookup).length, 'shipments')

  // Batch through all missing transactions
  // Note: Supabase caps at 1000 per query, so we keep fetching until no more
  console.log('\nProcessing transactions missing base_cost...')
  let updated = 0
  let notInCsv = 0
  let errors = 0
  let batchNum = 0

  while (true) {
    batchNum++
    // Always fetch first 1000 null records (they change as we update)
    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, reference_id')
      .eq('reference_type', 'Shipment')
      .is('base_cost', null)
      .limit(1000)

    if (error) {
      console.error('Error fetching transactions:', error.message)
      break
    }

    if (!txs || txs.length === 0) {
      console.log('  No more transactions to process')
      break
    }

    console.log(`  Batch ${batchNum}: ${txs.length} transactions...`)

    let batchUpdated = 0
    for (const tx of txs) {
      const extras = lookup[tx.reference_id]
      if (!extras) {
        notInCsv++
        continue
      }

      const { error: updateErr } = await supabase
        .from('transactions')
        .update({
          base_cost: extras.base_cost,
          surcharge: extras.surcharge,
          insurance_cost: extras.insurance_cost
        })
        .eq('id', tx.id)

      if (updateErr) {
        errors++
      } else {
        updated++
        batchUpdated++
      }
    }

    console.log(`    Updated ${batchUpdated} this batch. Total: ${updated}`)

    // If nothing was updated this batch, all remaining are not in CSV
    if (batchUpdated === 0) {
      console.log('  No matches found in CSV for remaining transactions')
      break
    }
  }

  console.log('\n=== Results ===')
  console.log('Updated:', updated)
  console.log('Not in CSV:', notInCsv)
  console.log('Errors:', errors)

  // Check new percentage
  const { data: stats } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .not('base_cost', 'is', null)

  console.log('\nNow have base_cost:', stats)
}

main().catch(console.error)
