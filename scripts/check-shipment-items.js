/**
 * Quick check of shipment_items data
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get Henson client
  const { data: clients } = await supabase
    .from('clients')
    .select('id')
    .ilike('company_name', '%henson%')

  const clientId = clients?.[0]?.id

  // Check field population
  const { count: total } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const { count: hasQty } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .not('quantity', 'is', null)

  const { count: hasName } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .not('name', 'is', null)

  const { count: hasSku } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .not('sku', 'is', null)

  console.log('=== Henson Shipment Items Field Population ===')
  console.log(`Total items: ${total}`)
  console.log(`Has quantity: ${hasQty} (${(hasQty/total*100).toFixed(1)}%)`)
  console.log(`Has name: ${hasName} (${(hasName/total*100).toFixed(1)}%)`)
  console.log(`Has SKU: ${hasSku} (${(hasSku/total*100).toFixed(1)}%)`)

  // Sample of actual data
  console.log('\n=== Sample Items ===')
  const { data: samples } = await supabase
    .from('shipment_items')
    .select('shipment_id, shipbob_product_id, sku, name, inventory_id, quantity, quantity_committed')
    .eq('client_id', clientId)
    .limit(10)

  console.table(samples)

  // Check order_items too (since sync has both)
  const { count: orderItemsTotal } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const { count: orderItemsHasQty } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .not('quantity', 'is', null)

  console.log('\n=== Order Items Field Population ===')
  console.log(`Total items: ${orderItemsTotal}`)
  console.log(`Has quantity: ${orderItemsHasQty} (${(orderItemsHasQty/orderItemsTotal*100).toFixed(1)}%)`)

  const { data: orderSamples } = await supabase
    .from('order_items')
    .select('order_id, shipbob_product_id, sku, name, quantity')
    .eq('client_id', clientId)
    .not('quantity', 'is', null)
    .limit(5)

  console.log('\nSample order_items WITH quantity:')
  console.table(orderSamples)
}

main().catch(console.error)
