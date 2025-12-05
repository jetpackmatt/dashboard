#!/usr/bin/env node
/**
 * Explore how to link Storage transactions to clients
 *
 * Storage reference_id format: {FC_ID}-{InventoryID}-{LocationType}
 * Need to find: InventoryID → Product → Client
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const token = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    return { error: response.status + ' ' + response.statusText }
  }
  return response.json()
}

async function main() {
  console.log('='.repeat(100))
  console.log('STORAGE TRANSACTION → CLIENT LINKAGE')
  console.log('='.repeat(100))

  // Get a sample storage transaction reference_id
  const sampleRefIds = [
    '182-21286548-Shelf',
    '182-20777249-Shelf',
    '182-20777218-Shelf'
  ]

  // ============================================================
  // APPROACH 1: Try Inventory API with InventoryID
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 1: INVENTORY API')
  console.log('█'.repeat(100))

  for (const refId of sampleRefIds) {
    const parts = refId.split('-')
    const fcId = parts[0]
    const inventoryId = parts[1]
    const locationType = parts[2]

    console.log('\nReference: ' + refId)
    console.log('  FC ID: ' + fcId)
    console.log('  Inventory ID: ' + inventoryId)
    console.log('  Location Type: ' + locationType)

    // Try GET /inventory/{id}
    console.log('\n  Trying GET /inventory/' + inventoryId + '...')
    const invData = await fetchJson(API_BASE + '/inventory/' + inventoryId)

    if (invData.error) {
      console.log('    Error: ' + invData.error)
    } else {
      console.log('    Response:')
      console.log(JSON.stringify(invData, null, 4))
    }
  }

  // ============================================================
  // APPROACH 2: List Products and find matching inventory
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 2: PRODUCTS API - LIST ALL')
  console.log('█'.repeat(100))

  const productsData = await fetchJson(API_BASE + '/product?Limit=50')
  const products = productsData.items || productsData || []

  console.log('\nFound ' + products.length + ' products')

  // Look for inventory IDs in products
  const inventoryMap = {}
  for (const product of products) {
    console.log('\nProduct: ' + product.name + ' (ID: ' + product.id + ')')
    console.log('  user_id: ' + product.user_id)

    for (const variant of (product.variants || [])) {
      const invId = variant.inventory?.inventory_id
      if (invId) {
        console.log('  Variant: ' + variant.name + ' → inventory_id: ' + invId)
        inventoryMap[invId.toString()] = {
          product_id: product.id,
          product_name: product.name,
          user_id: product.user_id,
          sku: variant.sku
        }
      }
    }
  }

  // Check if our sample inventory IDs are in the map
  console.log('\n--- Checking sample inventory IDs against product map ---')
  for (const refId of sampleRefIds) {
    const inventoryId = refId.split('-')[1]
    const match = inventoryMap[inventoryId]
    if (match) {
      console.log('\n✅ ' + refId + ' matches:')
      console.log('   Product: ' + match.product_name)
      console.log('   user_id: ' + match.user_id)
      console.log('   SKU: ' + match.sku)
    } else {
      console.log('\n❌ ' + refId + ' - inventory_id ' + inventoryId + ' not found in products')
    }
  }

  // ============================================================
  // APPROACH 3: Check if user_id maps to our clients
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 3: USER_ID → CLIENT MAPPING')
  console.log('█'.repeat(100))

  // Get unique user_ids from products
  const userIds = [...new Set(products.map(p => p.user_id))]
  console.log('\nUnique user_ids in products: ' + userIds.join(', '))

  // Check our clients table for these user_ids
  // Note: clients table doesn't have shipbob_user_id column based on earlier check
  // Let's check if we have a mapping somewhere

  const { data: clients } = await supabase.from('clients').select('*')
  console.log('\nClients in database:')
  for (const client of (clients || [])) {
    console.log('  ' + client.company_name + ': merchant_id = ' + client.merchant_id)
  }

  // ============================================================
  // APPROACH 4: Per-client storage sync strategy
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 4: PER-CLIENT STORAGE SYNC')
  console.log('█'.repeat(100))

  console.log('\nSince Storage transactions use reference_type = "FC" and reference_id includes InventoryID,')
  console.log('and we saw earlier that syncing per-client gives us client_id automatically...')
  console.log('')
  console.log('STRATEGY: When syncing storage transactions using client-specific tokens,')
  console.log('the transactions returned will only be for that specific client inventory.')
  console.log('')
  console.log('This means:')
  console.log('1. Use child token to call POST /transactions:query')
  console.log('2. Filter for transaction_fee = "Warehousing Fee"')
  console.log('3. All returned transactions belong to that client')
  console.log('4. Store with client_id = the client being synced')
  console.log('')
  console.log('No need to look up InventoryID → Product → Client!')

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('STORAGE & RETURNS LINKAGE SUMMARY')
  console.log('█'.repeat(100))

  console.log(`
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ TRANSACTION TYPE    │ reference_type │ reference_id         │ CLIENT LINKAGE STRATEGY            │
├─────────────────────┼────────────────┼──────────────────────┼────────────────────────────────────┤
│ Shipments/Pick      │ Shipment       │ Shipment ID          │ transactions.client_id (per-client │
│                     │                │                      │ sync) OR JOIN shipments.client_id  │
├─────────────────────┼────────────────┼──────────────────────┼────────────────────────────────────┤
│ Credits             │ Default        │ Shipment ID          │ transactions.client_id OR JOIN     │
│                     │                │                      │ shipments.client_id                │
├─────────────────────┼────────────────┼──────────────────────┼────────────────────────────────────┤
│ WRO/Receiving       │ WRO            │ WRO ID               │ transactions.client_id             │
│                     │                │                      │ (per-client sync)                  │
├─────────────────────┼────────────────┼──────────────────────┼────────────────────────────────────┤
│ Storage (Warehouse) │ FC             │ FC-InventoryID-Loc   │ transactions.client_id             │
│                     │                │                      │ (per-client sync)                  │
├─────────────────────┼────────────────┼──────────────────────┼────────────────────────────────────┤
│ Returns             │ Return         │ Return ID            │ transactions.client_id (per-client │
│                     │                │ (Order in Comment)   │ sync) OR parse Order from Comment  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘

KEY INSIGHT:
===========
The per-client sync strategy using child tokens AUTOMATICALLY solves client attribution
for ALL transaction types, including Storage and Returns.

When we query POST /transactions:query with a client's token, we only get that client's
transactions. We don't need to decode reference_ids or look up inventory/products.

The client_id is implicit in the sync process itself!
`)
}

main().catch(console.error)
