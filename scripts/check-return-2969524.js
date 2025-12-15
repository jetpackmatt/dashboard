/**
 * Check current state of return 2969524
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  const testReturnId = 2969524

  console.log('=== TRANSACTION ===\n')

  const { data: tx } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_id', testReturnId.toString())
    .eq('reference_type', 'Return')
    .single()

  if (tx) {
    console.log('Transaction found:')
    console.log(`  transaction_id: ${tx.transaction_id}`)
    console.log(`  reference_id: ${tx.reference_id}`)
    console.log(`  reference_type: ${tx.reference_type}`)
    console.log(`  fee_type: ${tx.fee_type}`)
    console.log(`  amount: $${tx.amount}`)
    console.log(`  invoiced_date: ${tx.invoiced_date}`)
    console.log(`  client_id: ${tx.client_id || '(null)'}`)
    console.log(`  merchant_id: ${tx.merchant_id || '(null)'}`)
    console.log(`  fc_name: ${tx.fc_name}`)
  } else {
    console.log('Transaction NOT found')
  }

  console.log('\n=== RETURNS TABLE ===\n')

  const { data: returnRecord } = await supabase
    .from('returns')
    .select('*')
    .eq('shipbob_return_id', testReturnId)
    .maybeSingle()

  if (returnRecord) {
    console.log('Return record found:')
    console.log(`  shipbob_return_id: ${returnRecord.shipbob_return_id}`)
    console.log(`  client_id: ${returnRecord.client_id || '(null)'}`)
    console.log(`  status: ${returnRecord.status}`)
    console.log(`  original_shipment_id: ${returnRecord.original_shipment_id}`)
    console.log(`  fc_name: ${returnRecord.fc_name}`)
    console.log(`  channel_name: ${returnRecord.channel_name}`)
    console.log(`  synced_at: ${returnRecord.synced_at}`)
  } else {
    console.log('Return record NOT found')
  }

  // Count all unattributed returns
  console.log('\n=== ALL UNATTRIBUTED TRANSACTIONS ===\n')

  const { data: unattributed, count } = await supabase
    .from('transactions')
    .select('reference_id, reference_type, fee_type, client_id', { count: 'exact' })
    .is('client_id', null)

  console.log(`Total unattributed transactions: ${count}`)
  if (unattributed && unattributed.length > 0) {
    const byType = {}
    for (const tx of unattributed) {
      const key = tx.reference_type || '(null)'
      byType[key] = (byType[key] || 0) + 1
    }
    console.log('By reference_type:', byType)
  }
}

check().catch(console.error)
