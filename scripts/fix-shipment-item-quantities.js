#!/usr/bin/env node
/**
 * Fix shipment_items with NULL quantity by copying from order_items using shipbob_product_id matching
 *
 * Root cause: The sync code doesn't populate quantity for some archived shipments.
 * But order_items HAS the quantities with matching shipbob_product_id.
 *
 * This script:
 * 1. Finds shipment_items with NULL quantity
 * 2. Looks up the corresponding order_items by order_id and shipbob_product_id
 * 3. Updates shipment_items.quantity from order_items.quantity
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

// The 2 failing shipments from Dec 8 invoices
const TARGET_SHIPMENTS = ['314986466', '314477032']

async function fixShipmentItemQuantities() {
  console.log('='.repeat(80))
  console.log('FIXING SHIPMENT_ITEMS QUANTITY FROM ORDER_ITEMS BY SHIPBOB_PRODUCT_ID')
  console.log('='.repeat(80))

  let totalFixed = 0

  for (const shipmentId of TARGET_SHIPMENTS) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`SHIPMENT ${shipmentId}`)
    console.log('='.repeat(60))

    // Get shipment to find order_id
    const { data: shipment } = await supabase
      .from('shipments')
      .select('shipment_id, order_id')
      .eq('shipment_id', shipmentId)
      .single()

    if (!shipment) {
      console.log('  ERROR: Shipment not found')
      continue
    }

    console.log(`  Order ID: ${shipment.order_id}`)

    // Get shipment_items with NULL quantity
    const { data: shipmentItems } = await supabase
      .from('shipment_items')
      .select('id, shipment_id, shipbob_product_id, name, quantity')
      .eq('shipment_id', shipmentId)
      .is('quantity', null)

    if (!shipmentItems || shipmentItems.length === 0) {
      console.log('  No shipment_items with NULL quantity')
      continue
    }

    console.log(`  Found ${shipmentItems.length} shipment_items with NULL quantity`)

    // Get order_items for this order
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('shipbob_product_id, quantity')
      .eq('order_id', shipment.order_id)

    if (!orderItems || orderItems.length === 0) {
      console.log('  ERROR: No order_items found for this order')
      continue
    }

    console.log(`  Found ${orderItems.length} order_items`)

    // Build shipbob_product_id -> quantity map from order_items
    const productIdToQuantity = {}
    for (const oi of orderItems) {
      if (oi.shipbob_product_id && oi.quantity !== null) {
        productIdToQuantity[oi.shipbob_product_id] = oi.quantity
        console.log(`    product_id ${oi.shipbob_product_id} -> qty ${oi.quantity}`)
      }
    }

    // Update shipment_items
    for (const si of shipmentItems) {
      if (!si.shipbob_product_id) {
        console.log(`  SKIP: shipment_item ${si.id} has no shipbob_product_id`)
        continue
      }

      const quantity = productIdToQuantity[si.shipbob_product_id]
      if (quantity === undefined) {
        console.log(`  SKIP: product_id ${si.shipbob_product_id} not found in order_items`)
        continue
      }

      console.log(`  UPDATE: "${si.name}" (product_id: ${si.shipbob_product_id}) -> quantity = ${quantity}`)

      const { error } = await supabase
        .from('shipment_items')
        .update({ quantity })
        .eq('id', si.id)

      if (error) {
        console.log(`    ERROR: ${error.message}`)
      } else {
        console.log(`    ✓ Updated`)
        totalFixed++
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`DONE: Fixed ${totalFixed} shipment_items`)
  console.log('='.repeat(80))
}

// Verify fix
async function verifyFix() {
  console.log('\n\nVERIFYING FIX...\n')

  for (const shipmentId of TARGET_SHIPMENTS) {
    const { data: items } = await supabase
      .from('shipment_items')
      .select('shipbob_product_id, name, quantity')
      .eq('shipment_id', shipmentId)

    console.log(`Shipment ${shipmentId}:`)
    for (const item of items || []) {
      const status = item.quantity !== null ? '✓' : '✗'
      console.log(`  ${status} ${item.shipbob_product_id}: "${item.name}" -> qty=${item.quantity ?? 'NULL'}`)
    }
  }
}

async function main() {
  await fixShipmentItemQuantities()
  await verifyFix()
}

main().catch(console.error)
