#!/usr/bin/env node
/**
 * FAST Sync Script: Orders + Shipments (Batch Optimized)
 *
 * API Version: 2025-07 (updated Nov 2025)
 *
 * Key optimizations over sync-orders-shipments.js:
 * 1. Batch upserts (500 records at a time) - reduces API calls from 60K to ~120
 * 2. Failed record tracking - saves to JSON for retry
 * 3. Date-range parameters for parallel workers
 * 4. Header-based pagination (total-pages, total-count)
 *
 * Usage:
 *   node sync-orders-fast.js                           # Last 7 days (default)
 *   node sync-orders-fast.js --days=30                 # Last 30 days
 *   node sync-orders-fast.js --all                     # Full 2-year backfill
 *   node sync-orders-fast.js --start=2024-01-01 --end=2024-03-31  # Date range
 *   node sync-orders-fast.js --client=methyl-life      # Different client
 *   node sync-orders-fast.js --retry                   # Retry failed records
 */
require('dotenv').config({ path: '.env.local' })
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN

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

// Batch size for upserts (Supabase handles up to 1000, but 500 is safer)
const BATCH_SIZE = 500

// Track failed records for retry
const failedRecords = {
  orders: [],
  shipments: [],
  orderItems: [],
  shipmentItems: [],
  cartons: [],
  transactions: []
}

// DIM weight divisors by route
const getDimDivisor = (originCountry, destCountry, actualWeightOz) => {
  if (originCountry === 'AU' || destCountry === 'AU') return 110
  if (originCountry === 'US' && destCountry === 'US') {
    return actualWeightOz >= 16 ? 166 : null
  }
  return 139
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    clientKey: 'henson',
    daysBack: 7,
    startDate: null,
    endDate: null,
    retryMode: false
  }

  for (const arg of args) {
    if (arg === '--all') config.daysBack = 730
    else if (arg === '--retry') config.retryMode = true
    else if (arg.startsWith('--days=')) config.daysBack = parseInt(arg.split('=')[1], 10)
    else if (arg.startsWith('--start=')) config.startDate = new Date(arg.split('=')[1])
    else if (arg.startsWith('--end=')) config.endDate = new Date(arg.split('=')[1])
    else if (arg.startsWith('--client=')) config.clientKey = arg.split('=')[1]
  }

  // If explicit dates provided, use them
  if (!config.startDate) {
    config.startDate = new Date()
    config.startDate.setDate(config.startDate.getDate() - config.daysBack)
  }
  if (!config.endDate) {
    config.endDate = new Date()
  }

  return config
}

// Batch upsert helper - returns count of successful upserts
async function batchUpsert(table, records, onConflict) {
  if (records.length === 0) return { success: 0, failed: [] }

  let successCount = 0
  const failedIds = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false })

    if (error) {
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1} error: ${error.message}`)
      // Track all records in failed batch for retry
      failedIds.push(...batch.map(r => r.shipbob_order_id || r.shipment_id || r.order_id))
    } else {
      successCount += batch.length
    }

    // Progress indicator for large syncs
    if (records.length > 1000 && (i + BATCH_SIZE) % 5000 === 0) {
      console.log(`    Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`)
    }
  }

  return { success: successCount, failed: failedIds }
}

// Batch insert helper (for tables using delete+insert pattern)
async function batchInsert(table, records) {
  if (records.length === 0) return { success: 0, failed: [] }

  let successCount = 0
  const failedIds = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    const { error } = await supabase.from(table).insert(batch)

    if (error) {
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1} error: ${error.message}`)
      failedIds.push(...batch.map(r => r.shipment_id))
    } else {
      successCount += batch.length
    }
  }

  return { success: successCount, failed: failedIds }
}

