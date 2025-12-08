/**
 * Backfill shipping breakdown from local CSV file
 *
 * Usage: node scripts/backfill-breakdown-from-csv.js [csv_path]
 * Default: reference/data/extras-backfill.csv
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const { parse } = require('csv-parse/sync')
const fs = require('fs')
const path = require('path')

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
  const csvPath = process.argv[2] || 'reference/data/extras-backfill.csv'
  const fullPath = path.resolve(csvPath)

  console.log('='.repeat(70))
  console.log('BACKFILL SHIPPING BREAKDOWN FROM CSV')
  console.log('='.repeat(70))
  console.log(`\nReading: ${fullPath}`)

  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`)
    process.exit(1)
  }

  const csvContent = fs.readFileSync(fullPath, 'utf-8')

  // Parse CSV
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  })

  console.log('Parsed', records.length, 'rows')

  // Map to our format
  const rows = records.map(row => ({
    shipment_id: String(row['OrderID'] || ''),
    user_id: String(row['User ID'] || ''),
    merchant_name: String(row['Merchant Name'] || ''),
    invoice_id_sb: String(row['Invoice Number'] || ''),
    base_cost: parseCurrency(row['Fulfillment without Surcharge']),
    surcharge: parseCurrency(row['Surcharge Applied']),
    insurance_cost: parseCurrency(row['Insurance Amount']),
    total: parseCurrency(row['Original Invoice'])
  }))

  // Stats by merchant
  const byMerchant = {}
  for (const row of rows) {
    if (!byMerchant[row.merchant_name]) {
      byMerchant[row.merchant_name] = { count: 0, total_base: 0, total_surcharge: 0, total_insurance: 0 }
    }
    byMerchant[row.merchant_name].count++
    byMerchant[row.merchant_name].total_base += row.base_cost
    byMerchant[row.merchant_name].total_surcharge += row.surcharge
    byMerchant[row.merchant_name].total_insurance += row.insurance_cost
  }

  console.log('\nBreakdown by merchant:')
  for (const [name, stats] of Object.entries(byMerchant)) {
    console.log(`  ${name}: ${stats.count} shipments, $${stats.total_base.toFixed(2)} base, $${stats.total_surcharge.toFixed(2)} surcharges, $${stats.total_insurance.toFixed(2)} insurance`)
  }

  // Update transactions in batches for better performance
  console.log('\nUpdating transactions...')
  let updated = 0
  let notFound = 0
  let alreadySet = 0
  let errors = []

  // Process in batches of 100 for upsert efficiency
  const BATCH_SIZE = 100

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const shipmentIds = batch.map(r => r.shipment_id)

    // Find all matching transactions in batch
    const { data: txs, error: findError } = await supabase
      .from('transactions')
      .select('id, reference_id, base_cost')
      .eq('reference_type', 'Shipment')
      .eq('transaction_fee', 'Shipping')
      .in('reference_id', shipmentIds)

    if (findError) {
      errors.push(`Batch find error at ${i}: ${findError.message}`)
      continue
    }

    // Build a map for quick lookup
    const txMap = new Map()
    for (const tx of txs || []) {
      txMap.set(String(tx.reference_id), tx)
    }

    // Update each row in this batch
    for (const row of batch) {
      const tx = txMap.get(row.shipment_id)

      if (!tx) {
        notFound++
        continue
      }

      // Skip if already has base_cost set
      if (tx.base_cost !== null) {
        alreadySet++
        continue
      }

      // Update with breakdown
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          base_cost: row.base_cost,
          surcharge: row.surcharge,
          insurance_cost: row.insurance_cost
        })
        .eq('id', tx.id)

      if (updateError) {
        errors.push(`Update error for ${row.shipment_id}: ${updateError.message}`)
        continue
      }

      updated++
    }

    // Progress update
    const progress = Math.min(i + BATCH_SIZE, rows.length)
    process.stdout.write(`\r  Processed ${progress}/${rows.length} (${updated} updated, ${alreadySet} skipped)...`)
  }

  console.log('\n\n' + '='.repeat(70))
  console.log('RESULTS')
  console.log('='.repeat(70))
  console.log('Total rows in CSV:', rows.length)
  console.log('Updated:', updated)
  console.log('Already set (skipped):', alreadySet)
  console.log('Not found in transactions:', notFound)
  console.log('Errors:', errors.length)

  if (errors.length > 0) {
    console.log('\nFirst 10 errors:')
    errors.slice(0, 10).forEach(e => console.log('  ' + e))
  }

  // Verify some samples
  console.log('\nSample updated transactions:')
  const { data: samples } = await supabase
    .from('transactions')
    .select('reference_id, cost, base_cost, surcharge, insurance_cost')
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .not('base_cost', 'is', null)
    .order('reference_id', { ascending: false })
    .limit(10)

  if (samples) {
    console.log('  Shipment ID       | Cost     | Base     | Surcharge | Insurance')
    console.log('  ' + '-'.repeat(60))
    samples.forEach(s => {
      console.log(`  ${String(s.reference_id).padEnd(17)} | $${(s.cost || 0).toFixed(2).padStart(6)} | $${(s.base_cost || 0).toFixed(2).padStart(6)} | $${(s.surcharge || 0).toFixed(2).padStart(8)} | $${(s.insurance_cost || 0).toFixed(2).padStart(8)}`)
    })
  }

  // Check how many transactions still have NULL base_cost
  const { count: nullCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .is('base_cost', null)

  console.log(`\nRemaining transactions with NULL base_cost: ${nullCount}`)
}

main().catch(console.error)
