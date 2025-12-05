#!/usr/bin/env node
/**
 * Get EXACT pending transaction breakdown for Henson
 * to compare 1:1 with PowerBI data
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const parentToken = process.env.SHIPBOB_API_TOKEN
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function getExactBreakdown() {
  console.log('=== EXACT Pending Transaction Breakdown for Henson ===\n')

  // Get Henson's token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Fetch ALL Henson orders (7 days)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}\n`)

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
    if (orders.length === 0) break
    allOrders.push(...orders)
    if (orders.length < 250) break
    page++
  }

  // Extract shipment IDs
  const shipmentIds = []
  for (const order of allOrders) {
    if (order.shipments) {
      for (const s of order.shipments) {
        shipmentIds.push(s.id.toString())
      }
    }
  }

  console.log(`Henson Orders (7 days): ${allOrders.length}`)
  console.log(`Henson Shipments: ${shipmentIds.length}`)

  // Query billing for these shipments
  console.log('\nQuerying billing API for Henson shipments...')
  const allTx = []
  for (let i = 0; i < shipmentIds.length; i += 100) {
    const batch = shipmentIds.slice(i, i + 100)
    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${parentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_ids: batch, page_size: 1000 })
    })
    const data = await response.json()
    allTx.push(...(data.items || []))
  }

  // Separate invoiced vs pending
  const invoiced = allTx.filter(t => t.invoiced_status)
  const pending = allTx.filter(t => !t.invoiced_status)

  console.log(`\nTotal transactions for Henson shipments: ${allTx.length}`)

  // PENDING breakdown by fee type
  console.log('\n========================================')
  console.log('PENDING (UNBILLED) TRANSACTIONS - HENSON')
  console.log('========================================')
  console.log(`Total pending: ${pending.length} transactions`)
  console.log(`Total pending amount: $${pending.reduce((s,t) => s + t.amount, 0).toFixed(2)}`)

  console.log('\nBy fee type:')
  const pendingByFee = {}
  for (const tx of pending) {
    if (!pendingByFee[tx.transaction_fee]) pendingByFee[tx.transaction_fee] = { count: 0, total: 0 }
    pendingByFee[tx.transaction_fee].count++
    pendingByFee[tx.transaction_fee].total += tx.amount
  }
  Object.entries(pendingByFee)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(30)}: ${stats.count.toString().padStart(5)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })

  // Unique shipments in pending
  const pendingShipmentRefs = new Set(pending.filter(t => t.reference_type === 'Shipment').map(t => t.reference_id))
  console.log(`\nUnique shipments with pending transactions: ${pendingShipmentRefs.size}`)

  // By charge_date for pending
  console.log('\nPending by charge_date:')
  const pendingByDate = {}
  for (const tx of pending) {
    const d = tx.charge_date
    if (!pendingByDate[d]) pendingByDate[d] = { count: 0, total: 0, shipments: new Set() }
    pendingByDate[d].count++
    pendingByDate[d].total += tx.amount
    if (tx.reference_type === 'Shipment') pendingByDate[d].shipments.add(tx.reference_id)
  }
  Object.entries(pendingByDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, stats]) => {
      console.log(`  ${date}: ${stats.count.toString().padStart(4)} tx, ${stats.shipments.size} shipments, $${stats.total.toFixed(2)}`)
    })

  // INVOICED breakdown
  console.log('\n========================================')
  console.log('INVOICED TRANSACTIONS - HENSON')
  console.log('========================================')
  console.log(`Total invoiced: ${invoiced.length} transactions`)
  console.log(`Total invoiced amount: $${invoiced.reduce((s,t) => s + t.amount, 0).toFixed(2)}`)

  console.log('\nBy fee type:')
  const invoicedByFee = {}
  for (const tx of invoiced) {
    if (!invoicedByFee[tx.transaction_fee]) invoicedByFee[tx.transaction_fee] = { count: 0, total: 0 }
    invoicedByFee[tx.transaction_fee].count++
    invoicedByFee[tx.transaction_fee].total += tx.amount
  }
  Object.entries(invoicedByFee)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(30)}: ${stats.count.toString().padStart(5)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })

  // Summary comparison
  console.log('\n========================================')
  console.log('COMPARISON POINTS FOR POWERBI')
  console.log('========================================')
  console.log(`\nYour PowerBI shows: 731 orders`)
  console.log(`API shows for Henson (7 days):`)
  console.log(`  Orders: ${allOrders.length}`)
  console.log(`  Shipments: ${shipmentIds.length}`)
  console.log(`  Pending Shipping tx: ${pendingByFee['Shipping']?.count || 0}`)
  console.log(`  Pending Per Pick Fee tx: ${pendingByFee['Per Pick Fee']?.count || 0}`)
  console.log(`  Unique pending shipments: ${pendingShipmentRefs.size}`)
}

getExactBreakdown().catch(console.error)
