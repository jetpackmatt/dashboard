/**
 * Explore how to map inventory_id to client_id for FC (storage) transactions
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const token = process.env.SHIPBOB_API_TOKEN

  console.log('=== EXPLORING PRODUCTS API FOR INVENTORY->CLIENT MAPPING ===')
  console.log('')

  // Get client tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  console.log('Clients found:', clients?.length)

  // For each client, get their products and extract inventory IDs
  const inventoryToClient = {}

  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log('\n--- ' + client.company_name + ' ---')

    // Get products for this client
    const prodResp = await fetch('https://api.shipbob.com/2025-07/product?Limit=250', {
      headers: { Authorization: 'Bearer ' + cred.api_token }
    })

    if (!prodResp.ok) {
      console.log('  Products API error:', prodResp.status)
      continue
    }

    const products = await prodResp.json()
    console.log('  Products found:', products?.length || 0)

    // Check if products have inventory info
    if (products && products.length > 0) {
      console.log('  Sample product structure:')
      const sample = products[0]
      console.log('    id:', sample.id)
      console.log('    name:', sample.name)
      console.log('    sku:', sample.sku)

      // Check for inventory field
      if (sample.fulfillable_inventory_items) {
        console.log('    fulfillable_inventory_items:', sample.fulfillable_inventory_items?.length)
        if (sample.fulfillable_inventory_items[0]) {
          console.log('    Sample inventory item:', JSON.stringify(sample.fulfillable_inventory_items[0], null, 2))
        }
      }

      // Map all inventory IDs to this client
      for (const prod of products) {
        if (prod.fulfillable_inventory_items) {
          for (const inv of prod.fulfillable_inventory_items) {
            if (inv.id) {
              inventoryToClient[inv.id] = client.id
            }
          }
        }
      }
    }
  }

  console.log('\n=== INVENTORY->CLIENT MAPPING BUILT ===')
  console.log('Total inventory IDs mapped:', Object.keys(inventoryToClient).length)

  // Test with FC transaction inventory IDs
  const { data: fcTx } = await supabase
    .from('transactions')
    .select('reference_id, additional_details')
    .eq('reference_type', 'FC')
    .limit(20)

  console.log('\nTesting FC inventory IDs against mapping:')
  let found = 0
  let notFound = 0
  for (const tx of fcTx || []) {
    const invId = tx.additional_details?.InventoryId
    if (invId) {
      const clientId = inventoryToClient[invId]
      if (clientId) {
        found++
        console.log('  InventoryId', invId, '-> CLIENT FOUND:', clientId)
      } else {
        notFound++
        console.log('  InventoryId', invId, '-> NOT FOUND')
      }
    }
  }
  console.log('\nResults: ' + found + ' found, ' + notFound + ' not found')
}

main().catch(console.error)
