require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Check shipments columns
  const { error: luErr } = await supabase.from('shipments').select('last_update_at').limit(1)
  const { error: sbErr } = await supabase.from('shipments').select('sb_last_update_at').limit(1)

  console.log('shipments.last_update_at exists:', !luErr || !(luErr.message || '').includes('does not exist'))
  console.log('shipments.sb_last_update_at exists:', !sbErr || !(sbErr.message || '').includes('does not exist'))

  // Check transactions columns
  const { error: invDateErr } = await supabase.from('transactions').select('invoice_date').limit(1)
  const { error: invDateSbErr } = await supabase.from('transactions').select('invoice_date_sb').limit(1)
  const { error: txTypeErr } = await supabase.from('transactions').select('transaction_type').limit(1)

  console.log('transactions.invoice_date exists:', !invDateErr || !(invDateErr.message || '').includes('does not exist'))
  console.log('transactions.invoice_date_sb exists:', !invDateSbErr || !(invDateSbErr.message || '').includes('does not exist'))
  console.log('transactions.transaction_type exists:', !txTypeErr || !(txTypeErr.message || '').includes('does not exist'))

  // Check orders tags
  const { error: tagsErr } = await supabase.from('orders').select('tags').limit(1)
  console.log('orders.tags exists:', !tagsErr || !(tagsErr.message || '').includes('does not exist'))

  // Sample transaction_type values
  const { data: txSample } = await supabase
    .from('transactions')
    .select('transaction_type')
    .not('transaction_type', 'is', null)
    .limit(5)
  console.log('\ntransaction_type sample values:', txSample?.map(t => t.transaction_type) || 'none')
}

main().catch(console.error)
