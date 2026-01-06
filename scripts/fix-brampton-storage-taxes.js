#!/usr/bin/env node
/**
 * Fix taxes for Brampton (Ontario) storage transactions
 * Set taxes to 13% GST of the current cost
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fix() {
  // Get all Brampton storage transactions
  const { data: tx } = await supabase
    .from('transactions')
    .select('transaction_id, cost, taxes')
    .eq('reference_type', 'FC')
    .eq('fulfillment_center', 'Brampton (Ontario) 2')

  console.log('Brampton storage transactions:', tx?.length)

  let fixed = 0
  for (const t of tx || []) {
    const cost = parseFloat(t.cost)
    const correctTax = Math.round(cost * 0.13 * 100) / 100  // 13% GST, rounded to 2 decimals

    const newTaxes = [{
      tax_type: 'GST',
      tax_rate: 13,
      tax_amount: correctTax
    }]

    const oldTax = t.taxes?.[0]?.tax_amount || 0
    console.log(`  ${t.transaction_id}: cost $${cost.toFixed(2)}, tax $${oldTax.toFixed(4)} -> $${correctTax.toFixed(2)}`)

    const { error } = await supabase
      .from('transactions')
      .update({ taxes: newTaxes })
      .eq('transaction_id', t.transaction_id)

    if (!error) fixed++
  }

  console.log('\nFixed:', fixed, 'transactions')

  // Verify
  const { data: verify } = await supabase
    .from('transactions')
    .select('cost, taxes')
    .eq('reference_type', 'FC')
    .eq('fulfillment_center', 'Brampton (Ontario) 2')

  let totalCost = 0
  let totalTax = 0
  for (const t of verify || []) {
    totalCost += parseFloat(t.cost)
    totalTax += t.taxes?.[0]?.tax_amount || 0
  }
  console.log('Total cost:', '$' + totalCost.toFixed(2))
  console.log('Total tax:', '$' + totalTax.toFixed(2))
  console.log('Cost + Tax:', '$' + (totalCost + totalTax).toFixed(2))
}

fix().catch(console.error)
