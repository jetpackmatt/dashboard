#!/usr/bin/env node
/**
 * Fix unlinked shipping transactions for Henson (Dec 15-21)
 * These 220 transactions should be linked to invoice 8730385
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const invoiceId = 8730385 // Shipping invoice for Dec 15-21

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE UPDATE'}`)
  console.log('')

  // Get the unlinked shipping transactions
  const { data: unlinkedTx, count: unlinkedCount } = await supabase
    .from('transactions')
    .select('id, transaction_id, reference_id, cost', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('Unlinked shipping transactions:', unlinkedCount)

  const totalCost = (unlinkedTx || []).reduce((s, t) => s + parseFloat(t.cost), 0)
  console.log('Total cost:', totalCost.toFixed(2))

  if (dryRun) {
    console.log('\n[DRY RUN] Would update', unlinkedCount, 'transactions')
    console.log('Sample IDs:', (unlinkedTx || []).slice(0, 5).map(t => t.transaction_id))
    return
  }

  // Update the transactions
  const txIds = (unlinkedTx || []).map(t => t.transaction_id)

  console.log('\nLinking', txIds.length, 'transactions to invoice', invoiceId)

  const { data: updated, error } = await supabase
    .from('transactions')
    .update({
      invoice_id_sb: invoiceId,
      invoice_date_sb: '2025-12-22',
      invoiced_status_sb: true,
      updated_at: new Date().toISOString()
    })
    .in('transaction_id', txIds)
    .select('id')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Updated:', updated?.length || 0, 'transactions')

  // Verify
  const { count: newLinkedCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', invoiceId)
    .is('dispute_status', null)

  console.log('\nNew total linked to invoice 8730385:', newLinkedCount)
  console.log('Expected:', 2327)
  console.log('Match:', newLinkedCount === 2327 ? 'YES ✓' : 'NO ✗')
}

main().catch(console.error)
