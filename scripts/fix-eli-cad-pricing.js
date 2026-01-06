#!/usr/bin/env node
/**
 * Fix Canadian Per Pick Fee pricing for Eli Health to match PowerBI
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Pricing corrections from PowerBI comparison
const corrections = [
  { refId: '329954718', correctCost: 0.5 },
  { refId: '329954702', correctCost: 0.5 },
  { refId: '329954711', correctCost: 0.25 },
  { refId: '330149268', correctCost: 0.25 },
  { refId: '330030728', correctCost: 0.5 },
  { refId: '330039490', correctCost: 0.5 },
  { refId: '329993456', correctCost: 0.5 },
  { refId: '329901137', correctCost: 0.75 },
  { refId: '329901062', correctCost: 2.75 },
  { refId: '329891343', correctCost: 0.5 },
  { refId: '329780143', correctCost: 0.25 },
  { refId: '329813365', correctCost: 0.5 },
  { refId: '329748165', correctCost: 0.5 },
  { refId: '329749381', correctCost: 0.25 },
  { refId: '329603717', correctCost: 0.25 },
  { refId: '329603759', correctCost: 0.25 },
  { refId: '329606990', correctCost: 0.5 },
  { refId: '329604920', correctCost: 0.75 },
  { refId: '329603811', correctCost: 0.5 },
  { refId: '329450580', correctCost: 0.5 },
  { refId: '329197921', correctCost: 0.5 },
  { refId: '329141559', correctCost: 0.5 },
  { refId: '329064576', correctCost: 0.5 },
  { refId: '329200714', correctCost: 0.25 },
  { refId: '328920176', correctCost: 0.5 },
]

async function fix() {
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  console.log('Fixing', corrections.length, 'Canadian Per Pick Fee prices for Eli Health...\n')

  let totalFixed = 0
  let totalDiff = 0

  for (const c of corrections) {
    // Get current value
    const { data: current } = await supabase
      .from('transactions')
      .select('transaction_id, cost')
      .eq('client_id', eliHealthId)
      .eq('reference_id', c.refId)
      .eq('fee_type', 'Per Pick Fee')
      .eq('invoice_id_sb', 8730397)
      .single()

    if (!current) {
      console.log('  NOT FOUND: ref', c.refId)
      continue
    }

    const oldCost = parseFloat(current.cost)
    const diff = oldCost - c.correctCost

    // Update to correct cost
    const { error } = await supabase
      .from('transactions')
      .update({ cost: c.correctCost })
      .eq('transaction_id', current.transaction_id)

    if (error) {
      console.log('  ERROR updating ref', c.refId, ':', error.message)
    } else {
      console.log('  ref', c.refId, ':', oldCost, '->', c.correctCost, '(saved $' + diff.toFixed(2) + ')')
      totalFixed++
      totalDiff += diff
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log('Fixed:', totalFixed, 'transactions')
  console.log('Total reduction:', '$' + totalDiff.toFixed(2))

  // Verify new total
  const { data: allTx } = await supabase
    .from('transactions')
    .select('cost')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  const newTotal = (allTx || []).reduce((s, t) => s + parseFloat(t.cost), 0)
  console.log('New Eli Health Per Pick Fee total:', '$' + newTotal.toFixed(2))
  console.log('Expected:', '$394.56')
  console.log('Remaining difference:', '$' + (newTotal - 394.56).toFixed(2))
}

fix().catch(console.error)
