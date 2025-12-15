/**
 * Verify order 307909309 exists and check the fix will work
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function verify() {
  const orderId = 307909309

  console.log(`=== VERIFYING ORDER ${orderId} ===\n`)

  const { data: order } = await supabase
    .from('orders')
    .select('shipbob_order_id, client_id, store_order_id, customer_name')
    .eq('shipbob_order_id', orderId)
    .maybeSingle()

  if (order) {
    console.log('✅ Order found in database:')
    console.log(`   shipbob_order_id: ${order.shipbob_order_id}`)
    console.log(`   client_id: ${order.client_id}`)
    console.log(`   store_order_id: ${order.store_order_id}`)
    console.log(`   customer_name: ${order.customer_name}`)

    // Get client name
    const { data: client } = await supabase
      .from('clients')
      .select('company_name, brand_name')
      .eq('id', order.client_id)
      .single()

    if (client) {
      console.log(`   Client: ${client.company_name} (${client.brand_name})`)
    }

    console.log('\n✅ The fix will work! When syncAllTransactions runs next:')
    console.log('   1. It will build an orderLookup with this order')
    console.log('   2. For Return transaction 2969524, it will:')
    console.log('      a. Try returnLookup (will fail - return not in returns table)')
    console.log('      b. Parse "Order 307909309" from Comment')
    console.log(`      c. Find client_id ${order.client_id} in orderLookup`)
    console.log('   3. The transaction will be attributed correctly!')
  } else {
    console.log('❌ Order NOT found in database')
    console.log('   The fallback will not work - order needs to be synced first')
  }
}

verify().catch(console.error)
