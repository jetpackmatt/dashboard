#!/usr/bin/env node
/**
 * Check shipment_items table directly for the problem shipments
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPMENTS = ['314986466', '314477032', '317488641', '325911412', '325023757', '324708598']

async function main() {
  console.log('='.repeat(80))
  console.log('CHECKING SHIPMENT_ITEMS TABLE')
  console.log('='.repeat(80))

  for (const shipmentId of SHIPMENTS) {
    console.log(`\n--- Shipment ${shipmentId} ---`)

    // Get shipment info
    const { data: shipment } = await supabase
      .from('shipments')
      .select('shipment_id, channel_name, order_id, client_id')
      .eq('shipment_id', shipmentId)
      .single()

    if (!shipment) {
      console.log('  NOT FOUND in shipments table')
      continue
    }

    console.log(`  client_id: ${shipment.client_id}`)
    console.log(`  channel: ${shipment.channel_name || 'NULL'}`)

    // Get shipment_items (without client_id filter)
    const { data: items, error } = await supabase
      .from('shipment_items')
      .select('*')
      .eq('shipment_id', shipmentId)

    if (error) {
      console.log('  ERROR:', error.message)
      continue
    }

    console.log(`  shipment_items: ${items?.length || 0}`)

    if (items && items.length > 0) {
      items.forEach(item => {
        console.log(`    - name: "${item.name}", qty: ${item.quantity ?? 'NULL'}, client_id: ${item.client_id}`)
      })
    }

    // Get order info
    const { data: order } = await supabase
      .from('orders')
      .select('id, channel_name, order_type, store_order_id')
      .eq('id', shipment.order_id)
      .single()

    if (order) {
      console.log(`  order channel: ${order.channel_name || 'NULL'}`)
      console.log(`  order type: ${order.order_type || 'NULL'}`)
      console.log(`  store_order_id: ${order.store_order_id || 'NULL'}`)
    }

    // Get order_items
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('name, quantity')
      .eq('order_id', shipment.order_id)

    console.log(`  order_items: ${orderItems?.length || 0}`)
  }

  // Check for channels that are B2B
  console.log('\n' + '='.repeat(80))
  console.log('CHANNEL ANALYSIS FOR THESE SHIPMENTS')
  console.log('='.repeat(80))

  const { data: channelData } = await supabase
    .from('shipments')
    .select('channel_name')
    .in('shipment_id', SHIPMENTS)

  const channels = [...new Set(channelData?.map(s => s.channel_name || 'NULL'))]
  console.log('Unique channels:', channels)

  // Get channel distribution across all Henson shipments on Dec 8 invoices
  const { data: allHensonShipments } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', [8661966, 8661967, 8661968, 8661969])

  const shipmentIds = allHensonShipments?.map(t => t.reference_id) || []

  const { data: channelCounts } = await supabase
    .from('shipments')
    .select('channel_name')
    .in('shipment_id', shipmentIds)

  const channelMap = {}
  for (const s of channelCounts || []) {
    const ch = s.channel_name || 'NULL'
    channelMap[ch] = (channelMap[ch] || 0) + 1
  }

  console.log('\nAll Henson channels on Dec 8 invoices:')
  for (const [ch, count] of Object.entries(channelMap).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ch}: ${count}`)
  }
}

main().catch(console.error)
