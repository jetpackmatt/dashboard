#!/usr/bin/env node
/**
 * Fix transactions that have taxes embedded in the cost
 * The sync was storing post-tax amounts in 'cost', but it should be pre-tax
 * Taxes are stored separately in the 'taxes' JSONB column
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fix() {
  // Find all transactions with taxes
  const { data: txWithTaxes, error } = await supabase
    .from('transactions')
    .select('transaction_id, cost, taxes')
    .not('taxes', 'is', null)
    .gt('jsonb_array_length(taxes)', 0)

  if (error) {
    // Try alternate approach if jsonb_array_length doesn't work in filter
    console.log('Using alternate query approach...')
    const { data: allTx, error: err2 } = await supabase
      .from('transactions')
      .select('transaction_id, cost, taxes')
      .not('taxes', 'is', null)

    if (err2) {
      console.error('Error fetching transactions:', err2)
      return
    }

    // Filter to those with non-empty taxes array
    const txWithTaxes = (allTx || []).filter(t =>
      t.taxes && Array.isArray(t.taxes) && t.taxes.length > 0
    )

    if (txWithTaxes.length === 0) {
      console.log('No transactions with taxes found')
      return
    }

    console.log('Transactions with taxes:', txWithTaxes.length)

    let fixed = 0
    let totalTaxSubtracted = 0

    for (const tx of txWithTaxes) {
      const currentCost = parseFloat(tx.cost)
      const totalTax = tx.taxes.reduce((sum, t) => sum + (t.tax_amount || 0), 0)
      const preTaxCost = currentCost - totalTax

      // Only fix if there's actually tax to subtract
      if (totalTax > 0) {
        console.log(`  ${tx.transaction_id}: $${currentCost.toFixed(2)} -> $${preTaxCost.toFixed(2)} (tax: $${totalTax.toFixed(2)})`)

        const { error: updateError } = await supabase
          .from('transactions')
          .update({ cost: preTaxCost })
          .eq('transaction_id', tx.transaction_id)

        if (updateError) {
          console.error(`  ERROR updating ${tx.transaction_id}:`, updateError.message)
        } else {
          fixed++
          totalTaxSubtracted += totalTax
        }
      }
    }

    console.log('\n=== SUMMARY ===')
    console.log('Fixed:', fixed, 'transactions')
    console.log('Total tax subtracted from costs:', '$' + totalTaxSubtracted.toFixed(2))
    return
  }

  // Original path if filter worked
  const filteredTx = (txWithTaxes || []).filter(t =>
    t.taxes && Array.isArray(t.taxes) && t.taxes.length > 0
  )

  if (filteredTx.length === 0) {
    console.log('No transactions with taxes found')
    return
  }

  console.log('Transactions with taxes:', filteredTx.length)

  let fixed = 0
  let totalTaxSubtracted = 0

  for (const tx of filteredTx) {
    const currentCost = parseFloat(tx.cost)
    const totalTax = tx.taxes.reduce((sum, t) => sum + (t.tax_amount || 0), 0)
    const preTaxCost = currentCost - totalTax

    if (totalTax > 0) {
      console.log(`  ${tx.transaction_id}: $${currentCost.toFixed(2)} -> $${preTaxCost.toFixed(2)} (tax: $${totalTax.toFixed(2)})`)

      const { error: updateError } = await supabase
        .from('transactions')
        .update({ cost: preTaxCost })
        .eq('transaction_id', tx.transaction_id)

      if (updateError) {
        console.error(`  ERROR updating ${tx.transaction_id}:`, updateError.message)
      } else {
        fixed++
        totalTaxSubtracted += totalTax
      }
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log('Fixed:', fixed, 'transactions')
  console.log('Total tax subtracted from costs:', '$' + totalTaxSubtracted.toFixed(2))
}

fix().catch(console.error)
