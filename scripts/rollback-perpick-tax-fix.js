#!/usr/bin/env node
/**
 * Rollback the tax subtraction for Per Pick Fee transactions
 * The tax was wrongly subtracted - those costs were already pre-tax
 * Keep the receiving fee fix ($39.55 → $35.00) - that one was correct
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function rollback() {
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Find Per Pick Fee transactions with taxes that were wrongly adjusted
  const { data: txToFix, error } = await supabase
    .from('transactions')
    .select('transaction_id, cost, taxes')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)
    .not('taxes', 'is', null)

  const txWithTaxes = (txToFix || []).filter(t =>
    t.taxes && Array.isArray(t.taxes) && t.taxes.length > 0
  )

  console.log('Per Pick Fee transactions with taxes:', txWithTaxes.length)

  if (txWithTaxes.length === 0) {
    console.log('Nothing to rollback')
    return
  }

  let fixed = 0
  let totalAdded = 0

  for (const tx of txWithTaxes) {
    const currentCost = parseFloat(tx.cost)
    const totalTax = tx.taxes.reduce((sum, t) => sum + (t.tax_amount || 0), 0)
    const correctedCost = currentCost + totalTax

    console.log(`  ${tx.transaction_id}: $${currentCost.toFixed(2)} -> $${correctedCost.toFixed(2)} (+$${totalTax.toFixed(2)})`)

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ cost: correctedCost })
      .eq('transaction_id', tx.transaction_id)

    if (updateError) {
      console.error(`  ERROR:`, updateError.message)
    } else {
      fixed++
      totalAdded += totalTax
    }
  }

  console.log('\n=== ROLLBACK SUMMARY ===')
  console.log('Rolled back:', fixed, 'transactions')
  console.log('Total tax added back:', '$' + totalAdded.toFixed(2))

  // Verify new total
  const { data: verify } = await supabase
    .from('transactions')
    .select('cost')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  const newTotal = (verify || []).reduce((s, t) => s + parseFloat(t.cost), 0)
  console.log('\nNew Per Pick Fee total:', '$' + newTotal.toFixed(2))
  console.log('Expected:', '$394.56')
  console.log('Difference:', '$' + (newTotal - 394.56).toFixed(2))
}

rollback().catch(console.error)
