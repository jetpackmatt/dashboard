/**
 * Fix JPML-0021: Remove wrong ShipBob invoice IDs that were incorrectly pulled in
 *
 * The regenerate endpoint incorrectly pulled transactions with invoice_id_jp IS NULL,
 * which included old storage transactions from July and October.
 *
 * This script:
 * 1. Unmarks the wrong transactions (8098507, 8498732)
 * 2. Keeps only the correct Dec 1 period transactions (8633*)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const JPML_0021_ID = '1d299af5-576b-473f-aff3-9578728b47ae'
const WRONG_SB_INVOICE_IDS = [8098507, 8498732] // July and October storage

async function main() {
  console.log('='.repeat(60))
  console.log('FIX: JPML-0021 - Remove wrong ShipBob invoice transactions')
  console.log('='.repeat(60))

  // Check current state
  console.log('\nCurrent state:')
  const { data: current } = await supabase
    .from('transactions')
    .select('invoice_id_sb, cost')
    .eq('invoice_id_jp', JPML_0021_ID)

  const byInvoice = {}
  for (const tx of current || []) {
    const key = tx.invoice_id_sb
    if (!byInvoice[key]) byInvoice[key] = { count: 0, cost: 0 }
    byInvoice[key].count++
    byInvoice[key].cost += parseFloat(tx.cost)
  }

  for (const [id, stats] of Object.entries(byInvoice)) {
    const isWrong = WRONG_SB_INVOICE_IDS.includes(parseInt(id))
    console.log(`  SB Invoice ${id}: ${stats.count} tx, $${stats.cost.toFixed(2)} ${isWrong ? '(WRONG - will remove)' : '(CORRECT)'}`)
  }

  // Unmark wrong transactions
  console.log('\nUnmarking wrong transactions...')
  for (const sbInvoiceId of WRONG_SB_INVOICE_IDS) {
    const { data: updated, error } = await supabase
      .from('transactions')
      .update({
        invoice_id_jp: null,
        invoiced_status_jp: null,
        invoice_date_jp: null,
        markup_applied: null,
        markup_rule_id: null,
        markup_percentage: null,
        billed_amount: null,
      })
      .eq('invoice_id_jp', JPML_0021_ID)
      .eq('invoice_id_sb', sbInvoiceId)
      .select('id')

    if (error) {
      console.log(`  Error unmarking SB Invoice ${sbInvoiceId}: ${error.message}`)
    } else {
      console.log(`  Unmarked ${updated?.length || 0} transactions from SB Invoice ${sbInvoiceId}`)
    }
  }

  // Verify final state
  console.log('\nFinal state:')
  const { data: final } = await supabase
    .from('transactions')
    .select('invoice_id_sb, cost')
    .eq('invoice_id_jp', JPML_0021_ID)

  const byInvoiceFinal = {}
  let totalCost = 0
  for (const tx of final || []) {
    const key = tx.invoice_id_sb
    if (!byInvoiceFinal[key]) byInvoiceFinal[key] = { count: 0, cost: 0 }
    byInvoiceFinal[key].count++
    byInvoiceFinal[key].cost += parseFloat(tx.cost)
    totalCost += parseFloat(tx.cost)
  }

  for (const [id, stats] of Object.entries(byInvoiceFinal)) {
    console.log(`  SB Invoice ${id}: ${stats.count} tx, $${stats.cost.toFixed(2)}`)
  }
  console.log(`  TOTAL: ${final?.length || 0} transactions, $${totalCost.toFixed(2)}`)

  console.log('\n' + '='.repeat(60))
  console.log('DONE - Now regenerate JPML-0021 in the admin UI')
  console.log('='.repeat(60))
}

main().catch(console.error)
