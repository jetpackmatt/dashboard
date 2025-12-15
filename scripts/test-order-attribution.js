/**
 * Test the order lookup attribution for Return transactions
 *
 * Return 2969524 has Comment: "Return to sender fee for Order 307909309"
 * We need order 307909309 to be in our orders table for the fallback to work
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function test() {
  console.log('=== TESTING ORDER ATTRIBUTION FOR RETURNS ===\n')

  // 1. Check if order 307909309 exists
  const { data: order } = await supabase
    .from('orders')
    .select('shipbob_order_id, client_id')
    .eq('shipbob_order_id', 307909309)
    .maybeSingle()

  if (order) {
    console.log('✅ Order 307909309 found in database')
    console.log(`   client_id: ${order.client_id}`)
    console.log('\n   The fallback WILL work!')
  } else {
    console.log('❌ Order 307909309 NOT in database')
    console.log('\n   The fallback will NOT work until this order is synced.')
    console.log('\n   Options:')
    console.log('   1. Wait for order sync to catch this order')
    console.log('   2. Manually sync this specific order')
    console.log('   3. The return will remain unattributed until then')
  }

  // 2. Verify the return's transaction
  console.log('\n=== CURRENT STATE OF RETURN 2969524 ===\n')

  const { data: tx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, client_id, additional_details')
    .eq('reference_id', '2969524')
    .eq('reference_type', 'Return')
    .maybeSingle()

  if (tx) {
    console.log('Transaction:')
    console.log(`  reference_id: ${tx.reference_id}`)
    console.log(`  client_id: ${tx.client_id || '(null)'}`)
    console.log(`  Comment: ${tx.additional_details?.Comment || '(none)'}`)

    // Parse order from comment
    const match = tx.additional_details?.Comment?.match(/Order\s+(\d+)/i)
    if (match) {
      console.log(`\n  Parsed order ID: ${match[1]}`)
    }
  }

  // 3. Check the returns table
  const { data: returnRecord } = await supabase
    .from('returns')
    .select('shipbob_return_id, client_id')
    .eq('shipbob_return_id', 2969524)
    .maybeSingle()

  console.log('\n=== RETURNS TABLE ===\n')
  if (returnRecord) {
    console.log(`Return 2969524 in returns table: client_id=${returnRecord.client_id}`)
  } else {
    console.log('Return 2969524 NOT in returns table')
  }

  // 4. Summary
  console.log('\n=== SUMMARY ===\n')
  console.log('The order lookup fallback I added will work when:')
  console.log('1. Return transaction references an order in additional_details.Comment')
  console.log('2. That order exists in our orders table')
  console.log('')
  console.log('For return 2969524, order 307909309 needs to be synced first.')
  console.log('This happens automatically when the order sync runs.')
  console.log('')
  console.log('Once the order is in our database, the next transaction sync will')
  console.log('attribute the return transaction correctly.')
}

test().catch(console.error)
