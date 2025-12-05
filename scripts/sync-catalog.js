#!/usr/bin/env node
/**
 * Sync Script: Products, Returns, and Receiving (WROs) - 2025-07 API
 *
 * Syncs ShipBob API objects that support billing transaction details.
 * Uses 2025-07 API with cursor-based pagination for all endpoints.
 *
 * Endpoints (singular names):
 *   - /2025-07/product
 *   - /2025-07/return
 *   - /2025-07/receiving
 *
 * Usage:
 *   node sync-catalog.js                        # Sync all for default client (henson)
 *   node sync-catalog.js --client=methyl-life   # Sync for Methyl-Life
 *   node sync-catalog.js --type=products        # Sync only products
 *   node sync-catalog.js --type=returns         # Sync only returns
 *   node sync-catalog.js --type=receiving       # Sync only receiving/WROs
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Client configurations (merchant_id = ShipBob User ID)
const CLIENTS = {
  'henson': {
    id: '6b94c274-0446-4167-9d02-b998f8be59ad',
    merchant_id: '386350',
    name: 'Henson Shaving'
  },
  'methyl-life': {
    id: 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e',
    merchant_id: '392333',
    name: 'Methyl Life'
  }
}

const BATCH_SIZE = 500

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    clientKey: 'henson',
    syncType: 'all'  // 'all', 'products', 'returns', 'receiving'
  }

  for (const arg of args) {
    if (arg.startsWith('--client=')) config.clientKey = arg.split('=')[1]
    else if (arg.startsWith('--type=')) config.syncType = arg.split('=')[1]
  }

  return config
}

// Batch upsert helper
async function batchUpsert(table, records, onConflict) {
  if (records.length === 0) return { success: 0, failed: 0 }

  let successCount = 0
  let failedCount = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false })

    if (error) {
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1} error: ${error.message}`)
      failedCount += batch.length
    } else {
      successCount += batch.length
    }
  }

  return { success: successCount, failed: failedCount }
}

// Fetch all pages using cursor pagination (2025-07 API)
async function fetchAllPages(endpoint, token, limit = 250) {
  const allItems = []
  let cursor = null
  let page = 1

  while (true) {
    const url = new URL(`https://api.shipbob.com/2025-07/${endpoint}`)
    url.searchParams.set('Limit', limit.toString())
    if (cursor) url.searchParams.set('Cursor', cursor)

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!response.ok) {
      const text = await response.text()
      console.log(`  API Error (2025-07): ${response.status} - ${text}`)
      break
    }

    const data = await response.json()

    // 2025-07 returns { items: [...], first, prev, next, last }
    const items = data.items || data
    if (!Array.isArray(items) || items.length === 0) break

    allItems.push(...items)
    console.log(`  Page ${page}: ${allItems.length} total`)

    // Check for next cursor (don't use items.length < limit - some endpoints have smaller max page sizes)
    // The 'next' field may be a full URL path like "/Product?cursor=..." - extract just the cursor value
    if (data.next) {
      const nextUrl = new URL(data.next, 'https://api.shipbob.com')
      cursor = nextUrl.searchParams.get('cursor') || nextUrl.searchParams.get('Cursor')
    } else {
      cursor = null
    }
    if (!cursor) break
    page++
  }

  return allItems
}

// ============================================
// PRODUCTS SYNC (2025-07 API)
// ============================================
async function syncProducts(clientId, merchantId, token) {
  console.log('\n=== SYNCING PRODUCTS (2025-07 API) ===')

  // 2025-07 API uses "product" (singular)
  const allProducts = await fetchAllPages('product', token)
  console.log(`Fetched ${allProducts.length} products from API`)

  if (allProducts.length === 0) {
    console.log('No products to sync')
    return { success: 0, failed: 0 }
  }

  // Map to database records - store variants as JSONB
  const productRecords = allProducts.map(p => ({
    client_id: clientId,
    merchant_id: String(p.user_id || merchantId),  // API includes user_id!
    shipbob_product_id: p.id,
    name: p.name || null,
    type: p.type || null,
    taxonomy: p.taxonomy || null,
    variants: p.variants || null,  // Store entire variants array as JSONB
    created_on: p.created_on || null,
    updated_on: p.updated_on || null,
    synced_at: new Date().toISOString()
  }))

  const result = await batchUpsert('products', productRecords, 'client_id,shipbob_product_id')
  console.log(`Products upserted: ${result.success}/${productRecords.length}`)

  return result
}

// ============================================
// RETURNS SYNC (2025-07 API)
// ============================================
async function syncReturns(clientId, merchantId, token) {
  console.log('\n=== SYNCING RETURNS (2025-07 API) ===')

  // 2025-07 API uses "return" (singular)
  const allReturns = await fetchAllPages('return', token)
  console.log(`Fetched ${allReturns.length} returns from API`)

  if (allReturns.length === 0) {
    console.log('No returns to sync')
    return { success: 0, failed: 0 }
  }

  // Map to database records - store inventory and status_history as JSONB
  const returnRecords = allReturns.map(r => ({
    client_id: clientId,
    merchant_id: merchantId,
    shipbob_return_id: r.id,
    reference_id: r.reference_id || null,
    status: r.status || null,
    return_type: r.return_type || null,
    tracking_number: r.tracking_number || null,
    shipment_tracking_number: r.shipment_tracking_number || null,
    original_shipment_id: r.original_shipment_id || null,
    store_order_id: r.store_order_id || null,
    customer_name: r.customer_name || null,
    invoice_amount: r.invoice?.amount || null,
    invoice_currency: r.invoice?.currency_code || 'USD',
    fc_id: r.fulfillment_center?.id || null,
    fc_name: r.fulfillment_center?.name || null,
    channel_id: r.channel?.id || null,
    channel_name: r.channel?.name || null,
    insert_date: r.insert_date || null,
    awaiting_arrival_date: r.awaiting_arrival_date || null,
    arrived_date: r.arrived_date || null,
    processing_date: r.processing_date || null,
    completed_date: r.completed_date || null,
    cancelled_date: r.cancelled_date || null,
    status_history: r.status_history || null,  // Store as JSONB
    inventory: r.inventory || null,  // Store as JSONB (includes sku in 2025-07!)
    synced_at: new Date().toISOString()
  }))

  const result = await batchUpsert('returns', returnRecords, 'shipbob_return_id')
  console.log(`Returns upserted: ${result.success}/${returnRecords.length}`)

  return result
}

// ============================================
// RECEIVING (WROs) SYNC (2025-07 API)
// ============================================
async function syncReceiving(clientId, merchantId, token) {
  console.log('\n=== SYNCING RECEIVING ORDERS (2025-07 API) ===')

  const allWROs = await fetchAllPages('receiving', token)
  console.log(`Fetched ${allWROs.length} WROs from API`)

  if (allWROs.length === 0) {
    console.log('No receiving orders to sync')
    return { success: 0, failed: 0 }
  }

  // Map to database records - store inventory_quantities and status_history as JSONB
  const wroRecords = allWROs.map(w => ({
    client_id: clientId,
    merchant_id: merchantId,
    shipbob_receiving_id: w.id,
    purchase_order_number: w.purchase_order_number || null,
    status: w.status || null,
    package_type: w.package_type || null,
    box_packaging_type: w.box_packaging_type || null,
    fc_id: w.fulfillment_center?.id || null,
    fc_name: w.fulfillment_center?.name || null,
    fc_timezone: w.fulfillment_center?.timezone || null,
    fc_address: w.fulfillment_center?.address1 || null,
    fc_city: w.fulfillment_center?.city || null,
    fc_state: w.fulfillment_center?.state || null,
    fc_country: w.fulfillment_center?.country || null,
    fc_zip: w.fulfillment_center?.zip_code || null,
    expected_arrival_date: w.expected_arrival_date || null,
    insert_date: w.insert_date || null,
    last_updated_date: w.last_updated_date || null,
    status_history: w.status_history || null,  // Store as JSONB
    inventory_quantities: w.inventory_quantities || null,  // Store as JSONB
    box_labels_uri: w.box_labels_uri || null,
    synced_at: new Date().toISOString()
  }))

  const result = await batchUpsert('receiving_orders', wroRecords, 'shipbob_receiving_id')
  console.log(`Receiving orders upserted: ${result.success}/${wroRecords.length}`)

  return result
}

// ============================================
// MAIN
// ============================================
async function main() {
  const config = parseArgs()

  console.log('=== CATALOG SYNC: PRODUCTS, RETURNS, RECEIVING ===')
  console.log('API Version: 2025-07')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Client: ${config.clientKey}`)
  console.log(`Sync type: ${config.syncType}`)
  console.log()

  // Get client info
  const clientConfig = CLIENTS[config.clientKey]
  if (!clientConfig) {
    console.log(`ERROR: Client "${config.clientKey}" not found`)
    process.exit(1)
  }

  const { id: clientId, merchant_id: merchantId, name: clientName } = clientConfig
  console.log(`Client: ${clientName} (${clientId}, merchant: ${merchantId})`)

  // Get client API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .single()

  if (!creds) {
    console.log('ERROR: Client credentials not found')
    process.exit(1)
  }

  const token = creds.api_token
  const startTime = Date.now()

  // Run syncs based on type
  const results = {}

  if (config.syncType === 'all' || config.syncType === 'products') {
    results.products = await syncProducts(clientId, merchantId, token)
  }

  if (config.syncType === 'all' || config.syncType === 'returns') {
    results.returns = await syncReturns(clientId, merchantId, token)
  }

  if (config.syncType === 'all' || config.syncType === 'receiving') {
    results.receiving = await syncReceiving(clientId, merchantId, token)
  }

  // Summary
  console.log('\n========================================')
  console.log('SYNC COMPLETE')
  console.log('========================================')

  for (const [type, result] of Object.entries(results)) {
    console.log(`${type}: ${result.success} records synced`)
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nTotal time: ${totalTime}s`)

  // Verification counts
  console.log('\n--- Database Counts ---')
  for (const table of ['products', 'returns', 'receiving_orders']) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
    console.log(`  ${table}: ${count}`)
  }
}

main().catch(console.error)
