/**
 * Lookup client by order ID for unattributed transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function lookup() {
  // The return transaction mentions Order 307909309
  const orderId = 307909309

  console.log(`=== LOOKING UP ORDER ${orderId} ===\n`)

  const { data: order } = await supabase
    .from('orders')
    .select('shipbob_order_id, client_id, merchant_id, order_number')
    .eq('shipbob_order_id', orderId)
    .maybeSingle()

  if (order) {
    console.log('Found order:', order)

    // Get client name
    const { data: client } = await supabase
      .from('clients')
      .select('id, company_name, brand_name, merchant_id')
      .eq('id', order.client_id)
      .single()

    if (client) {
      console.log('Client:', client)
    }
  } else {
    console.log('Order not found in database')

    // Try API
    const parentToken = process.env.SHIPBOB_API_TOKEN
    console.log('\nTrying ShipBob API...')

    const res = await fetch(`https://api.shipbob.com/1.0/order/${orderId}`, {
      headers: { Authorization: `Bearer ${parentToken}` }
    })

    if (res.ok) {
      const data = await res.json()
      console.log('API found order:', {
        id: data.id,
        order_number: data.order_number,
        channel: data.channel?.name,
        status: data.status
      })
    } else {
      console.log(`API response: ${res.status}`)
    }
  }

  // Also check URO 145156
  console.log('\n=== LOOKING UP URO 145156 ===\n')

  const { data: uro } = await supabase
    .from('receiving_orders')
    .select('shipbob_wro_id, client_id, merchant_id, reference_id')
    .eq('shipbob_wro_id', 145156)
    .maybeSingle()

  if (uro) {
    console.log('Found URO:', uro)

    const { data: client } = await supabase
      .from('clients')
      .select('id, company_name, brand_name')
      .eq('id', uro.client_id)
      .single()

    if (client) {
      console.log('Client:', client)
    }
  } else {
    console.log('URO not found in database')

    // Try API
    const parentToken = process.env.SHIPBOB_API_TOKEN
    console.log('\nTrying ShipBob API...')

    const res = await fetch(`https://api.shipbob.com/1.0/receivingorder/145156`, {
      headers: { Authorization: `Bearer ${parentToken}` }
    })

    if (res.ok) {
      const data = await res.json()
      console.log('API found URO:', {
        id: data.id,
        reference_id: data.reference_id,
        status: data.status
      })
    } else {
      console.log(`API response: ${res.status}`)
    }
  }

  // Also check Shipment 327400919
  console.log('\n=== LOOKING UP SHIPMENT 327400919 ===\n')

  const { data: shipment } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, merchant_id, tracking_number')
    .eq('shipment_id', 327400919)
    .maybeSingle()

  if (shipment) {
    console.log('Found Shipment:', shipment)

    const { data: client } = await supabase
      .from('clients')
      .select('id, company_name, brand_name')
      .eq('id', shipment.client_id)
      .single()

    if (client) {
      console.log('Client:', client)
    }
  } else {
    console.log('Shipment not found in database')
  }
}

lookup().catch(console.error)
