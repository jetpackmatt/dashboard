#!/usr/bin/env node
/**
 * Find missing invoice IDs in 8633xxx range for JPHS-0037 week
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Finding ALL 8633xxx invoice IDs for Henson...\n')

  // Query for all transactions with invoice_id_sb in the 8633xxx range
  const { data, error } = await supabase
    .from('transactions')
    .select('invoice_id_sb, transaction_fee, reference_type, cost')
    .eq('client_id', hensonId)
    .gte('invoice_id_sb', 8633000)
    .lt('invoice_id_sb', 8634000)

  if (error) {
    console.log('Error:', error)
    return
  }

  // Group by invoice_id_sb
  const byInvoice = {}
  for (const tx of data || []) {
    const inv = tx.invoice_id_sb
    if (!byInvoice[inv]) byInvoice[inv] = { count: 0, feeTypes: {} }
    byInvoice[inv].count++
    byInvoice[inv].feeTypes[tx.transaction_fee] = (byInvoice[inv].feeTypes[tx.transaction_fee] || 0) + 1
  }

  console.log('Invoice IDs found:', Object.keys(byInvoice).length)
  console.log('')

  // List all invoice IDs
  for (const [inv, info] of Object.entries(byInvoice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    const topFees = Object.entries(info.feeTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([f, c]) => `${f}:${c}`)
      .join(', ')
    console.log(`  Invoice ${inv}: ${info.count} transactions (${topFees})`)
  }

  // List our current array
  const currentIds = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
  const foundIds = Object.keys(byInvoice).map(Number).sort((a, b) => b - a)

  // Find missing invoice IDs
  const missing = foundIds.filter(id => !currentIds.includes(id))
  if (missing.length > 0) {
    console.log('\n*** MISSING INVOICE IDS ***')
    for (const inv of missing) {
      console.log(`  ${inv}`)
    }
  }

  // Sum totals
  const total = Object.values(byInvoice).reduce((sum, v) => sum + v.count, 0)
  console.log('\nTotal transactions in 8633xxx range:', total)

  // Category breakdown
  console.log('\n=== BREAKDOWN BY CATEGORY ===')
  let shipments = 0
  let addServices = 0
  let returns = 0
  let receiving = 0
  let storage = 0
  let credits = 0

  for (const tx of data || []) {
    const fee = tx.transaction_fee
    const refType = tx.reference_type

    if (fee === 'Shipping') {
      shipments++
    } else if (['Per Pick Fee', 'Address Correction', 'Kitting Fee', 'Inventory Placement Program Fee',
                'URO Storage Fee', 'VAS - Paid Requests'].includes(fee) || fee?.startsWith('B2B')) {
      addServices++
    } else if (['Return Processed by Operations Fee', 'Return to sender - Processing Fees', 'Return Label'].includes(fee) || refType === 'Return') {
      returns++
    } else if (fee === 'Charge' || refType === 'WRO') {
      receiving++
    } else if (refType === 'FC' || fee === 'Warehousing Fee' || fee?.includes('Storage')) {
      storage++
    } else if (fee === 'Credit' || refType === 'Default') {
      credits++
    } else {
      addServices++ // uncategorized goes to additional services
    }
  }

  console.log(`  Shipments: ${shipments} (ref: 1436)`)
  console.log(`  Additional Services: ${addServices} (ref: 1113)`)
  console.log(`  Returns: ${returns} (ref: 4)`)
  console.log(`  Receiving: ${receiving} (ref: 1)`)
  console.log(`  Storage: ${storage} (ref: 982)`)
  console.log(`  Credits: ${credits} (ref: 12)`)
  console.log(`\n  TOTAL: ${shipments + addServices + returns + receiving + storage + credits} (ref: 3548)`)
}

main().catch(console.error)
