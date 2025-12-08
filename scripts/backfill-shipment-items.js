/**
 * Backfill shipment_items with proper product data
 *
 * Problem: Existing shipment_items have garbage data (product_id=-1, obfuscated sku/name)
 * Solution: Re-fetch orders from API and rebuild shipment_items with proper product data
 *
 * Usage: node scripts/backfill-shipment-items.js [daysBack]
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API = 'https://api.shipbob.com/2025-07'
const BATCH_SIZE = 250
const DELAY_MS = 100

async function main() {
  const daysBack = parseInt(process.argv[2]) || 30

  console.log('='.repeat(70))
  console.log(`BACKFILL: Shipment Items (last ${daysBack} days)`)
  console.log('='.repeat(70))

  // Get clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')

  const clientsWithTokens = []
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientsWithTokens.push({ id: c.id, name: c.company_name, token })
    }
  }

  console.log('Clients:', clientsWithTokens.map(c => c.name).join(', '))
  console.log('')

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  for (const client of clientsWithTokens) {
    console.log(`\n--- Processing ${client.name} ---`)

    // Count current items with null quantity
    const { count: nullQtyBefore } = await supabase
      .from('shipment_items')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('quantity', null)

    console.log(`Items with null quantity before: ${nullQtyBefore}`)

    // Fetch orders from API
    let allOrders = []
    let page = 1

    console.log(`Fetching orders since ${startDate.toISOString().split('T')[0]}...`)

    while (true) {
      const params = new URLSearchParams({
        StartDate: startDate.toISOString(),
        EndDate: new Date().toISOString(),
        Limit: BATCH_SIZE.toString(),
        Page: page.toString()
      })

      const res = await fetch(`${SHIPBOB_API}/order?${params}`, {
        headers: { Authorization: `Bearer ${client.token}` }
      })

      if (!res.ok) {
        console.error(`API error: ${res.status}`)
        break
      }

      const orders = await res.json()
      if (!Array.isArray(orders) || orders.length === 0) break

      allOrders.push(...orders)
      process.stdout.write(`\r  Fetched ${allOrders.length} orders (page ${page})`)

      if (orders.length < BATCH_SIZE) break
      page++
      await new Promise(r => setTimeout(r, DELAY_MS))
    }

    console.log(`\n  Total orders: ${allOrders.length}`)

    // Process orders to build shipment_items
    let itemsCreated = 0
    let shipmentsProcessed = 0

    for (const order of allOrders) {
      if (!order.shipments) continue

      // Build product quantity lookup from order.products
      const orderProductQuantities = {}
      for (const p of order.products || []) {
        if (p.id && p.quantity) {
          orderProductQuantities[p.id] = p.quantity
        }
      }

      for (const shipment of order.shipments) {
        if (!shipment.products || shipment.products.length === 0) continue

        const shipmentId = shipment.id.toString()

        // Delete existing items for this shipment
        await supabase.from('shipment_items').delete().eq('shipment_id', shipmentId)

        // Insert new items with proper data
        const newItems = []
        for (const product of shipment.products) {
          const inventories = product.inventory || [{}]
          const orderQuantity = product.id ? orderProductQuantities[product.id] : null

          for (const inv of inventories) {
            newItems.push({
              client_id: client.id,
              shipment_id: shipmentId,
              shipbob_product_id: product.id || null,
              sku: product.sku || null,
              reference_id: product.reference_id || null,
              name: product.name || null,
              inventory_id: inv.id || null,
              lot: inv.lot || null,
              expiration_date: inv.expiration_date || null,
              quantity: inv.quantity || orderQuantity || product.quantity || null,
              quantity_committed: inv.quantity_committed || null,
              is_dangerous_goods: product.is_dangerous_goods || false,
              serial_numbers: inv.serial_numbers ? JSON.stringify(inv.serial_numbers) : null,
            })
          }
        }

        if (newItems.length > 0) {
          const { error } = await supabase.from('shipment_items').insert(newItems)
          if (error) {
            console.error(`Error inserting items for shipment ${shipmentId}:`, error.message)
          } else {
            itemsCreated += newItems.length
            shipmentsProcessed++
          }
        }
      }

      if (shipmentsProcessed % 100 === 0 && shipmentsProcessed > 0) {
        process.stdout.write(`\r  Processed ${shipmentsProcessed} shipments, ${itemsCreated} items`)
      }
    }

    console.log(`\n  Shipments processed: ${shipmentsProcessed}`)
    console.log(`  Items created: ${itemsCreated}`)

    // Count items with null quantity after
    const { count: nullQtyAfter } = await supabase
      .from('shipment_items')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('quantity', null)

    console.log(`  Items with null quantity after: ${nullQtyAfter}`)
    console.log(`  Fixed: ${nullQtyBefore - nullQtyAfter} items`)
  }

  console.log('\n' + '='.repeat(70))
  console.log('BACKFILL COMPLETE')
  console.log('='.repeat(70))
}

main().catch(console.error)
