#!/usr/bin/env node
/**
 * Check which invoice_ids transactions are linked to
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonClientId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Checking transaction → invoice linkages for Henson...\n')

  // Get transactions grouped by invoice_id_sb
  const { data: stats, error } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .not('invoice_id_sb', 'is', null)

  if (error) {
    console.error('Error:', error)
    return
  }

  // Count by invoice_id_sb
  const counts = {}
  for (const tx of stats) {
    counts[tx.invoice_id_sb] = (counts[tx.invoice_id_sb] || 0) + 1
  }

  console.log('Transactions by invoice_id_sb (top 10):')
  const sorted = Object.entries(counts).sort((a, b) => parseInt(b[0]) - parseInt(a[0]))
  for (const [invId, count] of sorted.slice(0, 10)) {
    console.log(`  Invoice ${invId}: ${count} shipping transactions`)
  }

  // Check Dec 8-14 invoices specifically
  console.log('\n--- Dec 8-14 invoices (8693044-8693056) ---')
  const dec8InvIds = [8693044, 8693047, 8693051, 8693054, 8693056]
  for (const invId of dec8InvIds) {
    const count = counts[invId] || 0
    console.log(`  Invoice ${invId}: ${count} shipping transactions`)
  }

  // Check Dec 1-7 invoices
  console.log('\n--- Dec 1-7 invoices (8661966-8661969) ---')
  const dec1InvIds = [8661966, 8661967, 8661968, 8661969]
  for (const invId of dec1InvIds) {
    const count = counts[invId] || 0
    console.log(`  Invoice ${invId}: ${count} shipping transactions`)
  }

  // Check for transactions with transaction_date in Dec 8-14 that have NO invoice_id_sb
  console.log('\n--- Unlinked transactions in Dec 8-14 date range ---')
  const { data: unlinked, count: unlinkedCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .is('invoice_id_sb', null)
    .gte('transaction_date', '2025-12-08')
    .lte('transaction_date', '2025-12-14')

  console.log(`  Unlinked shipping transactions in Dec 8-14: ${unlinkedCount || 0}`)

  // Alternative: Check by invoiced_status_sb
  const { count: invoicedCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .eq('invoiced_status_sb', true)
    .gte('transaction_date', '2025-12-08')
    .lte('transaction_date', '2025-12-14')

  console.log(`  Invoiced shipping transactions in Dec 8-14: ${invoicedCount || 0}`)
}

main().catch(console.error)