// Save failed records to file for retry
function saveFailedRecords(clientId) {
  const totalFailed = Object.values(failedRecords).flat().length
  if (totalFailed === 0) {
    console.log('\nNo failed records to save.')
    return
  }

  const filename = `failed-records-${clientId.slice(0,8)}-${Date.now()}.json`
  const filepath = path.join(__dirname, filename)

  fs.writeFileSync(filepath, JSON.stringify({
    timestamp: new Date().toISOString(),
    clientId,
    counts: {
      orders: failedRecords.orders.length,
      shipments: failedRecords.shipments.length,
      orderItems: failedRecords.orderItems.length,
      shipmentItems: failedRecords.shipmentItems.length,
      cartons: failedRecords.cartons.length,
      transactions: failedRecords.transactions.length
    },
    records: failedRecords
  }, null, 2))

  console.log(`\nSaved ${totalFailed} failed record IDs to: ${filename}`)
}

async function syncOrdersAndShipments() {
  const config = parseArgs()

  console.log('=== FAST SYNC: ORDERS + SHIPMENTS ===')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Batch size: ${BATCH_SIZE} records`)
  console.log()

  // Get client info
  let clientId = CLIENTS[config.clientKey]?.id
  let merchantId = CLIENTS[config.clientKey]?.merchant_id
  if (!clientId) {
    // Look up from database
    const { data: client } = await supabase
      .from('clients')
      .select('id, merchant_id')
      .ilike('name', `%${config.clientKey}%`)
      .single()

    if (!client) {
      console.log(`ERROR: Client "${config.clientKey}" not found`)
      return
    }
    clientId = client.id
    merchantId = client.merchant_id
  }

  console.log(`Client: ${config.clientKey} (${clientId}, merchant: ${merchantId})`)
  console.log(`Date range: ${config.startDate.toISOString().split('T')[0]} to ${config.endDate.toISOString().split('T')[0]}`)
  console.log()

  // Get client API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .single()

  if (!creds) {
    console.log('ERROR: Client credentials not found')
    return
  }

  // Build FC lookup
  console.log('Building lookups...')
  const { data: fcList } = await supabase.from('fulfillment_centers').select('fc_id, name, country')
  const fcLookup = {}
  for (const fc of fcList || []) {
    fcLookup[fc.name] = { fc_id: fc.fc_id, country: fc.country }
    const shortName = fc.name.split(' ')[0]
    if (!fcLookup[shortName]) fcLookup[shortName] = { fc_id: fc.fc_id, country: fc.country }
  }

  // Build ship_option_id lookup (2025-07 API uses hyphenated endpoint)
  const methodsRes = await fetch('https://api.shipbob.com/2025-07/shipping-method', {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const methods = await methodsRes.json()
  const shipOptionLookup = {}
  for (const method of methods) {
    const name = method.service_level?.name?.trim()
    const id = method.service_level?.id
    if (name && id) {
      shipOptionLookup[name] = id
      shipOptionLookup[name.toLowerCase().replace(/\s+/g, '')] = id
    }
  }
  const manualMappings = { 'Ground': 3, '1 Day': 8, '2 Day': 9 }
  const getShipOptionId = (shipOption) => {
    if (!shipOption) return null
    if (shipOptionLookup[shipOption]) return shipOptionLookup[shipOption]
    const normalized = shipOption.toLowerCase().replace(/\s+/g, '')
    if (shipOptionLookup[normalized]) return shipOptionLookup[normalized]
    return manualMappings[shipOption] || null
  }

  // Build channel lookup (channel_id -> application_name) from Channels API
  // This gives us the actual platform type (Shopify, Amazon, etc.)
  const channelsRes = await fetch('https://api.shipbob.com/1.0/channel', {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const channels = await channelsRes.json()
  const channelLookup = {}
  for (const channel of channels || []) {
    if (channel.id && channel.application_name) {
      channelLookup[channel.id] = channel.application_name
    }
  }

  console.log(`  ${Object.keys(fcLookup).length} FC mappings, ${Object.keys(shipOptionLookup).length / 2} service levels, ${Object.keys(channelLookup).length} channels`)
  console.log()

  // ============================================
  // STEP 1: Fetch all orders from API (2025-07 API)
  // ============================================
  console.log('--- STEP 1: Fetching Orders from API (2025-07) ---')

  let apiOrders = []
  let page = 1
  let totalPages = null
  const startTime = Date.now()

  while (true) {
    const params = new URLSearchParams({
      StartDate: config.startDate.toISOString(),
      EndDate: config.endDate.toISOString(),
      Limit: '250',
      Page: page.toString()
    })

    const response = await fetch(`https://api.shipbob.com/2025-07/order?${params}`, {
      headers: { 'Authorization': `Bearer ${creds.api_token}` }
    })

    // 2025-07 API provides pagination info in headers
    if (totalPages === null) {
      totalPages = parseInt(response.headers.get('total-pages')) || null
      const totalCount = response.headers.get('total-count')
      if (totalCount) console.log(`  Total orders to fetch: ${totalCount}`)
    }

    const orders = await response.json()

    if (page % 10 === 0 || page === totalPages) {
      console.log(`  Page ${page}${totalPages ? '/' + totalPages : ''}: ${apiOrders.length + orders.length} total orders`)
    }

    if (!Array.isArray(orders) || orders.length === 0) break
    apiOrders.push(...orders)

    // Use header-based pagination if available, fallback to array length check
    if (totalPages && page >= totalPages) break
    if (!totalPages && orders.length < 250) break
    page++
  }

  const fetchTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\nFetched ${apiOrders.length} orders in ${fetchTime}s`)
  console.log()

  // ============================================
  // STEP 2: Batch Upsert Orders
  // ============================================
  console.log('--- STEP 2: Upserting Orders (batched) ---')

  const orderRecords = apiOrders.map(order => ({
    client_id: clientId,
    merchant_id: merchantId,
    shipbob_order_id: order.id.toString(),
    store_order_id: order.order_number || null,
    customer_name: order.recipient?.name || null,
    order_import_date: order.created_date || null,
    status: order.status || null,
    address1: order.recipient?.address?.address1 || null,
    address2: order.recipient?.address?.address2 || null,
    company_name: order.recipient?.address?.company_name || null,
    customer_email: order.recipient?.email || null,
    customer_phone: order.recipient?.phone_number || null,
    zip_code: order.recipient?.address?.zip_code || null,
    city: order.recipient?.address?.city || null,
    state: order.recipient?.address?.state || null,
    country: order.recipient?.address?.country || null,
    total_shipments: order.shipments?.length || 0,
    order_type: order.type || null,
    channel_id: order.channel?.id || null,
    channel_name: order.channel?.name || null,
    application_name: order.channel?.id ? (channelLookup[order.channel.id] || null) : null,
    reference_id: order.reference_id || null,
    shipping_method: order.shipping_method || null,
    purchase_date: order.purchase_date || null,
    total_price: order.financials?.total_price || null,
    gift_message: order.gift_message || null,
    carrier_type: order.carrier?.type || null,
    payment_term: order.carrier?.payment_term || null,
    updated_at: new Date().toISOString()
  }))

  const orderResult = await batchUpsert('orders', orderRecords, 'client_id,shipbob_order_id')
  failedRecords.orders = orderResult.failed
  console.log(`Orders upserted: ${orderResult.success}/${orderRecords.length}`)

  // Build order ID map (need to fetch UUIDs for order_id FK)
  console.log('\nBuilding order ID map...')
  const shipbobOrderIds = apiOrders.map(o => o.id.toString())
  const orderIdMap = {}

  // Fetch in batches
  for (let i = 0; i < shipbobOrderIds.length; i += 1000) {
    const batch = shipbobOrderIds.slice(i, i + 1000)
    const { data: orderRows } = await supabase
      .from('orders')
      .select('id, shipbob_order_id')
      .eq('client_id', clientId)
      .in('shipbob_order_id', batch)

    for (const row of orderRows || []) {
      orderIdMap[row.shipbob_order_id] = row.id
    }
  }
  console.log(`  Mapped ${Object.keys(orderIdMap).length} order IDs`)
  console.log()

  // ============================================
  // STEP 3: Batch Upsert Shipments
  // ============================================
  console.log('--- STEP 3: Upserting Shipments (batched) ---')

  const shipmentRecords = []
  const shipmentIds = []

  for (const order of apiOrders) {
    if (!order.shipments || order.shipments.length === 0) continue

    const orderId = orderIdMap[order.id.toString()]
    if (!orderId) continue

    for (const shipment of order.shipments) {
      const length = shipment.measurements?.length_in || 0
      const width = shipment.measurements?.width_in || 0
      const height = shipment.measurements?.depth_in || 0
      const actualWeight = shipment.measurements?.total_weight_oz || 0

      const fcName = shipment.location?.name || null
      const fcInfo = fcName ? (fcLookup[fcName] || fcLookup[fcName?.split(' ')[0]]) : null
      const originCountry = fcInfo?.country || 'US'
      const destCountry = order.recipient?.address?.country || 'US'

      let dimWeight = null
      let billableWeight = actualWeight
      const dimDivisor = getDimDivisor(originCountry, destCountry, actualWeight)
      if (dimDivisor && length > 0 && width > 0 && height > 0) {
        dimWeight = Math.round((length * width * height) / dimDivisor * 16)
        billableWeight = Math.max(actualWeight, dimWeight)
      }

      const shippedTimestamp = shipment.actual_fulfillment_date || null
      const deliveredTimestamp = shipment.delivery_date || null
      let transitTimeDays = null
      if (shippedTimestamp && deliveredTimestamp) {
        const diffMs = new Date(deliveredTimestamp) - new Date(shippedTimestamp)
        transitTimeDays = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
      }

      shipmentRecords.push({
        client_id: clientId,
        merchant_id: merchantId,
        order_id: orderId,
        shipment_id: shipment.id.toString(),
        shipbob_order_id: order.id.toString(),
        tracking_id: shipment.tracking?.tracking_number || null,
        tracking_url: shipment.tracking?.tracking_url || null,
        status: shipment.status || null,
        recipient_name: shipment.recipient?.name || shipment.recipient?.full_name || null,
        recipient_email: shipment.recipient?.email || null,
        recipient_phone: shipment.recipient?.phone_number || null,
        label_generation_date: shipment.created_date || null,
        shipped_date: shippedTimestamp,
        delivered_date: deliveredTimestamp,
        transit_time_days: transitTimeDays,
        carrier: shipment.tracking?.carrier || null,
        carrier_service: shipment.ship_option || null,
        ship_option_id: getShipOptionId(shipment.ship_option),
        zone_used: shipment.zone?.id || null,
        fc_name: fcName,
        fc_id: fcInfo?.fc_id || null,
        actual_weight_oz: actualWeight || null,
        dim_weight_oz: dimWeight,
        billable_weight_oz: billableWeight || null,
        length: length || null,
        width: width || null,
        height: height || null,
        insurance_value: shipment.insurance_value || null,
        estimated_fulfillment_date: shipment.estimated_fulfillment_date || null,
        estimated_fulfillment_date_status: shipment.estimated_fulfillment_date_status || null,
        last_update_at: shipment.last_update_at || null,
        last_tracking_update_at: shipment.tracking?.last_update_at || null,
        package_material_type: shipment.package_material_type || null,
        require_signature: shipment.require_signature || false,
        gift_message: shipment.gift_message || null,
        invoice_amount: shipment.invoice?.amount || null,
        invoice_currency_code: shipment.invoice?.currency_code || null,
        tracking_bol: shipment.tracking?.bol || null,
        tracking_pro_number: shipment.tracking?.pro_number || null,
        tracking_scac: shipment.tracking?.scac || null,
        origin_country: originCountry,
        destination_country: destCountry,
        status_details: shipment.status_details || null,
        updated_at: new Date().toISOString()
      })

      shipmentIds.push(shipment.id.toString())
    }
  }

  const shipmentResult = await batchUpsert('shipments', shipmentRecords, 'shipment_id')
  failedRecords.shipments = shipmentResult.failed
  console.log(`Shipments upserted: ${shipmentResult.success}/${shipmentRecords.length}`)
  console.log()

  // ============================================
  // STEP 4: Batch Upsert Order Items
  // ============================================
  console.log('--- STEP 4: Upserting Order Items (batched) ---')

  const orderItemRecords = []
  for (const order of apiOrders) {
    if (!order.products || order.products.length === 0) continue
    const orderId = orderIdMap[order.id.toString()]
    if (!orderId) continue

    for (const product of order.products) {
      orderItemRecords.push({
        client_id: clientId,
        merchant_id: merchantId,
        order_id: orderId,
        shipbob_product_id: product.id || null,
        sku: product.sku || null,
        reference_id: product.reference_id || null,
        name: product.name || null,
        quantity: product.quantity || null,
        unit_price: product.unit_price || null,
        gtin: product.gtin || null,
        upc: product.upc || null,
        external_line_id: product.external_line_id || null,
        quantity_unit_of_measure_code: product.quantity_unit_of_measure_code || null
      })
    }
  }

  const orderItemResult = await batchUpsert('order_items', orderItemRecords, 'order_id,shipbob_product_id')
  failedRecords.orderItems = orderItemResult.failed
  console.log(`Order items upserted: ${orderItemResult.success}/${orderItemRecords.length}`)
  console.log()

  // ============================================
  // STEP 5: Batch Insert Shipment Items (delete+insert)
  // ============================================
  console.log('--- STEP 5: Syncing Shipment Items (delete+insert batched) ---')

  // Batch delete existing shipment items
  console.log('  Deleting existing shipment items...')
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batch = shipmentIds.slice(i, i + 500)
    await supabase.from('shipment_items').delete().in('shipment_id', batch)
  }

  const shipmentItemRecords = []
  for (const order of apiOrders) {
    if (!order.shipments) continue

    for (const shipment of order.shipments) {
      if (!shipment.products || shipment.products.length === 0) continue

      for (const product of shipment.products) {
        const inventories = product.inventory || [{}]

        for (const inv of inventories) {
          shipmentItemRecords.push({
            client_id: clientId,
            merchant_id: merchantId,
            shipment_id: shipment.id.toString(),
            shipbob_product_id: product.id || null,
            sku: product.sku || null,
            reference_id: product.reference_id || null,
            name: product.name || null,
            inventory_id: inv.id || null,
            lot: inv.lot || null,
            expiration_date: inv.expiration_date || null,
            quantity: inv.quantity || product.quantity || null,
            quantity_committed: inv.quantity_committed || null,
            is_dangerous_goods: product.is_dangerous_goods || false,
            serial_numbers: inv.serial_numbers ? JSON.stringify(inv.serial_numbers) : null
          })
        }
      }
    }
  }

  const shipmentItemResult = await batchInsert('shipment_items', shipmentItemRecords)
  failedRecords.shipmentItems = shipmentItemResult.failed
  console.log(`Shipment items inserted: ${shipmentItemResult.success}/${shipmentItemRecords.length}`)
  console.log()

  // ============================================
  // STEP 6: Batch Insert Shipment Cartons (delete+insert)
  // ============================================
  console.log('--- STEP 6: Syncing Shipment Cartons (delete+insert batched) ---')

  // Batch delete existing cartons
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batch = shipmentIds.slice(i, i + 500)
    await supabase.from('shipment_cartons').delete().in('shipment_id', batch)
  }

  const cartonRecords = []
  for (const order of apiOrders) {
    if (!order.shipments) continue

    for (const shipment of order.shipments) {
      if (!shipment.parent_cartons || shipment.parent_cartons.length === 0) continue

      for (const carton of shipment.parent_cartons) {
        cartonRecords.push({
          client_id: clientId,
          merchant_id: merchantId,
          shipment_id: shipment.id.toString(),
          carton_id: carton.id || null,
          barcode: carton.barcode || null,
          carton_type: carton.type || null,
          parent_barcode: carton.parent_carton_barcode || null,
          length_in: carton.measurements?.length_in || null,
          width_in: carton.measurements?.width_in || null,
          depth_in: carton.measurements?.depth_in || null,
          weight_oz: carton.measurements?.weight_oz || null,
          contents: carton.products ? JSON.stringify(carton.products) : null
        })
      }
    }
  }

  const cartonResult = await batchInsert('shipment_cartons', cartonRecords)
  failedRecords.cartons = cartonResult.failed
  console.log(`Shipment cartons inserted: ${cartonResult.success}/${cartonRecords.length}`)
  console.log()

  // ============================================
  // STEP 7: Fetch and Batch Upsert Transactions
  // ============================================
  console.log('--- STEP 7: Fetching Transactions ---')

  const apiTransactions = []
  for (let i = 0; i < shipmentIds.length; i += 100) {
    const batch = shipmentIds.slice(i, i + 100)
    try {
      const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${parentToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_ids: batch, page_size: 1000 })
      })
      const data = await response.json()
      const items = data.items || []
      apiTransactions.push(...items)

      if ((i + 100) % 500 === 0) {
        console.log(`  Progress: ${Math.min(i + 100, shipmentIds.length)}/${shipmentIds.length} shipments queried, ${apiTransactions.length} transactions`)
      }
    } catch (e) {
      console.log(`  Transaction batch error at ${i}: ${e.message}`)
    }
  }

  console.log(`\nTotal transactions fetched: ${apiTransactions.length}`)

  console.log('\n--- STEP 8: Upserting Transactions (batched) ---')

  const txRecords = apiTransactions.map(tx => ({
    transaction_id: tx.transaction_id,
    client_id: clientId,
    merchant_id: merchantId,
    reference_id: tx.reference_id,
    reference_type: tx.reference_type,
    transaction_fee: tx.transaction_fee,
    amount: tx.amount,
    charge_date: tx.charge_date,
    invoiced_status: tx.invoiced_status || false,
    invoice_id: tx.invoice_id || null,
    fulfillment_center: tx.fulfillment_center || null,
    additional_details: tx.additional_details || null,
    created_at: new Date().toISOString()
  }))

  const txResult = await batchUpsert('transactions', txRecords, 'transaction_id')
  failedRecords.transactions = txResult.failed
  console.log(`Transactions upserted: ${txResult.success}/${txRecords.length}`)

  // ============================================
  // VERIFICATION
  // ============================================
  console.log('\n========================================')
  console.log('VERIFICATION')
  console.log('========================================\n')

  const counts = {}
  for (const table of ['orders', 'shipments', 'order_items', 'shipment_items', 'shipment_cartons', 'transactions']) {
    const { count } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
    counts[table] = count
  }

  console.log('COUNTS IN DB:')
  console.log(`  Orders:           ${counts.orders}`)
  console.log(`  Shipments:        ${counts.shipments}`)
  console.log(`  Order items:      ${counts.order_items}`)
  console.log(`  Shipment items:   ${counts.shipment_items}`)
  console.log(`  Shipment cartons: ${counts.shipment_cartons}`)
  console.log(`  Transactions:     ${counts.transactions}`)

  console.log('\nTHIS SYNC:')
  console.log(`  Orders:           ${orderResult.success}/${orderRecords.length}`)
  console.log(`  Shipments:        ${shipmentResult.success}/${shipmentRecords.length}`)
  console.log(`  Order items:      ${orderItemResult.success}/${orderItemRecords.length}`)
  console.log(`  Shipment items:   ${shipmentItemResult.success}/${shipmentItemRecords.length}`)
  console.log(`  Cartons:          ${cartonResult.success}/${cartonRecords.length}`)
  console.log(`  Transactions:     ${txResult.success}/${txRecords.length}`)

  // Save failed records if any
  saveFailedRecords(clientId)

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`\n========================================`)
  console.log(`SYNC COMPLETE in ${totalTime} minutes`)
  console.log('========================================')
}

syncOrdersAndShipments().catch(console.error)
