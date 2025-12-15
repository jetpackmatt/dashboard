#!/usr/bin/env node
/**
 * Analyze how widespread the missing quantity issue is
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

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  console.log('='.repeat(80))
  console.log('ANALYZING MISSING QUANTITY DATA FOR HENSON')
  console.log('='.repeat(80))

  // Count shipment_items with and without quantity
  const { count: totalItems } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: itemsWithQty } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .not('quantity', 'is', null)

  const { count: itemsWithoutQty } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .is('quantity', null)

  console.log('\n--- SHIPMENT_ITEMS ---')
  console.log(`Total items: ${totalItems}`)
  console.log(`With quantity: ${itemsWithQty} (${((itemsWithQty / totalItems) * 100).toFixed(1)}%)`)
  console.log(`Without quantity (NULL): ${itemsWithoutQty} (${((itemsWithoutQty / totalItems) * 100).toFixed(1)}%)`)

  // Count distinct shipments
  const { data: shipmentsMissingQty } = await supabase
    .from('shipment_items')
    .select('shipment_id')
    .eq('client_id', HENSON_ID)
    .is('quantity', null)

  const uniqueShipmentsMissingQty = [...new Set(shipmentsMissingQty?.map(s => s.shipment_id))]
  console.log(`\nUnique shipments missing quantity: ${uniqueShipmentsMissingQty.length}`)

  // Break down by channel
  console.log('\n--- BREAKDOWN BY CHANNEL ---')

  const { data: channelBreakdown } = await supabase.rpc('exec_sql', {
    query: `
      SELECT
        COALESCE(s.channel_name, 'NULL') as channel,
        COUNT(DISTINCT si.shipment_id) as shipments_without_qty
      FROM shipment_items si
      JOIN shipments s ON si.shipment_id = s.shipment_id
      WHERE si.client_id = '${HENSON_ID}'
        AND si.quantity IS NULL
      GROUP BY s.channel_name
      ORDER BY shipments_without_qty DESC
    `
  })

  if (channelBreakdown) {
    for (const row of channelBreakdown) {
      console.log(`  ${row.channel}: ${row.shipments_without_qty} shipments`)
    }
  }

  // Check order_items count
  const { count: totalOrderItems } = await supabase
    .from('order_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  console.log('\n--- ORDER_ITEMS ---')
  console.log(`Total order items for Henson: ${totalOrderItems}`)

  // Sample some shipments with missing quantity to see their dates
  console.log('\n--- SAMPLE SHIPMENTS MISSING QUANTITY ---')

  if (uniqueShipmentsMissingQty.length > 0) {
    const sampleIds = uniqueShipmentsMissingQty.slice(0, 10)
    const { data: samples } = await supabase
      .from('shipments')
      .select('shipment_id, channel_name, status, created_at')
      .in('shipment_id', sampleIds)
      .order('created_at', { ascending: false })

    for (const s of samples || []) {
      console.log(`  ${s.shipment_id}: ${s.channel_name || 'NULL'} - ${s.status} - ${s.created_at?.slice(0, 10)}`)
    }
  }
}

main().catch(console.error)
