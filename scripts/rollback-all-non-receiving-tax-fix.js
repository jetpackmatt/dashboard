#!/usr/bin/env node
/**
 * Rollback the tax subtraction for ALL non-receiving transactions
 * Keep the WRO Receiving Fee fix ($39.55 → $35.00) - that was correct
 * Rollback everything else - the API costs were already pre-tax
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function rollback() {
  // Find ALL transactions with taxes that are NOT receiving fees
  const { data: allTx } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, reference_type, cost, taxes')
    .not('taxes', 'is', null)

  const txToFix = (allTx || []).filter(t =>
    t.taxes &&
    Array.isArray(t.taxes) &&
    t.taxes.length > 0 &&
    t.fee_type !== 'WRO Receiving Fee'  // Keep the receiving fee fix
  )

  console.log('Transactions to rollback (excluding WRO Receiving Fee):', txToFix.length)

  if (txToFix.length === 0) {
    console.log('Nothing to rollback')
    return
  }

  // Group by fee_type for summary
  const byType = {}
  for (const tx of txToFix) {
    if (!byType[tx.fee_type]) byType[tx.fee_type] = []
    byType[tx.fee_type].push(tx)
  }

  console.log('\nBy fee type:')
  for (const [type, txs] of Object.entries(byType)) {
    console.log(`  ${type}: ${txs.length} transactions`)
  }

  let fixed = 0
  let totalAdded = 0

  for (const tx of txToFix) {
    const currentCost = parseFloat(tx.cost)
    const totalTax = tx.taxes.reduce((sum, t) => sum + (t.tax_amount || 0), 0)
    const correctedCost = currentCost + totalTax

    const { error } = await supabase
      .from('transactions')
      .update({ cost: correctedCost })
      .eq('transaction_id', tx.transaction_id)

    if (error) {
      console.error(`  ERROR ${tx.transaction_id}:`, error.message)
    } else {
      fixed++
      totalAdded += totalTax
    }
  }

  console.log('\n=== ROLLBACK SUMMARY ===')
  console.log('Rolled back:', fixed, 'transactions')
  console.log('Total tax added back:', '$' + totalAdded.toFixed(2))
}

rollback().catch(console.error)
