#!/usr/bin/env node
/**
 * Investigate why order_items lookup is failing
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

const TARGET_SHIPMENTS = ['314986466', '314477032']

async function main() {
  console.log('='.repeat(80))
  console.log('INVESTIGATING ORDER_ITEMS JOIN ISSUE')
  console.log('='.repeat(80))

  for (const shipmentId of TARGET_SHIPMENTS) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`SHIPMENT ${shipmentId}`)
    console.log('='.repeat(60))

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('shipment_id', shipmentId)
      .single()

    console.log('\n1. SHIPMENT TABLE:')
    console.log('  shipment_id:', shipment?.shipment_id)
    console.log('  order_id (UUID):', shipment?.order_id)
    console.log('  client_id:', shipment?.client_id)
    console.log('  channel_name:', shipment?.channel_name)

    // Get order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', shipment?.order_id)
      .single()

    console.log('\n2. ORDERS TABLE (by shipment.order_id = orders.id):')
    if (orderError) {
      console.log('  ERROR:', orderError.message)
    } else {
      console.log('  id (UUID):', order?.id)
      console.log('  shipbob_order_id:', order?.shipbob_order_id)
      console.log('  order_number:', order?.order_number)
      console.log('  order_type:', order?.order_type)
      console.log('  store_order_id:', order?.store_order_id)
      console.log('  channel_name:', order?.channel_name)
    }

    // Check order_items schema - what column does it use?
    console.log('\n3. ORDER_ITEMS - Check what columns exist:')
    const { data: sampleOrderItems } = await supabase
      .from('order_items')
      .select('*')
      .limit(1)

    if (sampleOrderItems?.length) {
      console.log('  Columns:', Object.keys(sampleOrderItems[0]).join(', '))
    }

    // Try different columns for joining
    console.log('\n4. ORDER_ITEMS - Query by orders.id (UUID):')
    const { data: oi1, error: oi1Error } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', shipment?.order_id)

    console.log('  Found:', oi1?.length || 0, 'items')
    if (oi1Error) console.log('  Error:', oi1Error.message)

    // Try by shipbob_order_id
    console.log('\n5. ORDER_ITEMS - Query by shipbob_order_id:')
    const { data: oi2, error: oi2Error } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', order?.shipbob_order_id)

    console.log('  Found:', oi2?.length || 0, 'items')
    if (oi2Error) console.log('  Error:', oi2Error.message)
    if (oi2?.length) {
      for (const item of oi2) {
        console.log(`    - ${item.sku}: "${item.name}" qty=${item.quantity}`)
      }
    }

    // Check if order_items.order_id is string or int
    console.log('\n6. Check order_items.order_id type:')
    const { data: oi3 } = await supabase
      .from('order_items')
      .select('order_id')
      .limit(5)

    if (oi3?.length) {
      for (const item of oi3) {
        console.log(`  order_id: ${item.order_id} (type: ${typeof item.order_id})`)
      }
    }

    // Look for order_items by shipbob_order_id as a string
    if (order?.shipbob_order_id) {
      console.log('\n7. ORDER_ITEMS - Query by shipbob_order_id as string:')
      const { data: oi4 } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', String(order.shipbob_order_id))

      console.log('  Found:', oi4?.length || 0, 'items')
      if (oi4?.length) {
        for (const item of oi4) {
          console.log(`    - ${item.sku}: "${item.name}" qty=${item.quantity}`)
        }
      }
    }

    // Search all order_items for any with matching SKUs
    console.log('\n8. SEARCH ORDER_ITEMS BY SKU:')
    const { data: shipmentItems } = await supabase
      .from('shipment_items')
      .select('sku, name')
      .eq('shipment_id', shipmentId)

    for (const si of shipmentItems || []) {
      if (si.sku) {
        const { data: matching } = await supabase
          .from('order_items')
          .select('order_id, sku, quantity, name')
          .eq('sku', si.sku)
          .limit(3)

        console.log(`  SKU ${si.sku}: ${matching?.length || 0} matches in order_items`)
        if (matching?.length) {
          for (const m of matching) {
            console.log(`    order_id: ${m.order_id}, qty: ${m.quantity}`)
          }
        }
      }
    }
  }
}

main().catch(console.error)
