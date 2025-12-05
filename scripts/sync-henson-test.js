#!/usr/bin/env node
/**
 * Test Sync: Henson Only
 * Syncs orders + transactions to database, then verifies
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function syncHenson() {
  console.log('=== SYNCING HENSON TO DATABASE ===')
  console.log(`Timestamp: ${new Date().toISOString()}\n`)

  // Get Henson's token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  if (!creds) {
    console.log('ERROR: Henson credentials not found')
    return
  }

  // Build ship_option_id lookup from shipping methods
  console.log('Building ship_option_id lookup...')
  const methodsRes = await fetch('https://api.shipbob.com/1.0/shippingmethod', {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const methods = await methodsRes.json()

  // Build normalized lookup (remove spaces, lowercase)
  const shipOptionLookup = {}
  for (const method of methods) {
    const serviceLevelName = method.service_level?.name?.trim()
    const serviceLevelId = method.service_level?.id
    if (serviceLevelName && serviceLevelId) {
      // Store both original and normalized versions
      shipOptionLookup[serviceLevelName] = serviceLevelId
      shipOptionLookup[serviceLevelName.toLowerCase().replace(/\s+/g, '')] = serviceLevelId
    }
  }
  console.log(`Ship option lookup built: ${Object.keys(shipOptionLookup).length / 2} service levels`)

  // Build channel lookup (channel_id -> application_name) from Channels API
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

  // Manual fallback mappings for ship_option values that differ from API service_level.name
  // Orders API returns different names than Shipping Methods API for some services
  const manualMappings = {
    'Ground': 3,           // API returns "Standard (Ground)" with ID 3
    '1 Day': 8,            // FedEx 1 Day service level
    '2 Day': 9,            // FedEx 2 Day service level
  }

  // Helper to get ship_option_id
  const getShipOptionId = (shipOption) => {
    if (!shipOption) return null
    // Try exact match first
    if (shipOptionLookup[shipOption]) return shipOptionLookup[shipOption]
    // Try normalized match
    const normalized = shipOption.toLowerCase().replace(/\s+/g, '')
    if (shipOptionLookup[normalized]) return shipOptionLookup[normalized]
    // Try manual fallback mappings
    return manualMappings[shipOption] || null
  }

  // Date range (7 days)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`)

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
    const response = await fetch(`https://api.shipbob.com/1.0/order?${params}`, {
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

  // Extract shipment IDs
  const shipmentIds = []
  for (const order of apiOrders) {
    if (order.shipments) {
      for (const s of order.shipments) {
        shipmentIds.push(s.id.toString())
      }
    }
  }
  console.log(`Shipment IDs extracted: ${shipmentIds.length}`)

  // ============================================
  // STEP 2: Insert shipments to database
  // ============================================
  console.log('\n--- STEP 2: Inserting Shipments to Database ---\n')

  let shipmentsInserted = 0
  let shipmentsUpdated = 0
  let shipmentErrors = 0

  for (const order of apiOrders) {
    if (!order.shipments || order.shipments.length === 0) continue

    for (const shipment of order.shipments) {
      const shipmentData = {
        shipment_id: shipment.id.toString(),
        client_id: HENSON_ID,
        shipbob_order_id: order.id?.toString() || null,
        store_order_id: order.order_number || null,
        tracking_id: shipment.tracking?.tracking_number || null,
        order_date: order.created_date ? new Date(order.created_date).toISOString().split('T')[0] : null,
        customer_name: order.recipient?.name || null,
        city: order.recipient?.address?.city || null,
        state: order.recipient?.address?.state || null,
        zip_code: order.recipient?.address?.zip_code || null,
        country: order.recipient?.address?.country || null,
        // Carrier and shipping details
        carrier: shipment.tracking?.carrier || null,
        carrier_service: shipment.ship_option || null,
        ship_option_id: getShipOptionId(shipment.ship_option),
        // Fulfillment center and zone
        fc_name: shipment.location?.name || null,
        zone_used: shipment.zone?.id || null,
        // Measurements from Orders API
        actual_weight_oz: shipment.measurements?.total_weight_oz || null,
        length: shipment.measurements?.length_in || null,
        width: shipment.measurements?.width_in || null,
        height: shipment.measurements?.depth_in || null,
        // Dates
        label_generation_date: shipment.actual_fulfillment_date ? new Date(shipment.actual_fulfillment_date).toISOString().split('T')[0] : null,
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
        if (shipmentErrors <= 3) console.log(`  Error: ${error.message}`)
      } else {
        shipmentsInserted++
      }
    }
  }

  console.log(`Shipments synced: ${shipmentsInserted}`)
  if (shipmentErrors > 0) console.log(`Shipment errors: ${shipmentErrors}`)

  // ============================================
  // STEP 3: Fetch transactions from API
  // ============================================
  console.log('\n--- STEP 3: Fetching Transactions from API ---\n')

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

  // ============================================
  // STEP 4: Insert transactions to database
  // ============================================
  console.log('\n--- STEP 4: Inserting Transactions to Database ---\n')

  let txInserted = 0
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
      if (txErrors <= 3) console.log(`  Error: ${error.message}`)
    } else {
      txInserted++
    }
  }

  console.log(`Transactions synced: ${txInserted}`)
  if (txErrors > 0) console.log(`Transaction errors: ${txErrors}`)

  // ============================================
  // STEP 5: Verification
  // ============================================
  console.log('\n========================================')
  console.log('VERIFICATION: API vs DATABASE')
  console.log('========================================\n')

  // Query DB counts
  const { count: dbShipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { data: dbTransactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', HENSON_ID)

  const dbTx = dbTransactions || []

  // Compare
  console.log('SHIPMENTS:')
  console.log(`  API:      ${shipmentIds.length}`)
  console.log(`  Database: ${dbShipmentCount}`)
  console.log(`  Match:    ${shipmentIds.length === dbShipmentCount ? '✓ YES' : '✗ NO'}`)

  console.log('\nTRANSACTIONS:')
  console.log(`  API:      ${apiTransactions.length}`)
  console.log(`  Database: ${dbTx.length}`)
  console.log(`  Match:    ${apiTransactions.length === dbTx.length ? '✓ YES' : '✗ NO'}`)

  // By fee type comparison
  const apiByFee = {}
  for (const tx of apiTransactions) {
    if (!apiByFee[tx.transaction_fee]) apiByFee[tx.transaction_fee] = 0
    apiByFee[tx.transaction_fee]++
  }

  const dbByFee = {}
  for (const tx of dbTx) {
    const fee = tx.transaction_fee
    if (!dbByFee[fee]) dbByFee[fee] = 0
    dbByFee[fee]++
  }

  console.log('\nBY FEE TYPE:')
  const allFees = new Set([...Object.keys(apiByFee), ...Object.keys(dbByFee)])
  let allMatch = true
  for (const fee of [...allFees].sort()) {
    const api = apiByFee[fee] || 0
    const db = dbByFee[fee] || 0
    const match = api === db
    if (!match) allMatch = false
    console.log(`  ${fee.padEnd(25)}: API=${api.toString().padStart(4)}, DB=${db.toString().padStart(4)} ${match ? '✓' : '✗'}`)
  }

  // Final result
  console.log('\n========================================')
  if (shipmentIds.length === dbShipmentCount && apiTransactions.length === dbTx.length && allMatch) {
    console.log('✓ SYNC VERIFIED - All data matches!')
  } else {
    console.log('✗ DISCREPANCIES FOUND - Review above')
  }
  console.log('========================================')
}

syncHenson().catch(console.error)
