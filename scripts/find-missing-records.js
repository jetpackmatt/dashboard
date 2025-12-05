#!/usr/bin/env node
/**
 * Find Missing Records Script
 *
 * Identifies gaps between ShipBob API and database after a sync with errors.
 * Reports which records are missing so they can be re-synced.
 *
 * Usage:
 *   node find-missing-records.js                    # Check Henson (default)
 *   node find-missing-records.js --client=methyl-life
 *   node find-missing-records.js --days=30         # Check last 30 days
 *   node find-missing-records.js --fix             # Output sync commands to fix
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Client configurations
const CLIENTS = {
  'henson': {
    id: '6b94c274-0446-4167-9d02-b998f8be59ad',
    name: 'Henson Shaving'
  },
  'methyl-life': {
    id: null,
    name: 'Methyl Life'
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    clientKey: 'henson',
    daysBack: 730,  // Default to full history
    fix: false
  }

  for (const arg of args) {
    if (arg === '--fix') config.fix = true
    else if (arg.startsWith('--days=')) config.daysBack = parseInt(arg.split('=')[1], 10)
    else if (arg.startsWith('--client=')) config.clientKey = arg.split('=')[1]
  }

  return config
}

async function findMissingRecords() {
  const config = parseArgs()

  console.log('=== FIND MISSING RECORDS ===')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log()

  // Get client info
  let clientId = CLIENTS[config.clientKey]?.id
  if (!clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .ilike('name', `%${config.clientKey}%`)
      .single()
    if (!client) {
      console.log(`ERROR: Client "${config.clientKey}" not found`)
      return
    }
    clientId = client.id
  }

  console.log(`Client: ${config.clientKey} (${clientId})`)
  console.log(`Checking last ${config.daysBack} days`)
  console.log()

  // Get API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .single()

  if (!creds) {
    console.log('ERROR: Client credentials not found')
    return
  }

  // Date range
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - config.daysBack)

  // ============================================
  // STEP 1: Get all order IDs from API
  // ============================================
  console.log('--- STEP 1: Fetching Order IDs from API ---')

  const apiOrderIds = new Set()
  const apiShipmentIds = new Set()
  const ordersWithShipments = new Map()  // shipbob_order_id -> shipment_ids[]

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

    if (page % 20 === 0) {
      console.log(`  Page ${page}: ${apiOrderIds.size} orders so far...`)
    }

    if (orders.length === 0) break

    for (const order of orders) {
      apiOrderIds.add(order.id.toString())

      const shipmentIds = []
      if (order.shipments) {
        for (const shipment of order.shipments) {
          apiShipmentIds.add(shipment.id.toString())
          shipmentIds.push(shipment.id.toString())
        }
      }
      ordersWithShipments.set(order.id.toString(), shipmentIds)
    }

    if (orders.length < 250) break
    page++
  }

  console.log(`\nAPI totals:`)
  console.log(`  Orders: ${apiOrderIds.size}`)
  console.log(`  Shipments: ${apiShipmentIds.size}`)
  console.log()

  // ============================================
  // STEP 2: Get all order IDs from database
  // ============================================
  console.log('--- STEP 2: Fetching IDs from Database ---')

  const dbOrderIds = new Set()
  const dbShipmentIds = new Set()

  // Fetch orders in batches (Supabase max 1000 per query)
  let offset = 0
  while (true) {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('client_id', clientId)
      .range(offset, offset + 999)

    if (error) {
      console.log(`Error fetching orders: ${error.message}`)
      break
    }

    for (const o of orders || []) {
      dbOrderIds.add(o.shipbob_order_id)
    }

    if (!orders || orders.length < 1000) break
    offset += 1000
  }

  // Fetch shipments
  offset = 0
  while (true) {
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('shipment_id')
      .eq('client_id', clientId)
      .range(offset, offset + 999)

    if (error) {
      console.log(`Error fetching shipments: ${error.message}`)
      break
    }

    for (const s of shipments || []) {
      dbShipmentIds.add(s.shipment_id)
    }

    if (!shipments || shipments.length < 1000) break
    offset += 1000
  }

  console.log(`Database totals:`)
  console.log(`  Orders: ${dbOrderIds.size}`)
  console.log(`  Shipments: ${dbShipmentIds.size}`)
  console.log()

  // ============================================
  // STEP 3: Find missing records
  // ============================================
  console.log('--- STEP 3: Comparing ---')

  const missingOrders = []
  const missingShipments = []
  const orphanedShipments = []  // Shipments in DB but order missing

  for (const orderId of apiOrderIds) {
    if (!dbOrderIds.has(orderId)) {
      missingOrders.push(orderId)
    }
  }

  for (const shipmentId of apiShipmentIds) {
    if (!dbShipmentIds.has(shipmentId)) {
      missingShipments.push(shipmentId)
    }
  }

  // Check for orphaned shipments (shipment exists but order doesn't)
  for (const [orderId, shipmentIds] of ordersWithShipments) {
    if (!dbOrderIds.has(orderId)) {
      for (const sid of shipmentIds) {
        if (dbShipmentIds.has(sid)) {
          orphanedShipments.push({ shipmentId: sid, orderId })
        }
      }
    }
  }

  // ============================================
  // STEP 4: Check related tables
  // ============================================
  console.log('--- STEP 4: Checking Related Tables ---')

  // Count order_items and shipment_items
  const { count: orderItemCount } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const { count: shipmentItemCount } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const { count: transactionCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  // Expected counts (rough estimates)
  const expectedOrderItems = apiOrderIds.size  // ~1 item per order on average
  const expectedShipmentItems = apiShipmentIds.size  // ~1 item per shipment
  const expectedTransactions = apiShipmentIds.size  // ~1 tx per shipment

  // ============================================
  // REPORT
  // ============================================
  console.log('\n========================================')
  console.log('REPORT')
  console.log('========================================\n')

  console.log('ORDERS:')
  console.log(`  API count:      ${apiOrderIds.size}`)
  console.log(`  DB count:       ${dbOrderIds.size}`)
  console.log(`  Missing:        ${missingOrders.length}`)
  console.log(`  Coverage:       ${(100 * dbOrderIds.size / apiOrderIds.size).toFixed(2)}%`)

  console.log('\nSHIPMENTS:')
  console.log(`  API count:      ${apiShipmentIds.size}`)
  console.log(`  DB count:       ${dbShipmentIds.size}`)
  console.log(`  Missing:        ${missingShipments.length}`)
  console.log(`  Coverage:       ${(100 * dbShipmentIds.size / apiShipmentIds.size).toFixed(2)}%`)

  console.log('\nRELATED TABLES:')
  console.log(`  Order items:    ${orderItemCount} (expected ~${expectedOrderItems})`)
  console.log(`  Shipment items: ${shipmentItemCount} (expected ~${expectedShipmentItems})`)
  console.log(`  Transactions:   ${transactionCount} (expected ~${expectedTransactions})`)

  if (orphanedShipments.length > 0) {
    console.log(`\nWARNING: ${orphanedShipments.length} orphaned shipments (shipment exists but order missing)`)
  }

  // ============================================
  // SAMPLE MISSING IDs
  // ============================================
  if (missingOrders.length > 0) {
    console.log('\nSAMPLE MISSING ORDERS (first 20):')
    console.log(`  ${missingOrders.slice(0, 20).join(', ')}`)
  }

  if (missingShipments.length > 0) {
    console.log('\nSAMPLE MISSING SHIPMENTS (first 20):')
    console.log(`  ${missingShipments.slice(0, 20).join(', ')}`)
  }

  // ============================================
  // FIX COMMANDS
  // ============================================
  if (config.fix && (missingOrders.length > 0 || missingShipments.length > 0)) {
    console.log('\n========================================')
    console.log('SUGGESTED FIX')
    console.log('========================================\n')

    // Group missing orders by date range to minimize API calls
    // For now, just suggest re-running the full sync
    console.log('Option 1: Re-run full sync with fast script:')
    console.log(`  node scripts/sync-orders-fast.js --all --client=${config.clientKey}`)

    console.log('\nOption 2: Run targeted date ranges in parallel:')
    // Generate quarterly chunks
    const quarters = []
    const now = new Date()
    for (let i = 0; i < 8; i++) {  // 2 years = 8 quarters
      const qEnd = new Date(now)
      qEnd.setMonth(qEnd.getMonth() - (i * 3))
      const qStart = new Date(qEnd)
      qStart.setMonth(qStart.getMonth() - 3)
      quarters.push({ start: qStart, end: qEnd })
    }

    for (const q of quarters.slice(0, 4)) {  // Show 4 quarters
      const start = q.start.toISOString().split('T')[0]
      const end = q.end.toISOString().split('T')[0]
      console.log(`  node scripts/sync-orders-fast.js --start=${start} --end=${end} --client=${config.clientKey} &`)
    }
  }

  // Save detailed report to file
  const reportFile = `missing-records-report-${clientId.slice(0,8)}-${Date.now()}.json`
  const fs = require('fs')
  fs.writeFileSync(
    require('path').join(__dirname, reportFile),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      clientId,
      summary: {
        apiOrders: apiOrderIds.size,
        dbOrders: dbOrderIds.size,
        missingOrders: missingOrders.length,
        apiShipments: apiShipmentIds.size,
        dbShipments: dbShipmentIds.size,
        missingShipments: missingShipments.length,
        orderItems: orderItemCount,
        shipmentItems: shipmentItemCount,
        transactions: transactionCount
      },
      missingOrders: missingOrders.slice(0, 1000),  // Cap at 1000 to keep file manageable
      missingShipments: missingShipments.slice(0, 1000)
    }, null, 2)
  )

  console.log(`\nDetailed report saved to: ${reportFile}`)
  console.log('\n========================================')
  console.log('ANALYSIS COMPLETE')
  console.log('========================================')
}

findMissingRecords().catch(console.error)
