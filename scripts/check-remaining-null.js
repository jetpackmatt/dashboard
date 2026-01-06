#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Check all Henson NULL invoice transactions in Dec 15-21
  const { data: nullTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type, cost')
    .eq('client_id', hensonId)
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('All Henson NULL invoice transactions (Dec 15-21):')
  console.log('Count:', nullTx?.length)
  console.log('')

  // Group by fee_type
  const byFeeType = {}
  for (const tx of nullTx || []) {
    const key = tx.fee_type + ' / ' + tx.reference_type
    if (byFeeType[key] === undefined) {
      byFeeType[key] = { count: 0, total: 0 }
    }
    byFeeType[key].count++
    byFeeType[key].total += parseFloat(tx.cost)
  }

  console.log('By fee_type / reference_type:')
  for (const [key, val] of Object.entries(byFeeType).sort((a, b) => b[1].count - a[1].count)) {
    console.log('  ', key, ':', val.count, 'tx, $' + val.total.toFixed(2))
  }

  // Show all non-Shipping ones
  console.log('')
  console.log('All non-Shipping NULL tx:')
  const nonShipping = (nullTx || []).filter(t => t.fee_type !== 'Shipping')
  for (const tx of nonShipping) {
    console.log('  ', tx.transaction_id.substring(0, 16), tx.fee_type, tx.reference_type, '$' + tx.cost)
  }
}

main().catch(console.error)
