#!/usr/bin/env node
/**
 * Test the updated sync with shipment-first architecture
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN

// Henson's client ID
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function testSync() {
  console.log('=== Testing Shipment-First Sync Architecture ===\n')

  // 1. Get Henson's token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  if (!creds) {
    console.log('ERROR: Credentials not found')
    return
  }

  // 2. Fetch orders with pagination (last 7 days)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  console.log(`Fetching orders from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...\n`)

  let allOrders = []
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
    allOrders.push(...orders)
    if (orders.length < 250) break
    page++
  }

  console.log(`\nTotal orders: ${allOrders.length}`)

  // 3. Extract shipment IDs
  const shipmentIds = []
  for (const order of allOrders) {
    if (order.shipments) {
      for (const s of order.shipments) {
        shipmentIds.push(s.id.toString())
      }
    }
  }
  console.log(`Shipment IDs extracted: ${shipmentIds.length}`)

  // 4. Query billing by reference_ids in batches
  console.log('\nQuerying billing API by shipment IDs...')
  const allTx = []
  const batchSize = 100

  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize)
    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${parentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_ids: batch, page_size: 1000 })
    })
    const data = await response.json()
    const items = data.items || []
    allTx.push(...items)
    console.log(`  Batch ${Math.floor(i/batchSize)+1}: ${batch.length} shipments → ${items.length} tx`)
  }

  console.log(`\nTotal transactions found: ${allTx.length}`)
  const total = allTx.reduce((s, t) => s + t.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)

  // 5. Summary
  const invoiced = allTx.filter(t => t.invoiced_status)
  const pending = allTx.filter(t => !t.invoiced_status)

  console.log('\n=== SYNC RESULT FOR HENSON ===')
  console.log(`Orders: ${allOrders.length}`)
  console.log(`Shipments: ${shipmentIds.length}`)
  console.log(`Transactions: ${allTx.length}`)
  console.log(`  Invoiced: ${invoiced.length} ($${invoiced.reduce((s,t)=>s+t.amount,0).toFixed(2)})`)
  console.log(`  Pending: ${pending.length} ($${pending.reduce((s,t)=>s+t.amount,0).toFixed(2)})`)

  // By fee type
  console.log('\nBy fee type:')
  const byFee = {}
  for (const tx of allTx) {
    if (!byFee[tx.transaction_fee]) byFee[tx.transaction_fee] = { count: 0, total: 0 }
    byFee[tx.transaction_fee].count++
    byFee[tx.transaction_fee].total += tx.amount
  }
  Object.entries(byFee)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(25)}: ${stats.count.toString().padStart(4)} tx, $${stats.total.toFixed(2)}`)
    })

  // Shipments missing transactions
  const shipmentIdsWithTx = new Set(allTx.map(t => t.reference_id))
  const missing = shipmentIds.filter(id => !shipmentIdsWithTx.has(id))
  console.log(`\nShipments with billing data: ${shipmentIdsWithTx.size}/${shipmentIds.length}`)
  console.log(`Missing billing data: ${missing.length} shipments (likely very recent)`)
}

testSync().catch(console.error)
