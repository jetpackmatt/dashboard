#!/usr/bin/env node
/**
 * Debug: Compare product IDs between order_items and shipment_items
 * to understand why quantity lookup might fail
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

// Problem shipments with NULL quantity
const PROBLEM_SHIPMENTS = ['314477032', '325911412']

// Recent shipments that DO have quantity
const WORKING_SHIPMENTS = ['327934173', '327933782']

async function analyzeShipment(shipmentId) {
  console.log('\n' + '='.repeat(60))
  console.log(`SHIPMENT ${shipmentId}`)
  console.log('='.repeat(60))

  // Get shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, channel_name')
    .eq('shipment_id', shipmentId)
    .single()

  if (!shipment) {
    console.log('NOT FOUND')
    return
  }

  console.log('Channel:', shipment.channel_name || 'NULL')
  console.log('Order ID:', shipment.order_id)

  // Get shipment_items
  const { data: shipmentItems } = await supabase
    .from('shipment_items')
    .select('shipbob_product_id, name, quantity, sku')
    .eq('shipment_id', shipmentId)

  console.log('\nshipment_items:', shipmentItems?.length || 0)
  for (const item of shipmentItems || []) {
    console.log(`  product_id: ${item.shipbob_product_id || 'NULL'}, name: "${item.name}", qty: ${item.quantity ?? 'NULL'}, sku: ${item.sku || 'NULL'}`)
  }

  // Get order_items
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('shipbob_product_id, name, quantity, sku')
    .eq('order_id', shipment.order_id)

  console.log('\norder_items:', orderItems?.length || 0)
  for (const item of orderItems || []) {
    console.log(`  product_id: ${item.shipbob_product_id || 'NULL'}, name: "${item.name}", qty: ${item.quantity ?? 'NULL'}, sku: ${item.sku || 'NULL'}`)
  }

  // Check if product_ids match
  const shipmentProductIds = new Set((shipmentItems || []).map(i => i.shipbob_product_id).filter(Boolean))
  const orderProductIds = new Set((orderItems || []).map(i => i.shipbob_product_id).filter(Boolean))

  console.log('\nProduct ID Analysis:')
  console.log(`  Shipment product IDs: ${[...shipmentProductIds].join(', ') || 'NONE'}`)
  console.log(`  Order product IDs: ${[...orderProductIds].join(', ') || 'NONE'}`)

  const commonIds = [...shipmentProductIds].filter(id => orderProductIds.has(id))
  console.log(`  Common IDs: ${commonIds.join(', ') || 'NONE'}`)

  if (shipmentProductIds.size > 0 && commonIds.length === 0) {
    console.log('  ⚠️ PRODUCT IDs DO NOT MATCH - quantity lookup will fail!')
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('ANALYZING PRODUCT ID MATCHING FOR QUANTITY LOOKUP')
  console.log('='.repeat(80))

  console.log('\n--- PROBLEM SHIPMENTS (NULL quantity) ---')
  for (const id of PROBLEM_SHIPMENTS) {
    await analyzeShipment(id)
  }

  console.log('\n\n--- WORKING SHIPMENTS (have quantity) ---')
  for (const id of WORKING_SHIPMENTS) {
    await analyzeShipment(id)
  }
}

main().catch(console.error)
