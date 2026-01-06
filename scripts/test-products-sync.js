#!/usr/bin/env node
/**
 * Test script for products sync
 * Run with: node scripts/test-products-sync.js
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testProductsSync() {
  console.log('=== Products Sync Test ===\n')

  // 1. Get clients with tokens
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  if (clientsError) {
    console.error('Failed to fetch clients:', clientsError)
    return
  }

  console.log(`Found ${clients.length} active clients\n`)

  // 2. Test fetching products for each client
  for (const client of clients) {
    const creds = client.client_api_credentials
    const token = creds?.find(c => c.provider === 'shipbob')?.api_token

    if (!token) {
      console.log(`${client.company_name}: No ShipBob token, skipping`)
      continue
    }

    console.log(`\n--- ${client.company_name} ---`)

    try {
      // Fetch products from ShipBob API (2025-07 includes variants!)
      const response = await fetch('https://api.shipbob.com/2025-07/product?Limit=250', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      })

      if (!response.ok) {
        console.log(`API Error: ${response.status} ${response.statusText}`)
        continue
      }

      const data = await response.json()
      // 2025-07 API returns { items: [...] } for paginated response
      const products = data.items || data
      console.log(`Found ${products.length} products from API`)

      // Check first product structure
      if (products.length > 0) {
        const firstProduct = products[0]
        console.log(`First product: id=${firstProduct.id}, name="${firstProduct.name}"`)

        if (firstProduct.variants && firstProduct.variants.length > 0) {
          const variant = firstProduct.variants[0]
          console.log(`  First variant: sku="${variant.sku}", inventory_id=${variant.inventory?.inventory_id}`)
        } else {
          console.log('  No variants!')
        }
      }

      // Count how many variants have inventory_id
      let variantsWithInventory = 0
      let totalVariants = 0
      for (const p of products) {
        if (p.variants) {
          for (const v of p.variants) {
            totalVariants++
            if (v.inventory?.inventory_id) {
              variantsWithInventory++
            }
          }
        }
      }
      console.log(`Variants with inventory_id: ${variantsWithInventory}/${totalVariants}`)

      // Upsert products
      const now = new Date().toISOString()
      const records = products.map(p => ({
        client_id: client.id,
        merchant_id: client.merchant_id || null,
        shipbob_product_id: p.id,
        name: p.name || '',
        type: p.type || null,
        taxonomy: p.taxonomy?.name || null,
        variants: p.variants || null,
        created_on: p.created_date || null,
        updated_on: null,
        synced_at: now,
      }))

      // Upsert in batches
      let upserted = 0
      const batchSize = 100
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize)
        const { error: upsertError } = await supabase
          .from('products')
          .upsert(batch, { onConflict: 'client_id,shipbob_product_id' })

        if (upsertError) {
          console.log(`Upsert error: ${upsertError.message}`)
        } else {
          upserted += batch.length
        }
      }
      console.log(`Upserted ${upserted} products`)

    } catch (e) {
      console.log(`Error: ${e.message}`)
    }
  }

  // 3. Check unattributed storage transactions
  console.log('\n\n=== Storage Attribution ===\n')

  // Build inventory lookup
  const { data: products } = await supabase
    .from('products')
    .select('client_id, variants')
    .not('variants', 'is', null)

  const inventoryLookup = {}
  for (const p of products || []) {
    if (p.client_id && Array.isArray(p.variants)) {
      for (const variant of p.variants) {
        const invId = variant?.inventory?.inventory_id
        if (invId) {
          inventoryLookup[String(invId)] = p.client_id
        }
      }
    }
  }

  console.log(`Built inventory lookup with ${Object.keys(inventoryLookup).length} inventory IDs`)

  // Find unattributed storage transactions
  const { data: unattributed } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, additional_details')
    .eq('reference_type', 'FC')
    .is('client_id', null)
    .limit(100)

  console.log(`Found ${unattributed?.length || 0} unattributed storage transactions`)

  // Try to match
  let matched = 0
  let unmatched = 0
  const unmatchedIds = []

  for (const tx of unattributed || []) {
    let inventoryId = null

    if (tx.reference_id) {
      const parts = tx.reference_id.split('-')
      if (parts.length >= 2) {
        inventoryId = parts[1]
      }
    }

    if (!inventoryId && tx.additional_details?.InventoryId) {
      inventoryId = String(tx.additional_details.InventoryId)
    }

    if (inventoryId && inventoryLookup[inventoryId]) {
      matched++
    } else {
      unmatched++
      if (inventoryId && unmatchedIds.length < 5) {
        unmatchedIds.push(inventoryId)
      }
    }
  }

  console.log(`Matched: ${matched}, Unmatched: ${unmatched}`)
  if (unmatchedIds.length > 0) {
    console.log(`Sample unmatched inventory IDs: ${unmatchedIds.join(', ')}`)
  }

  // Actually attribute
  if (matched > 0) {
    console.log('\nAttributing matched transactions...')
    let attributed = 0
    for (const tx of unattributed || []) {
      let inventoryId = null
      if (tx.reference_id) {
        const parts = tx.reference_id.split('-')
        if (parts.length >= 2) inventoryId = parts[1]
      }
      if (!inventoryId && tx.additional_details?.InventoryId) {
        inventoryId = String(tx.additional_details.InventoryId)
      }

      if (inventoryId && inventoryLookup[inventoryId]) {
        const { error } = await supabase
          .from('transactions')
          .update({ client_id: inventoryLookup[inventoryId] })
          .eq('transaction_id', tx.transaction_id)

        if (!error) attributed++
      }
    }
    console.log(`Attributed ${attributed} transactions`)
  }

  console.log('\n=== Done ===')
}

testProductsSync().catch(console.error)
