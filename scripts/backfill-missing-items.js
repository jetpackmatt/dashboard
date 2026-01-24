// Script to backfill missing order_items and shipment_items
// For orders where ShipBob API didn't return products data during initial sync
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Henson client API token (child token)
const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// ShipBob order IDs to check
const ORDERS_TO_CHECK = [
  { orderId: '321111953', shipmentId: '329113958' },
  { orderId: '322134161', shipmentId: '330175048' },
  { orderId: '326032485', shipmentId: '334143019' }
]

async function getHensonToken() {
  const { data, error } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_CLIENT_ID)
    .single()

  if (error) throw error
  return data.api_token
}

async function fetchOrder(token, orderId) {
  const url = `https://api.shipbob.com/2.0/order/${orderId}`
  console.log(`Fetching order ${orderId}...`)

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    console.error(`Failed to fetch order ${orderId}: ${response.status}`)
    return null
  }

  return response.json()
}

async function main() {
  console.log('=== Backfill Missing Items ===\n')

  const token = await getHensonToken()
  console.log('Got Henson API token\n')

  for (const { orderId, shipmentId } of ORDERS_TO_CHECK) {
    console.log(`\n--- Order ${orderId} (Shipment ${shipmentId}) ---`)

    const order = await fetchOrder(token, orderId)
    if (!order) continue

    console.log(`Status: ${order.status}`)
    console.log(`Products in API: ${order.products?.length || 0}`)

    if (order.products?.length > 0) {
      console.log('\nProducts:')
      for (const p of order.products) {
        console.log(`  - ${p.name || p.reference_id} (qty: ${p.quantity}, product_id: ${p.id})`)
      }
    }

    console.log(`\nShipments in API: ${order.shipments?.length || 0}`)
    if (order.shipments?.length > 0) {
      for (const s of order.shipments) {
        console.log(`  Shipment ${s.id}: ${s.products?.length || 0} products`)
        if (s.products?.length > 0) {
          for (const p of s.products) {
            console.log(`    - ${p.name || p.reference_id} (qty: ${p.quantity}, product_id: ${p.id})`)
          }
        }
      }
    }

    // Now let's backfill if we have data
    if (order.products?.length > 0) {
      console.log('\n>>> BACKFILLING order_items...')

      // Get the order UUID from our database
      const { data: dbOrder } = await supabase
        .from('orders')
        .select('id')
        .eq('shipbob_order_id', orderId)
        .single()

      if (dbOrder) {
        const orderItems = order.products.map(p => ({
          client_id: HENSON_CLIENT_ID,
          order_id: dbOrder.id,
          shipbob_product_id: p.id,
          sku: p.sku || null,
          reference_id: p.reference_id || null,
          quantity: p.quantity,
          merchant_id: '386350' // Henson merchant_id
        }))

        const { error: orderItemError } = await supabase
          .from('order_items')
          .upsert(orderItems, {
            onConflict: 'order_id,shipbob_product_id',
            ignoreDuplicates: false
          })

        if (orderItemError) {
          console.error('Error inserting order_items:', orderItemError.message)
        } else {
          console.log(`Inserted ${orderItems.length} order_items`)
        }
      }
    }

    // Backfill shipment_items from shipment products or order products
    const shipment = order.shipments?.find(s => String(s.id) === shipmentId)
    const productsToUse = shipment?.products?.length > 0 ? shipment.products : order.products

    if (productsToUse?.length > 0) {
      console.log('\n>>> BACKFILLING shipment_items...')

      const shipmentItems = productsToUse.map(p => ({
        client_id: HENSON_CLIENT_ID,
        shipment_id: shipmentId,
        shipbob_product_id: p.id,
        sku: p.sku || null,
        reference_id: p.reference_id || null,
        name: p.name || null,
        quantity: p.quantity,
        merchant_id: '386350'
      }))

      const { error: shipmentItemError } = await supabase
        .from('shipment_items')
        .insert(shipmentItems)

      if (shipmentItemError) {
        console.error('Error inserting shipment_items:', shipmentItemError.message)
      } else {
        console.log(`Inserted ${shipmentItems.length} shipment_items`)
      }
    }
  }

  console.log('\n\n=== Done ===')
}

main().catch(console.error)
