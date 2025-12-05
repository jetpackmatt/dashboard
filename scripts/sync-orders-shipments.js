#!/usr/bin/env node
/**
 * Sync Script: Orders + Shipments (Comprehensive Schema)
 *
 * API Version: 2025-07 (updated Nov 2025)
 *
 * Syncs from ShipBob API to:
 * - orders: one record per order
 * - shipments: one record per shipment (FK to orders)
 * - order_items: products per order
 * - shipment_items: products per shipment with inventory details
 * - shipment_cartons: B2B pallets/cartons
 * - transactions: billing data per shipment
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// DIM weight divisors by route
// US Domestic: 166 (only for packages >= 1 lb / 16 oz)
// US to International: 139 (all packages)
// Australia (all): 110 (all packages)
// Canada/EU/UK (all): 139 (all packages)
const getDimDivisor = (originCountry, destCountry, actualWeightOz) => {
  // Australia uses 110
  if (originCountry === 'AU' || destCountry === 'AU') return 110

  // US Domestic: 166, but only for >= 1 lb
  if (originCountry === 'US' && destCountry === 'US') {
    return actualWeightOz >= 16 ? 166 : null  // No DIM for < 1 lb domestic
  }

  // All other routes: 139
  return 139
}

async function syncOrdersAndShipments() {
  console.log('=== SYNCING ORDERS + SHIPMENTS (COMPREHENSIVE SCHEMA) ===')
  console.log(`Timestamp: ${new Date().toISOString()}\n`)

  // Get client token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  if (!creds) {
    console.log('ERROR: Client credentials not found')
    return
  }

  // Build FC lookup from database
  console.log('Building fulfillment center lookup...')
  const { data: fcList } = await supabase.from('fulfillment_centers').select('fc_id, name, country')
  const fcLookup = {}
  for (const fc of fcList || []) {
    fcLookup[fc.name] = { fc_id: fc.fc_id, country: fc.country }
    // Also map by partial name for flexible matching
    const shortName = fc.name.split(' ')[0]
    if (!fcLookup[shortName]) fcLookup[shortName] = { fc_id: fc.fc_id, country: fc.country }
  }
  console.log(`  ${Object.keys(fcLookup).length} FC mappings loaded`)

  // Build ship_option_id lookup (2025-07 API uses hyphenated endpoint)
  console.log('Building ship_option_id lookup...')
  const methodsRes = await fetch('https://api.shipbob.com/2025-07/shipping-method', {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const methods = await methodsRes.json()

  const shipOptionLookup = {}
  for (const method of methods) {
    const serviceLevelName = method.service_level?.name?.trim()
    const serviceLevelId = method.service_level?.id
    if (serviceLevelName && serviceLevelId) {
      shipOptionLookup[serviceLevelName] = serviceLevelId
      shipOptionLookup[serviceLevelName.toLowerCase().replace(/\s+/g, '')] = serviceLevelId
    }
  }

  // Manual fallback mappings
  const manualMappings = {
    'Ground': 3,
    '1 Day': 8,
    '2 Day': 9,
  }

  const getShipOptionId = (shipOption) => {
    if (!shipOption) return null
    if (shipOptionLookup[shipOption]) return shipOptionLookup[shipOption]
    const normalized = shipOption.toLowerCase().replace(/\s+/g, '')
    if (shipOptionLookup[normalized]) return shipOptionLookup[normalized]
    return manualMappings[shipOption] || null
  }

  console.log(`Ship option lookup built: ${Object.keys(shipOptionLookup).length / 2} service levels`)

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
  console.log(`Channel lookup built: ${Object.keys(channelLookup).length} channels\n`)

  // Parse command line args for date range
  // Usage: node sync-orders-shipments.js [--days=N] [--all]
  const args = process.argv.slice(2)
  let daysBack = 7  // Default
  if (args.includes('--all')) {
    daysBack = 730  // ~2 years of history
    console.log('Mode: FULL HISTORICAL BACKFILL (2 years)')
  } else {
    const daysArg = args.find(a => a.startsWith('--days='))
    if (daysArg) {
      daysBack = parseInt(daysArg.split('=')[1], 10)
    }
  }

  // Date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (${daysBack} days)\n`)

  // ============================================
  // STEP 1: Fetch orders from API
  // ============================================
  console.log('--- STEP 1: Fetching Orders from API ---\n')

  let apiOrders = []
  let page = 1
  while (true) {
    const params = new URLSearchParams({
      StartDate: startDate.toISOString(),
      EndDate: endDate.toISOString(),
      Limit: '250',
      Page: page.toString()
    })
    const response = await fetch(`https://api.shipbob.com/2025-07/order?${params}`, {
      headers: { 'Authorization': `Bearer ${creds.api_token}` }
    })
    const orders = await response.json()
    console.log(`  Page ${page}: ${orders.length} orders`)
    if (orders.length === 0) break
    apiOrders.push(...orders)
    if (orders.length < 250) break
    page++
  }

  console.log(`\nTotal orders fetched: ${apiOrders.length}`)

  // ============================================
  // STEP 2: Upsert Orders
  // ============================================
  console.log('\n--- STEP 2: Upserting Orders ---\n')

  let ordersUpserted = 0
  let orderErrors = 0
  const orderIdMap = {} // shipbob_order_id -> orders.id (UUID)

  for (const order of apiOrders) {
    const orderData = {
      client_id: HENSON_ID,
      shipbob_order_id: order.id.toString(),
      store_order_id: order.order_number || null,
      customer_name: order.recipient?.name || null,
      order_import_date: order.created_date || null,  // Full timestamp for import-to-ship analysis
      status: order.status || null,
      // Address fields
      address1: order.recipient?.address?.address1 || null,
      address2: order.recipient?.address?.address2 || null,
      company_name: order.recipient?.address?.company_name || null,
      // Contact fields (for support/claims - subject to GDPR auto-deletion)
      customer_email: order.recipient?.email || null,
      customer_phone: order.recipient?.phone_number || null,
      zip_code: order.recipient?.address?.zip_code || null,
      city: order.recipient?.address?.city || null,
      state: order.recipient?.address?.state || null,
      country: order.recipient?.address?.country || null,
      total_shipments: order.shipments?.length || 0,
      // Order type and channel info
      order_type: order.type || null,                    // 'B2B' or 'DTC'
      channel_id: order.channel?.id || null,
      channel_name: order.channel?.name || null,
      application_name: order.channel?.id ? (channelLookup[order.channel.id] || null) : null,
      reference_id: order.reference_id || null,          // External order ID
      shipping_method: order.shipping_method || null,
      purchase_date: order.purchase_date || null,
      // Financials
      total_price: order.financials?.total_price || null,
      // B2B/Freight fields
      gift_message: order.gift_message || null,
      carrier_type: order.carrier?.type || null,           // 'Parcel' or 'Freight'
      payment_term: order.carrier?.payment_term || null,   // 'Collect' or 'Prepaid'
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('orders')
      .upsert(orderData, {
        onConflict: 'client_id,shipbob_order_id',
        ignoreDuplicates: false
      })
      .select('id')
      .single()

    if (error) {
      orderErrors++
      if (orderErrors <= 3) console.log(`  Order error: ${error.message}`)
    } else {
      ordersUpserted++
      orderIdMap[order.id.toString()] = data.id
    }
  }

  console.log(`Orders upserted: ${ordersUpserted}`)
  if (orderErrors > 0) console.log(`Order errors: ${orderErrors}`)

  // ============================================
  // STEP 3: Upsert Shipments
  // ============================================
  console.log('\n--- STEP 3: Upserting Shipments ---\n')

  let shipmentsUpserted = 0
  let shipmentErrors = 0
  const shipmentIds = []

  for (const order of apiOrders) {
    if (!order.shipments || order.shipments.length === 0) continue

    const orderId = orderIdMap[order.id.toString()]
    if (!orderId) {
      console.log(`  Warning: No order_id for shipbob_order ${order.id}`)
      continue
    }

    for (const shipment of order.shipments) {
      // Get measurements
      const length = shipment.measurements?.length_in || 0
      const width = shipment.measurements?.width_in || 0
      const height = shipment.measurements?.depth_in || 0
      const actualWeight = shipment.measurements?.total_weight_oz || 0

      // Determine origin country from FC and destination from order
      const fcName = shipment.location?.name || null
      const fcInfo = fcName ? (fcLookup[fcName] || fcLookup[fcName?.split(' ')[0]]) : null
      const originCountry = fcInfo?.country || 'US'  // Default to US if unknown
      const destCountry = order.recipient?.address?.country || 'US'

      // Calculate dim weight with country-specific divisor
      let dimWeight = null
      let billableWeight = actualWeight
      const dimDivisor = getDimDivisor(originCountry, destCountry, actualWeight)
      if (dimDivisor && length > 0 && width > 0 && height > 0) {
        // DIM weight in oz = (L x W x H in cubic inches) / divisor * 16 oz/lb
        dimWeight = Math.round((length * width * height) / dimDivisor * 16)
        billableWeight = Math.max(actualWeight, dimWeight)
      }

      // Parse dates for transit time calculation (preserve full timestamps)
      // IMPORTANT: actual_fulfillment_date is the SHIPPED date (when handed to carrier)
      // tracking.shipping_date is carrier's internal date (often null)
      const labelGenTimestamp = shipment.created_date || null
      const shippedTimestamp = shipment.actual_fulfillment_date || null
      const deliveredTimestamp = shipment.delivery_date || null

      // Calculate transit time in days with one decimal precision
      let transitTimeDays = null
      if (shippedTimestamp && deliveredTimestamp) {
        const shipped = new Date(shippedTimestamp)
        const delivered = new Date(deliveredTimestamp)
        const diffMs = delivered - shipped
        transitTimeDays = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10  // One decimal
      }

      const shipmentData = {
        client_id: HENSON_ID,
        order_id: orderId,
        shipment_id: shipment.id.toString(),
        shipbob_order_id: order.id.toString(),
        // Tracking fields
        tracking_id: shipment.tracking?.tracking_number || null,
        tracking_url: shipment.tracking?.tracking_url || null,
        status: shipment.status || null,
        // Recipient contact fields (for support/claims - subject to GDPR auto-deletion)
        recipient_name: shipment.recipient?.name || shipment.recipient?.full_name || null,
        recipient_email: shipment.recipient?.email || null,
        recipient_phone: shipment.recipient?.phone_number || null,
        // Date fields (full timestamps preserved for time-of-day analysis)
        label_generation_date: labelGenTimestamp,  // When label/shipment was created
        shipped_date: shippedTimestamp,  // When actually fulfilled (actual_fulfillment_date)
        delivered_date: deliveredTimestamp,
        transit_time_days: transitTimeDays,
        // Carrier/service fields
        carrier: shipment.tracking?.carrier || null,
        carrier_service: shipment.ship_option || null,
        ship_option_id: getShipOptionId(shipment.ship_option),
        zone_used: shipment.zone?.id || null,
        fc_name: fcName,
        fc_id: fcInfo?.fc_id || null,
        // Weight/dimension fields
        actual_weight_oz: actualWeight || null,
        dim_weight_oz: dimWeight,
        billable_weight_oz: billableWeight || null,
        length: length || null,
        width: width || null,
        height: height || null,
        // Insurance
        insurance_value: shipment.insurance_value || null,
        // New fields from migration 007
        estimated_fulfillment_date: shipment.estimated_fulfillment_date || null,
        estimated_fulfillment_date_status: shipment.estimated_fulfillment_date_status || null,
        last_update_at: shipment.last_update_at || null,
        last_tracking_update_at: shipment.tracking?.last_update_at || null,
        package_material_type: shipment.package_material_type || null,
        require_signature: shipment.require_signature || false,
        gift_message: shipment.gift_message || null,
        invoice_amount: shipment.invoice?.amount || null,
        invoice_currency_code: shipment.invoice?.currency_code || null,
        // Freight tracking fields (B2B)
        tracking_bol: shipment.tracking?.bol || null,
        tracking_pro_number: shipment.tracking?.pro_number || null,
        tracking_scac: shipment.tracking?.scac || null,
        // Country fields for DIM calculation
        origin_country: originCountry,
        destination_country: destCountry,
        // Status details for support (exception reasons, processing status)
        status_details: shipment.status_details || null,
        updated_at: new Date().toISOString(),
        // Denormalized from orders table for faster filtering (Dec 2025)
        order_type: order.type || null,
        channel_name: order.channel?.name || null,
        application_name: order.channel?.id ? (channelLookup[order.channel.id] || null) : null
      }

      const { error } = await supabase
        .from('shipments')
        .upsert(shipmentData, { onConflict: 'shipment_id' })

      if (error) {
        shipmentErrors++
        if (shipmentErrors <= 3) console.log(`  Shipment error: ${error.message}`)
      } else {
        shipmentsUpserted++
        shipmentIds.push(shipment.id.toString())
      }
    }
  }

  console.log(`Shipments upserted: ${shipmentsUpserted}`)
  if (shipmentErrors > 0) console.log(`Shipment errors: ${shipmentErrors}`)

  // ============================================
  // STEP 4: Sync Order Items
  // ============================================
  console.log('\n--- STEP 4: Syncing Order Items ---\n')

  let orderItemsUpserted = 0
  let orderItemErrors = 0

  for (const order of apiOrders) {
    if (!order.products || order.products.length === 0) continue

    const orderId = orderIdMap[order.id.toString()]
    if (!orderId) continue

    for (const product of order.products) {
      const itemData = {
        client_id: HENSON_ID,
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
      }

      const { error } = await supabase
        .from('order_items')
        .upsert(itemData, { onConflict: 'order_id,shipbob_product_id' })

      if (error) {
        orderItemErrors++
        if (orderItemErrors <= 3) console.log(`  Order item error: ${error.message}`)
      } else {
        orderItemsUpserted++
      }
    }
  }

  console.log(`Order items upserted: ${orderItemsUpserted}`)
  if (orderItemErrors > 0) console.log(`Order item errors: ${orderItemErrors}`)

  // ============================================
  // STEP 5: Sync Shipment Items (delete+insert pattern)
  // ============================================
  console.log('\n--- STEP 5: Syncing Shipment Items ---\n')

  let shipmentItemsInserted = 0
  let shipmentItemErrors = 0
  const processedShipmentIds = new Set()

  for (const order of apiOrders) {
    if (!order.shipments) continue

    for (const shipment of order.shipments) {
      if (!shipment.products || shipment.products.length === 0) continue

      const shipmentIdStr = shipment.id.toString()

      // Delete existing items for this shipment (if not already processed)
      if (!processedShipmentIds.has(shipmentIdStr)) {
        await supabase.from('shipment_items').delete().eq('shipment_id', shipmentIdStr)
        processedShipmentIds.add(shipmentIdStr)
      }

      for (const product of shipment.products) {
        // Shipment products can have inventory[] array with lot details
        const inventories = product.inventory || [{}]

        for (const inv of inventories) {
          const itemData = {
            client_id: HENSON_ID,
            shipment_id: shipmentIdStr,
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
          }

          const { error } = await supabase.from('shipment_items').insert(itemData)

          if (error) {
            shipmentItemErrors++
            if (shipmentItemErrors <= 3) console.log(`  Shipment item error: ${error.message}`)
          } else {
            shipmentItemsInserted++
          }
        }
      }
    }
  }

  console.log(`Shipment items inserted: ${shipmentItemsInserted}`)
  if (shipmentItemErrors > 0) console.log(`Shipment item errors: ${shipmentItemErrors}`)

  // ============================================
  // STEP 6: Sync Shipment Cartons (B2B) - delete+insert pattern
  // ============================================
  console.log('\n--- STEP 6: Syncing Shipment Cartons ---\n')

  let cartonsInserted = 0
  let cartonErrors = 0
  const processedCartonShipments = new Set()

  for (const order of apiOrders) {
    if (!order.shipments) continue

    for (const shipment of order.shipments) {
      if (!shipment.parent_cartons || shipment.parent_cartons.length === 0) continue

      const shipmentIdStr = shipment.id.toString()

      // Delete existing cartons for this shipment (if not already processed)
      if (!processedCartonShipments.has(shipmentIdStr)) {
        await supabase.from('shipment_cartons').delete().eq('shipment_id', shipmentIdStr)
        processedCartonShipments.add(shipmentIdStr)
      }

      for (const carton of shipment.parent_cartons) {
        const cartonData = {
          client_id: HENSON_ID,
          shipment_id: shipmentIdStr,
          carton_id: carton.id || null,
          barcode: carton.barcode || null,
          carton_type: carton.type || null,  // 'Box' or 'Pallet'
          parent_barcode: carton.parent_carton_barcode || null,
          length_in: carton.measurements?.length_in || null,
          width_in: carton.measurements?.width_in || null,
          depth_in: carton.measurements?.depth_in || null,
          weight_oz: carton.measurements?.weight_oz || null,
          contents: carton.products ? JSON.stringify(carton.products) : null
        }

        const { error } = await supabase.from('shipment_cartons').insert(cartonData)

        if (error) {
          cartonErrors++
          if (cartonErrors <= 3) console.log(`  Carton error: ${error.message}`)
        } else {
          cartonsInserted++
        }
      }
    }
  }

  console.log(`Shipment cartons inserted: ${cartonsInserted}`)
  if (cartonErrors > 0) console.log(`Carton errors: ${cartonErrors}`)

  // ============================================
  // STEP 7: Fetch and Upsert Transactions
  // ============================================
  console.log('\n--- STEP 7: Fetching Transactions ---\n')

  const apiTransactions = []
  for (let i = 0; i < shipmentIds.length; i += 100) {
    const batch = shipmentIds.slice(i, i + 100)
    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${parentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_ids: batch, page_size: 1000 })
    })
    const data = await response.json()
    const items = data.items || []
    apiTransactions.push(...items)
    console.log(`  Batch ${Math.floor(i/100)+1}: ${batch.length} shipments → ${items.length} tx`)
  }

  console.log(`\nTotal transactions fetched: ${apiTransactions.length}`)

  console.log('\n--- STEP 8: Upserting Transactions ---\n')

  let txUpserted = 0
  let txErrors = 0

  for (const tx of apiTransactions) {
    const txData = {
      transaction_id: tx.transaction_id,
      client_id: HENSON_ID,
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
    }

    const { error } = await supabase
      .from('transactions')
      .upsert(txData, { onConflict: 'transaction_id' })

    if (error) {
      txErrors++
      if (txErrors <= 3) console.log(`  Tx error: ${error.message}`)
    } else {
      txUpserted++
    }
  }

  console.log(`Transactions upserted: ${txUpserted}`)
  if (txErrors > 0) console.log(`Transaction errors: ${txErrors}`)

  // ============================================
  // VERIFICATION
  // ============================================
  console.log('\n========================================')
  console.log('VERIFICATION')
  console.log('========================================\n')

  const { count: dbOrderCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: dbShipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: dbTxCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: dbOrderItemCount } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: dbShipmentItemCount } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: dbCartonCount } = await supabase
    .from('shipment_cartons')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  // Check multi-shipment orders
  const { data: multiShipmentOrders } = await supabase
    .from('orders')
    .select('total_shipments')
    .eq('client_id', HENSON_ID)
    .gt('total_shipments', 1)

  console.log('COUNTS:')
  console.log(`  Orders in DB:        ${dbOrderCount}`)
  console.log(`  Shipments in DB:     ${dbShipmentCount}`)
  console.log(`  Order items:         ${dbOrderItemCount}`)
  console.log(`  Shipment items:      ${dbShipmentItemCount}`)
  console.log(`  Shipment cartons:    ${dbCartonCount}`)
  console.log(`  Transactions:        ${dbTxCount}`)
  console.log(`  Multi-shipment orders: ${multiShipmentOrders?.length || 0}`)

  console.log('\nTHIS SYNC:')
  console.log(`  Orders upserted:      ${ordersUpserted}`)
  console.log(`  Shipments upserted:   ${shipmentsUpserted}`)
  console.log(`  Order items:          ${orderItemsUpserted}`)
  console.log(`  Shipment items:       ${shipmentItemsInserted}`)
  console.log(`  Shipment cartons:     ${cartonsInserted}`)
  console.log(`  Transactions:         ${txUpserted}`)

  console.log('\n========================================')
  console.log('SYNC COMPLETE')
  console.log('========================================')
}

syncOrdersAndShipments().catch(console.error)
