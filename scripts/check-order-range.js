/**
 * Check order ID range for each client
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== ORDER ID RANGES BY CLIENT ===\n')

  // Get all clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')

  for (const client of clients || []) {
    // Get min and max order IDs
    const { data: minOrder } = await supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('client_id', client.id)
      .order('shipbob_order_id', { ascending: true })
      .limit(1)
      .maybeSingle()

    const { data: maxOrder } = await supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('client_id', client.id)
      .order('shipbob_order_id', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)

    if (minOrder && maxOrder) {
      console.log(`${client.company_name}:`)
      console.log(`  Count: ${count}`)
      console.log(`  Min order ID: ${minOrder.shipbob_order_id}`)
      console.log(`  Max order ID: ${maxOrder.shipbob_order_id}`)
      console.log(`  Target (307909309) in range: ${minOrder.shipbob_order_id <= 307909309 && maxOrder.shipbob_order_id >= 307909309 ? 'YES' : 'NO'}`)
      console.log('')
    } else {
      console.log(`${client.company_name}: No orders`)
      console.log('')
    }
  }

  // Check if order 307909309 or nearby exists
  console.log('=== SEARCHING FOR ORDER 307909309 OR NEARBY ===\n')

  const { data: nearbyOrders } = await supabase
    .from('orders')
    .select('shipbob_order_id, client_id, store_order_id')
    .gte('shipbob_order_id', 307909300)
    .lte('shipbob_order_id', 307909320)
    .order('shipbob_order_id')

  if (nearbyOrders && nearbyOrders.length > 0) {
    console.log('Found nearby orders:')
    for (const o of nearbyOrders) {
      console.log(`  ${o.shipbob_order_id}: client=${o.client_id}, store_order=${o.store_order_id}`)
    }
  } else {
    console.log('No orders found in range 307909300-307909320')
  }
}

check().catch(console.error)
