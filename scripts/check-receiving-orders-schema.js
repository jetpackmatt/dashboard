require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Checking receiving_orders schema ===\n')

  // Get a sample row to see column names
  const { data: sample, error } = await supabase
    .from('receiving_orders')
    .select('*')
    .limit(1)

  if (error) {
    console.log('Error:', error.message)
    return
  }

  if (sample && sample.length > 0) {
    console.log('Columns:', Object.keys(sample[0]).join(', '))
    console.log('\nSample row:')
    console.log(JSON.stringify(sample[0], null, 2))
  }

  // Now look for our specific WRO IDs using the correct column name
  const wroIds = [871028, 870085, 871098, 875259, 873893, 874413, 875181, 861112, 869299, 869656, 868192, 856885, 860986]

  // Check if there's a shipbob_receiving_order_id column
  console.log('\n=== Looking for WRO IDs in receiving_orders ===\n')

  // Try shipbob_receiving_order_id
  const { data: wros1, error: e1 } = await supabase
    .from('receiving_orders')
    .select('*')
    .in('shipbob_receiving_order_id', wroIds)

  if (e1) {
    console.log('shipbob_receiving_order_id column error:', e1.message)
  } else {
    console.log('Found using shipbob_receiving_order_id:', wros1?.length || 0)
    if (wros1?.length > 0) {
      for (const wro of wros1) {
        console.log('  WRO', wro.shipbob_receiving_order_id, '-> client_id:', wro.client_id)
      }
    }
  }

  // Get all receiving_orders with their WRO IDs to see if any match
  console.log('\n=== All receiving_orders with their IDs ===\n')

  const { data: allWros } = await supabase
    .from('receiving_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20)

  if (allWros && allWros.length > 0) {
    for (const wro of allWros) {
      // Find which columns might have the WRO ID
      console.log('Row:', wro.id || wro.shipbob_receiving_order_id || 'unknown', '| client:', wro.client_id)
    }
  }

  // Also check if shipment 2880370 exists (for the Credit transaction)
  console.log('\n=== Checking shipment 2880370 for Credit attribution ===\n')

  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .select('shipment_id, client_id')
    .eq('shipment_id', '2880370')
    .single()

  if (shipmentError) {
    console.log('Shipment 2880370 not found:', shipmentError.message)
  } else {
    console.log('Shipment 2880370 found! client_id:', shipment?.client_id)
  }
}

main().catch(console.error)
