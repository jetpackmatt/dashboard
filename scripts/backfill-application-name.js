#!/usr/bin/env node
/**
 * Backfill application_name for existing orders and shipments
 *
 * This script:
 * 1. Fetches channels from ShipBob API for each client
 * 2. Builds a lookup of channel_id -> application_name
 * 3. Updates all orders/shipments that have channel_id but no application_name
 *
 * Much faster than re-syncing since we already have channel_id stored.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function backfillApplicationName() {
  console.log('=== Backfill application_name ===\n')

  // Get all clients with their credentials
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name')

  if (clientsError) {
    console.error('Error fetching clients:', clientsError)
    return
  }

  // Get credentials separately
  const { data: credentials, error: credsError } = await supabase
    .from('client_api_credentials')
    .select('client_id, api_token')

  if (credsError) {
    console.error('Error fetching credentials:', credsError)
    return
  }

  // Build client_id -> api_token map
  const tokenMap = {}
  for (const cred of credentials || []) {
    tokenMap[cred.client_id] = cred.api_token
  }

  console.log(`Found ${clients.length} clients, ${credentials.length} with API tokens\n`)

  for (const client of clients) {
    const apiToken = tokenMap[client.id]
    console.log(`\n--- Processing: ${client.company_name} ---`)

    if (!apiToken) {
      console.log('  No API token, skipping')
      continue
    }

    // Fetch channels from ShipBob API (2025-07 version)
    const channelsRes = await fetch('https://api.shipbob.com/2025-07/channel', {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    })

    if (!channelsRes.ok) {
      console.log(`  Failed to fetch channels: ${channelsRes.status}`)
      continue
    }

    const channelsData = await channelsRes.json()
    // 2025-07 API returns { items: [...] }, extract the array
    const channels = Array.isArray(channelsData) ? channelsData : (channelsData.items || [])

    // Build lookup: channel_id -> application_name
    const channelLookup = {}
    for (const channel of channels) {
      if (channel.id && channel.application_name) {
        channelLookup[channel.id] = channel.application_name
      }
    }

    console.log(`  Found ${Object.keys(channelLookup).length} channels:`)
    for (const [id, name] of Object.entries(channelLookup)) {
      console.log(`    ${id}: ${name}`)
    }

    // Count orders needing update
    const { count: ordersNeedingUpdate } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('application_name', null)
      .not('channel_id', 'is', null)

    console.log(`  Orders needing update: ${ordersNeedingUpdate}`)

    // Update orders for each channel_id
    for (const [channelId, applicationName] of Object.entries(channelLookup)) {
      const { data, error, count } = await supabase
        .from('orders')
        .update({ application_name: applicationName })
        .eq('client_id', client.id)
        .eq('channel_id', parseInt(channelId))
        .is('application_name', null)
        .select('id')

      if (error) {
        console.log(`    Error updating orders for channel ${channelId}: ${error.message}`)
      } else if (data && data.length > 0) {
        console.log(`    Updated ${data.length} orders with channel_id=${channelId} -> ${applicationName}`)
      }
    }

    // Count shipments needing update
    const { count: shipmentsNeedingUpdate } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('application_name', null)

    console.log(`  Shipments needing update: ${shipmentsNeedingUpdate}`)

    // For shipments, we need to join through orders to get channel_id
    // Or we could update based on order_id
    // Let's do a batch update by joining to orders

    // First, get orders with their channel_id and application_name
    const { data: ordersWithChannel } = await supabase
      .from('orders')
      .select('id, channel_id, application_name')
      .eq('client_id', client.id)
      .not('application_name', 'is', null)
      .limit(10000)

    if (ordersWithChannel && ordersWithChannel.length > 0) {
      // Group by application_name
      const ordersByApp = {}
      for (const order of ordersWithChannel) {
        if (!ordersByApp[order.application_name]) {
          ordersByApp[order.application_name] = []
        }
        ordersByApp[order.application_name].push(order.id)
      }

      // Update shipments in batches
      for (const [appName, orderIds] of Object.entries(ordersByApp)) {
        // Update in chunks of 1000
        for (let i = 0; i < orderIds.length; i += 1000) {
          const chunk = orderIds.slice(i, i + 1000)
          const { data: updated, error } = await supabase
            .from('shipments')
            .update({ application_name: appName })
            .eq('client_id', client.id)
            .in('order_id', chunk)
            .is('application_name', null)
            .select('id')

          if (error) {
            console.log(`    Error updating shipments: ${error.message}`)
          } else if (updated && updated.length > 0) {
            console.log(`    Updated ${updated.length} shipments -> ${appName}`)
          }
        }
      }
    }
  }

  // Final count
  console.log('\n=== Final Stats ===')

  const { count: ordersWithApp } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('application_name', 'is', null)

  const { count: totalOrders } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })

  const { count: shipmentsWithApp } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('application_name', 'is', null)

  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })

  console.log(`Orders with application_name: ${ordersWithApp} / ${totalOrders} (${(100*ordersWithApp/totalOrders).toFixed(1)}%)`)
  console.log(`Shipments with application_name: ${shipmentsWithApp} / ${totalShipments} (${(100*shipmentsWithApp/totalShipments).toFixed(1)}%)`)
}

backfillApplicationName().catch(console.error)
