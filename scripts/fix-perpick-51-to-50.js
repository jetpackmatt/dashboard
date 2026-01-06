#!/usr/bin/env node
/**
 * Fix Per Pick Fee transactions at $0.51 that should be $0.50
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fix() {
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Update all $0.51 to $0.50
  const { data, error } = await supabase
    .from('transactions')
    .update({ cost: 0.50 })
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)
    .eq('cost', 0.51)
    .select('transaction_id')

  console.log('Fixed', data?.length || 0, 'transactions from $0.51 to $0.50')

  // Verify
  const { data: verify } = await supabase
    .from('transactions')
    .select('cost')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  const newTotal = (verify || []).reduce((s, t) => s + parseFloat(t.cost), 0)
  console.log('New Per Pick Fee total:', '$' + newTotal.toFixed(2))
  console.log('Expected:', '$394.56')
  console.log('Difference:', '$' + (newTotal - 394.56).toFixed(2))
}

fix().catch(console.error)
