/**
 * Fetch shipping breakdown from SFTP and update transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const Client = require('ssh2-sftp-client')
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
  console.log('='.repeat(70))
  console.log('FETCH SFTP BREAKDOWN & UPDATE TRANSACTIONS')
  console.log('='.repeat(70))

  // Step 1: Fetch file from SFTP
  const sftp = new Client()
  await sftp.connect({
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD
  })

  console.log('\nDownloading /extras-120125.csv...')
  const buffer = await sftp.get('/extras-120125.csv')
  await sftp.end()

  const csvContent = buffer.toString('utf-8')

  // Step 2: Parse CSV
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

  // Step 3: Update transactions
  console.log('\nUpdating transactions...')
  let updated = 0
  let notFound = 0
  let errors = []

  for (const row of rows) {
    // Find matching transaction
    const { data: tx, error: findError } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference_type', 'Shipment')
      .eq('reference_id', row.shipment_id)
      .eq('transaction_fee', 'Shipping')
      .maybeSingle()

    if (findError) {
      errors.push(`Find error for ${row.shipment_id}: ${findError.message}`)
      continue
    }

    if (!tx) {
      notFound++
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
    if (updated % 100 === 0) process.stdout.write(`\r  Updated ${updated}...`)
  }

  console.log('\n\n' + '='.repeat(70))
  console.log('RESULTS')
  console.log('='.repeat(70))
  console.log('Total rows in CSV:', rows.length)
  console.log('Updated:', updated)
  console.log('Not found:', notFound)
  console.log('Errors:', errors.length)

  if (errors.length > 0) {
    console.log('\nFirst 5 errors:')
    errors.slice(0, 5).forEach(e => console.log('  ' + e))
  }

  // Verify some samples
  console.log('\nSample updated transactions:')
  const { data: samples } = await supabase
    .from('transactions')
    .select('reference_id, amount, base_cost, surcharge, insurance_cost')
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .not('base_cost', 'is', null)
    .limit(5)

  if (samples) {
    samples.forEach(s => {
      console.log(`  Shipment ${s.reference_id}: $${s.amount?.toFixed(2) || '?'} total → base $${s.base_cost?.toFixed(2) || 0} + surcharge $${s.surcharge?.toFixed(2) || 0}`)
    })
  }
}

main().catch(console.error)
