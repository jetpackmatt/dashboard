/**
 * Test what the ShipBob API returns for products
 * Compare order.products vs shipment.products
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
  console.log('TESTING: API product data structure')
  console.log('='.repeat(70))

  // Get Henson client with token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .ilike('company_name', '%henson%')

  const token = clients?.[0]?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
  if (!token) {
    console.error('No token found')
    process.exit(1)
  }

  // Get a recent order
  const params = new URLSearchParams({
    StartDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    EndDate: new Date().toISOString(),
    Limit: '5',
    Page: '1'
  })

  console.log('\n--- Fetching orders from bulk /order endpoint ---')
  const res = await fetch(`${SHIPBOB_API}/order?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const orders = await res.json()

  if (!orders.length) {
    console.log('No orders found')
    return
  }

  const order = orders.find(o => o.shipments?.length > 0 && o.products?.length > 0)
  if (!order) {
    console.log('No order with both shipments and products found')
    return
  }

  console.log(`\nOrder ${order.id}:`)
  console.log(`  Status: ${order.status}`)
  console.log(`  Products count: ${order.products?.length || 0}`)
  console.log(`  Shipments count: ${order.shipments?.length || 0}`)

  console.log('\n--- order.products (from bulk /order endpoint) ---')
  for (const p of (order.products || []).slice(0, 3)) {
    console.log(`  Product ID: ${p.id}`)
    console.log(`    SKU: ${p.sku}`)
    console.log(`    Name: ${p.name}`)
    console.log(`    Quantity: ${p.quantity}`)
    console.log(`    Reference ID: ${p.reference_id}`)
    if (p.inventory) {
      console.log(`    Inventory:`)
      for (const inv of p.inventory.slice(0, 2)) {
        console.log(`      - ID: ${inv.id}, qty: ${inv.quantity}, committed: ${inv.quantity_committed}`)
      }
    }
    console.log('')
  }

  console.log('\n--- shipment.products (from bulk /order endpoint) ---')
  for (const shipment of (order.shipments || []).slice(0, 1)) {
    console.log(`Shipment ${shipment.id}:`)
    console.log(`  products exists: ${!!shipment.products}`)
    console.log(`  products length: ${shipment.products?.length || 0}`)

    for (const p of (shipment.products || []).slice(0, 3)) {
      console.log(`  Product ID: ${p.id}`)
      console.log(`    SKU: ${p.sku}`)
      console.log(`    Name: ${p.name}`)
      console.log(`    Quantity: ${p.quantity}`)
      console.log(`    Reference ID: ${p.reference_id}`)
      if (p.inventory) {
        console.log(`    Inventory:`)
        for (const inv of p.inventory.slice(0, 2)) {
          console.log(`      - ID: ${inv.id}, qty: ${inv.quantity}, committed: ${inv.quantity_committed}`)
        }
      }
      console.log('')
    }
  }

  // Now test single order endpoint
  console.log('\n--- Single /order/{id} endpoint ---')
  const singleRes = await fetch(`${SHIPBOB_API}/order/${order.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const singleOrder = await singleRes.json()

  console.log(`Shipment products from single order:`)
  for (const shipment of (singleOrder.shipments || []).slice(0, 1)) {
    console.log(`  products exists: ${!!shipment.products}`)
    console.log(`  products length: ${shipment.products?.length || 0}`)
    for (const p of (shipment.products || []).slice(0, 2)) {
      console.log(`    Product: id=${p.id}, sku=${p.sku}, qty=${p.quantity}`)
    }
  }

  // Test direct shipment endpoint
  const shipmentId = order.shipments[0].id
  console.log(`\n--- Direct /shipment/${shipmentId} endpoint ---`)
  const shipRes = await fetch(`${SHIPBOB_API}/shipment/${shipmentId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (shipRes.ok) {
    const text = await shipRes.text()
    if (text) {
      const shipment = JSON.parse(text)
      console.log(`  products exists: ${!!shipment.products}`)
      console.log(`  products length: ${shipment.products?.length || 0}`)
      for (const p of (shipment.products || []).slice(0, 2)) {
        console.log(`    Product: id=${p.id}, sku=${p.sku}, qty=${p.quantity}`)
        if (p.inventory) {
          for (const inv of p.inventory.slice(0, 2)) {
            console.log(`      Inventory: id=${inv.id}, qty=${inv.quantity}`)
          }
        }
      }
    } else {
      console.log('  Empty response')
    }
  } else {
    console.log(`  Error: ${shipRes.status}`)
  }

  console.log('\n=== DIAGNOSIS ===')
  console.log('If order.products has data but shipment.products does not,')
  console.log('we should use order.products for shipment_items (1:1 mapping for single-shipment orders)')
  console.log('or fetch /shipment/{id} directly if it has the products')
}

main().catch(console.error)
