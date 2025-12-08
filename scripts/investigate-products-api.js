/**
 * Investigate why shipment.products and quantity are missing
 *
 * This tests:
 * 1. What the /order bulk endpoint returns for products
 * 2. What a single order fetch returns
 * 3. What the /shipment endpoint returns for products
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API = 'https://api.shipbob.com/2025-07'

async function main() {
  console.log('='.repeat(70))
  console.log('INVESTIGATING: Why Products Sold and Quantity are missing')
  console.log('='.repeat(70))

  // Get Henson client with token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .ilike('company_name', '%henson%')

  const client = clients?.[0]
  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token

  if (!token) {
    console.error('No Henson API token found')
    process.exit(1)
  }

  console.log('Client:', client.company_name)
  console.log('')

  // First, find shipments that have NO items in our DB
  console.log('--- Finding shipments with missing products ---')
  const { data: shipmentsNoItems } = await supabase
    .from('shipments')
    .select('id, shipment_id, shipbob_order_id, status')
    .eq('client_id', client.id)
    .not('status', 'in', '("Exception","Cancelled")')
    .order('created_at', { ascending: false })
    .limit(50)

  // Check which ones have no items
  const shipmentIds = shipmentsNoItems?.map(s => s.shipment_id) || []
  const { data: existingItems } = await supabase
    .from('shipment_items')
    .select('shipment_id')
    .in('shipment_id', shipmentIds)

  const shipmentIdsWithItems = new Set(existingItems?.map(i => i.shipment_id) || [])
  const shipmentsWithoutItems = shipmentsNoItems?.filter(s => !shipmentIdsWithItems.has(s.shipment_id)) || []

  console.log(`Found ${shipmentsWithoutItems.length} shipments without items (out of ${shipmentsNoItems?.length})`)

  if (shipmentsWithoutItems.length === 0) {
    console.log('All recent shipments have items. Checking quantity instead...')

    // Check items with NULL quantity
    const { data: nullQtyItems, count } = await supabase
      .from('shipment_items')
      .select('*', { count: 'exact' })
      .eq('client_id', client.id)
      .is('quantity', null)
      .limit(5)

    console.log(`\nItems with NULL quantity: ${count}`)
    if (nullQtyItems?.length) {
      console.log('Sample NULL quantity items:')
      for (const item of nullQtyItems) {
        console.log(`  - Shipment ${item.shipment_id}: ${item.name || item.sku}, qty=${item.quantity}`)
      }

      // Test fetching this shipment directly
      const testShipmentId = nullQtyItems[0].shipment_id
      console.log(`\n--- Testing shipment ${testShipmentId} via direct API ---`)

      const shipmentRes = await fetch(`${SHIPBOB_API}/shipment/${testShipmentId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const shipment = await shipmentRes.json()

      console.log('\nDirect /shipment response:')
      console.log('  products exists:', !!shipment.products)
      console.log('  products length:', shipment.products?.length || 0)
      if (shipment.products?.length > 0) {
        console.log('  First product:')
        const p = shipment.products[0]
        console.log('    id:', p.id)
        console.log('    name:', p.name)
        console.log('    sku:', p.sku)
        console.log('    quantity:', p.quantity)
        console.log('    inventory:', JSON.stringify(p.inventory, null, 2))
      }
    }
    return
  }

  // Take the first shipment without items to investigate
  const testShipment = shipmentsWithoutItems[0]
  console.log(`\nInvestigating shipment ${testShipment.shipment_id} (order ${testShipment.shipbob_order_id})`)
  console.log('Status:', testShipment.status)

  // 1. Test the bulk /order endpoint (like sync uses)
  console.log('\n--- TEST 1: Bulk /order endpoint ---')
  const orderId = testShipment.shipbob_order_id

  const orderListRes = await fetch(`${SHIPBOB_API}/order?OrderIds=${orderId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const orderList = await orderListRes.json()

  if (orderList.length > 0) {
    const order = orderList[0]
    console.log('Order found:', order.id)
    console.log('order.products exists:', !!order.products)
    console.log('order.products length:', order.products?.length || 0)

    const shipment = order.shipments?.find(s => s.id.toString() === testShipment.shipment_id)
    if (shipment) {
      console.log('shipment.products exists:', !!shipment.products)
      console.log('shipment.products length:', shipment.products?.length || 0)

      if (shipment.products?.length > 0) {
        console.log('First shipment.product:', JSON.stringify(shipment.products[0], null, 2))
      }
    } else {
      console.log('Shipment not found in order.shipments')
    }
  }

  // 2. Test single /order/{id} endpoint
  console.log('\n--- TEST 2: Single /order/{id} endpoint ---')
  const singleOrderRes = await fetch(`${SHIPBOB_API}/order/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const singleOrder = await singleOrderRes.json()

  console.log('order.products exists:', !!singleOrder.products)
  console.log('order.products length:', singleOrder.products?.length || 0)

  const singleShipment = singleOrder.shipments?.find(s => s.id.toString() === testShipment.shipment_id)
  if (singleShipment) {
    console.log('shipment.products exists:', !!singleShipment.products)
    console.log('shipment.products length:', singleShipment.products?.length || 0)
  }

  // 3. Test /shipment/{id} endpoint directly
  console.log('\n--- TEST 3: Direct /shipment/{id} endpoint ---')
  const shipmentRes = await fetch(`${SHIPBOB_API}/shipment/${testShipment.shipment_id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const directShipment = await shipmentRes.json()

  console.log('shipment.products exists:', !!directShipment.products)
  console.log('shipment.products length:', directShipment.products?.length || 0)

  if (directShipment.products?.length > 0) {
    console.log('\n✅ PRODUCTS FOUND via /shipment endpoint!')
    console.log('Products:')
    for (const p of directShipment.products) {
      console.log(`  - ${p.name || p.sku}: qty=${p.quantity}`)
      if (p.inventory?.length > 0) {
        for (const inv of p.inventory) {
          console.log(`      inventory[${inv.id}]: qty=${inv.quantity}, committed=${inv.quantity_committed}`)
        }
      }
    }

    console.log('\n📋 DIAGNOSIS:')
    console.log('The /order bulk endpoint does NOT return shipment.products')
    console.log('We need to fetch /shipment/{id} directly to get products')
    console.log('\nFIX NEEDED: Add a step to fetch each shipment directly and extract products')
  } else {
    console.log('No products even on direct shipment fetch')
    console.log('Full shipment response:', JSON.stringify(directShipment, null, 2).slice(0, 1000))
  }
}

main().catch(console.error)
