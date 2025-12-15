/**
 * Check full details of unattributed transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== ALL UNATTRIBUTED TRANSACTIONS (FULL DETAIL) ===\n')

  const { data: unattributed } = await supabase
    .from('transactions')
    .select('*')
    .is('client_id', null)

  for (const tx of unattributed || []) {
    console.log('---')
    console.log(JSON.stringify(tx, null, 2))
    console.log('---\n')
  }

  // Check if we can find any identifying info in the transactions that ARE attributed
  console.log('\n=== RECENT RETURN TRANSACTIONS (FOR COMPARISON) ===\n')

  const { data: recent } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type, client_id, merchant_id, tracking_id, fc_name')
    .eq('reference_type', 'Return')
    .not('client_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  for (const tx of recent || []) {
    console.log(`${tx.reference_id}: client=${tx.client_id}, merchant=${tx.merchant_id}, tracking=${tx.tracking_id}, fc=${tx.fc_name}`)
  }
}

check().catch(console.error)
