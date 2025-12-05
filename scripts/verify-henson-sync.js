#!/usr/bin/env node
/**
 * Verify sync by starting from Henson's shipments and cross-referencing
 * with billing transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN

async function verify() {
  console.log('=== Verifying Henson Shipment → Transaction Sync ===\n')

  // 1. Get Henson's token
  const { data: hensonCreds } = await supabase
    .from('client_api_credentials')
    .select('api_token, client_id')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad') // Henson's ID
    .single()

  if (!hensonCreds) {
    console.log('ERROR: Henson credentials not found')
    return
  }
  console.log('Found Henson credentials')

  // 2. Fetch recent shipments from ShipBob Orders API (Henson's token)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  console.log(`\nFetching ALL Henson shipments from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...`)

  // Paginate through all orders
  let allOrders = []
  let page = 1
  const pageSize = 250

  while (true) {
    const params = new URLSearchParams({
      StartDate: startDate.toISOString(),
      EndDate: endDate.toISOString(),
      Limit: pageSize.toString(),
      Page: page.toString(),
      SortOrder: 'Newest'
    })

    const ordersResponse = await fetch(`https://api.shipbob.com/1.0/order?${params}`, {
      headers: { 'Authorization': `Bearer ${hensonCreds.api_token}`, 'Content-Type': 'application/json' }
    })

    if (!ordersResponse.ok) {
      console.log(`ERROR: Orders API returned ${ordersResponse.status}`)
      return
    }

    const orders = await ordersResponse.json()
    console.log(`  Page ${page}: ${orders.length} orders`)

    if (orders.length === 0) break
    allOrders.push(...orders)

    if (orders.length < pageSize) break // Last page
    page++
  }

  const orders = allOrders
  console.log(`Total: ${orders.length} orders from Henson`)

  // Extract shipment IDs from orders
  const shipmentIds = []
  for (const order of orders) {
    if (order.shipments) {
      for (const shipment of order.shipments) {
        shipmentIds.push(shipment.id.toString())
      }
    }
  }
  console.log(`Found ${shipmentIds.length} shipment IDs`)

  // 3. Query billing API for these specific reference_ids
  console.log('\nQuerying billing API for these shipments...')

  // Batch the shipment IDs (API might have limits)
  const batchSize = 100
  let allTransactions = []

  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize)

    const txResponse = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${parentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference_ids: batch,
        page_size: 1000
      })
    })

    const txData = await txResponse.json()
    const items = txData.items || []
    allTransactions.push(...items)
    console.log(`  Batch ${Math.floor(i/batchSize) + 1}: ${batch.length} shipments → ${items.length} transactions`)
  }

  console.log(`\nTotal transactions found for Henson shipments: ${allTransactions.length}`)

  // 4. Summarize
  const total = allTransactions.reduce((s, t) => s + t.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)

  // By fee type
  console.log('\nBy fee type:')
  const byFee = {}
  for (const tx of allTransactions) {
    const fee = tx.transaction_fee
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += tx.amount
  }
  Object.entries(byFee)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(25)}: ${stats.count.toString().padStart(4)} tx, $${stats.total.toFixed(2)}`)
    })

  // By invoiced status
  const invoiced = allTransactions.filter(t => t.invoiced_status)
  const pending = allTransactions.filter(t => !t.invoiced_status)
  console.log(`\nInvoiced: ${invoiced.length} tx ($${invoiced.reduce((s,t) => s+t.amount, 0).toFixed(2)})`)
  console.log(`Pending: ${pending.length} tx ($${pending.reduce((s,t) => s+t.amount, 0).toFixed(2)})`)

  // Count unique shipments that have transactions
  const uniqueShipmentRefs = new Set(allTransactions.map(t => t.reference_id))
  console.log(`\nUnique shipments with billing data: ${uniqueShipmentRefs.size} of ${shipmentIds.length}`)

  // Check for shipments WITHOUT transactions
  const shipmentsWithTx = new Set(allTransactions.map(t => t.reference_id))
  const shipmentsWithoutTx = shipmentIds.filter(id => !shipmentsWithTx.has(id))
  console.log(`Shipments without billing data: ${shipmentsWithoutTx.length}`)
  if (shipmentsWithoutTx.length > 0 && shipmentsWithoutTx.length <= 10) {
    console.log(`  IDs: ${shipmentsWithoutTx.join(', ')}`)
  }
}

verify().catch(console.error)
