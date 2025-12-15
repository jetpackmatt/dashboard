#!/usr/bin/env node
/**
 * Deep investigation into the 2 failing shipments:
 * - 314986466 (hs-wholesale, 7 items)
 * - 314477032 (sjconsulting, 3 items)
 *
 * Goal: Find where the quantity data IS stored and fix the sync
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
const FAILING_SHIPMENTS = ['314986466', '314477032']

async function getApiToken(clientId) {
  const { data } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single()
  return data?.api_token
}

async function main() {
  console.log('='.repeat(80))
  console.log('DEEP INVESTIGATION: 2 FAILING SHIPMENTS')
  console.log('='.repeat(80))

  const token = await getApiToken(HENSON_ID)

  for (const shipmentId of FAILING_SHIPMENTS) {
    console.log('\n' + '='.repeat(60))
    console.log(`SHIPMENT ${shipmentId}`)
    console.log('='.repeat(60))

    // Get shipment details
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('shipment_id', shipmentId)
      .single()

    console.log('\n--- SHIPMENT TABLE ---')
    console.log('Order ID:', shipment?.order_id)
    console.log('Channel:', shipment?.channel_name)
    console.log('Status:', shipment?.status)
    console.log('Created:', shipment?.created_at)

    // Get order details
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', shipment?.order_id)
      .single()

    console.log('\n--- ORDER TABLE ---')
    console.log('ShipBob Order ID:', order?.shipbob_order_id)
    console.log('Order Type:', order?.order_type)
    console.log('Channel:', order?.channel_name)
    console.log('Store Order ID:', order?.store_order_id)
    console.log('Order Number:', order?.order_number)

    // Get shipment_items
    const { data: shipmentItems } = await supabase
      .from('shipment_items')
      .select('*')
      .eq('shipment_id', shipmentId)

    console.log('\n--- SHIPMENT_ITEMS TABLE ---')
    console.log('Count:', shipmentItems?.length)
    for (const item of shipmentItems || []) {
      console.log(`  ID: ${item.id}`)
      console.log(`    name: "${item.name}"`)
      console.log(`    quantity: ${item.quantity ?? 'NULL'}`)
      console.log(`    shipbob_product_id: ${item.shipbob_product_id || 'NULL'}`)
      console.log(`    sku: ${item.sku || 'NULL'}`)
      console.log(`    inventory_item_id: ${item.inventory_item_id || 'NULL'}`)
    }

    // Get order_items for this order
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', shipment?.order_id)

    console.log('\n--- ORDER_ITEMS TABLE ---')
    console.log('Count:', orderItems?.length)
    for (const item of orderItems || []) {
      console.log(`  shipbob_product_id: ${item.shipbob_product_id || 'NULL'}`)
      console.log(`    name: "${item.name}"`)
      console.log(`    quantity: ${item.quantity ?? 'NULL'}`)
      console.log(`    sku: ${item.sku || 'NULL'}`)
    }

    // Try to match shipment_items to order_items by SKU
    console.log('\n--- SKU MATCHING ANALYSIS ---')
    const skuToQty = {}
    for (const oi of orderItems || []) {
      if (oi.sku && oi.quantity) {
        skuToQty[oi.sku] = oi.quantity
      }
    }

    for (const si of shipmentItems || []) {
      if (si.sku) {
        const matchedQty = skuToQty[si.sku]
        console.log(`  SKU ${si.sku}: shipment_item.qty=${si.quantity ?? 'NULL'}, order_item.qty=${matchedQty ?? 'NOT FOUND'}`)
      }
    }

    // Try API call
    console.log('\n--- SHIPBOB API CHECK ---')
    const shipmentUrl = `https://api.shipbob.com/1.0/shipment/${shipmentId}`
    const shipmentRes = await fetch(shipmentUrl, {
      headers: { 'Authorization': `Bearer ${token}`, 'shipbob_channel_id': '0' }
    })
    console.log(`Shipment API: HTTP ${shipmentRes.status}`)

    if (order?.shipbob_order_id) {
      const orderUrl = `https://api.shipbob.com/1.0/order/${order.shipbob_order_id}`
      const orderRes = await fetch(orderUrl, {
        headers: { 'Authorization': `Bearer ${token}`, 'shipbob_channel_id': '0' }
      })
      console.log(`Order API: HTTP ${orderRes.status}`)

      if (orderRes.ok) {
        const orderData = await orderRes.json()
        console.log('\n--- ORDER API RESPONSE ---')
        console.log('Products:', orderData.products?.length || 0)
        for (const p of orderData.products || []) {
          console.log(`  id: ${p.id}, name: "${p.name}", qty: ${p.quantity}, sku: ${p.sku}`)
        }

        console.log('\nShipments in Order:', orderData.shipments?.length || 0)
        for (const s of orderData.shipments || []) {
          console.log(`  Shipment ID: ${s.id}`)
          console.log(`  Products: ${s.products?.length || 0}`)
          for (const p of s.products || []) {
            console.log(`    id: ${p.id}, name: "${p.name}", qty: ${p.quantity}, sku: ${p.sku}`)
            if (p.inventory) {
              for (const inv of p.inventory) {
                console.log(`      inventory: qty=${inv.quantity}, lot=${inv.lot}`)
              }
            }
          }
        }
      }
    }
  }
}

main().catch(console.error)
