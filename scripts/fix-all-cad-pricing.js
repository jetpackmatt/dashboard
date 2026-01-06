#!/usr/bin/env node
/**
 * Fix ALL Canadian Per Pick Fee pricing for Eli Health
 * Pattern: CAD prices (0.57, 0.28, 0.85, etc.) need to be converted to USD (0.50, 0.25, 0.75)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// CAD to USD price mapping based on observed patterns
// CAD prices are ~14% higher than USD
const cadToUsd = {
  '0.28': 0.25,
  '0.57': 0.50,
  '0.85': 0.75,
  '1.13': 1.00,
  '1.42': 1.25,
  '1.70': 1.50,
  '1.99': 1.75,
  '2.27': 2.00,
  '2.55': 2.25,
  '2.84': 2.50,
  '3.11': 2.75,
  '3.40': 3.00,
}

async function fix() {
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Get all Eli Health Per Pick Fee transactions
  const { data: allTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, cost')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  console.log('Total Eli Health Per Pick Fee transactions:', allTx?.length)
  console.log('Current total:', (allTx || []).reduce((s, t) => s + parseFloat(t.cost), 0).toFixed(2))

  // Find transactions with CAD pricing
  const cadPriced = (allTx || []).filter(t => {
    const cost = parseFloat(t.cost).toFixed(2)
    return cadToUsd[cost] !== undefined
  })

  console.log('\nTransactions with CAD pricing:', cadPriced.length)

  if (cadPriced.length === 0) {
    console.log('No CAD-priced transactions found!')
    return
  }

  console.log('Fixing CAD prices...\n')

  let totalFixed = 0
  let totalDiff = 0

  for (const t of cadPriced) {
    const oldCost = parseFloat(t.cost)
    const costKey = oldCost.toFixed(2)
    const newCost = cadToUsd[costKey]

    const { error } = await supabase
      .from('transactions')
      .update({ cost: newCost })
      .eq('transaction_id', t.transaction_id)

    if (error) {
      console.log('  ERROR:', t.reference_id, error.message)
    } else {
      const diff = oldCost - newCost
      totalFixed++
      totalDiff += diff
    }
  }

  console.log('=== SUMMARY ===')
  console.log('Fixed:', totalFixed, 'transactions')
  console.log('Total reduction:', '$' + totalDiff.toFixed(2))

  // Verify new total
  const { data: verifyTx } = await supabase
    .from('transactions')
    .select('cost')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  const newTotal = (verifyTx || []).reduce((s, t) => s + parseFloat(t.cost), 0)
  console.log('\nNew Eli Health Per Pick Fee total:', '$' + newTotal.toFixed(2))
  console.log('Expected:', '$394.56')
  console.log('Remaining difference:', '$' + (newTotal - 394.56).toFixed(2))
}

fix().catch(console.error)
