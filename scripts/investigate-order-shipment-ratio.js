#!/usr/bin/env node
/**
 * Investigate: Why are there more shipments than orders?
 * Henson: 60,431 orders but 60,734 shipments
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function investigate() {
  console.log('=== INVESTIGATING ORDER vs SHIPMENT COUNTS ===\n')

  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Get a sample of recent orders and count their shipments
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 30)  // Last 30 days

  let allOrders = []
  let page = 1

  console.log('Fetching orders from last 30 days...')
  while (page <= 10) {  // Limit to first 10 pages for investigation
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
    console.log(`  Page ${page}: ${orders.length} orders`)
    if (orders.length < 250) break
    page++
  }

  console.log(`\nTotal orders fetched: ${allOrders.length}`)

  // Count shipments per order
  const shipmentCounts = {}
  let totalShipments = 0
  let ordersWithMultipleShipments = []

  for (const order of allOrders) {
    const shipmentCount = order.shipments?.length || 0
    totalShipments += shipmentCount

    if (!shipmentCounts[shipmentCount]) shipmentCounts[shipmentCount] = 0
    shipmentCounts[shipmentCount]++

    if (shipmentCount > 1) {
      ordersWithMultipleShipments.push({
        orderId: order.id,
        orderNumber: order.order_number,
        shipmentCount,
        status: order.status,
        shipments: order.shipments?.map(s => ({
          id: s.id,
          status: s.status,
          location: s.location?.name
        }))
      })
    }
  }

  console.log('\n=== SHIPMENTS PER ORDER DISTRIBUTION ===')
  for (const [count, orders] of Object.entries(shipmentCounts).sort((a,b) => Number(a[0]) - Number(b[0]))) {
    const pct = (orders / allOrders.length * 100).toFixed(1)
    console.log(`  ${count} shipment(s): ${orders} orders (${pct}%)`)
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Orders: ${allOrders.length}`)
  console.log(`Total shipments: ${totalShipments}`)
  console.log(`Ratio: ${(totalShipments / allOrders.length).toFixed(3)} shipments per order`)
  console.log(`Orders with multiple shipments: ${ordersWithMultipleShipments.length}`)

  if (ordersWithMultipleShipments.length > 0) {
    console.log('\n=== SAMPLE: ORDERS WITH MULTIPLE SHIPMENTS ===')
    for (const order of ordersWithMultipleShipments.slice(0, 5)) {
      console.log(`\nOrder ${order.orderId} (${order.orderNumber}): ${order.shipmentCount} shipments, Status: ${order.status}`)
      for (const s of order.shipments || []) {
        console.log(`  → Shipment ${s.id}: ${s.status}, FC: ${s.location}`)
      }
    }
  }

  // Calculate expected difference
  const extraShipments = totalShipments - allOrders.length
  console.log(`\n=== EXTRAPOLATION ===`)
  console.log(`Extra shipments in sample: ${extraShipments}`)
  console.log(`If this ratio holds for all 60,431 orders:`)
  console.log(`  Expected shipments: ${Math.round(60431 * (totalShipments / allOrders.length))}`)
  console.log(`  Actual shipments: 60,734`)
  console.log(`  Difference explained by: ~${60734 - 60431} orders having 2+ shipments`)
}

investigate().catch(console.error)
