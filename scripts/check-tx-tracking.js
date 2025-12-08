require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Test if tracking_id column exists
  const { error } = await supabase.from('transactions').select('tracking_id').limit(1)
  const exists = !error || !error.message.includes('does not exist')
  console.log('tracking_id column exists:', exists)
  if (error && error.message.includes('does not exist')) {
    console.log('Column does not exist - need to create it or use additional_details')
    return
  }

  // Check a sample transaction's additional_details
  const { data } = await supabase
    .from('transactions')
    .select('transaction_id, additional_details, tracking_id')
    .eq('reference_type', 'Shipment')
    .limit(3)

  console.log('\nSample transactions from DB:')
  for (const tx of data || []) {
    console.log('---')
    console.log('transaction_id:', tx.transaction_id)
    console.log('tracking_id (column):', tx.tracking_id)
    console.log('additional_details.TrackingId:', tx.additional_details?.TrackingId)
  }
}
main().catch(console.error)
