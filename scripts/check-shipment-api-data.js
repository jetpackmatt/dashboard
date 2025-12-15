#!/usr/bin/env node
/**
 * Check what ShipBob API returns for the shipments missing quantity data
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

// Shipments missing quantity
const HENSON_SHIPMENTS = ['314986466', '314477032', '317488641', '325911412']
const METHYL_SHIPMENTS = ['325023757', '324708598']

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const METHYL_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'

async function getApiToken(clientId) {
  const { data } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single()
  return data?.api_token
}

async function fetchShipmentFromApi(token, shipmentId) {
  const url = `https://api.shipbob.com/1.0/shipment/${shipmentId}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'shipbob_channel_id': '0' // Use root to see all
    }
  })

  if (!response.ok) {
    return { error: `HTTP ${response.status}` }
  }
  return response.json()
}

async function checkShipments(clientId, clientName, shipmentIds) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`CHECKING ${clientName} SHIPMENTS`)
  console.log('='.repeat(80))

  const token = await getApiToken(clientId)
  if (!token) {
    console.log('ERROR: No API token found')
    return
  }

  for (const shipmentId of shipmentIds) {
    console.log(`\n--- Shipment ${shipmentId} ---`)

    // Check what's in our database
    const { data: dbShipment } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, channel_name, status')
      .eq('shipment_id', shipmentId)
      .single()

    const { data: dbItems } = await supabase
      .from('shipment_items')
      .select('name, quantity, product_id, inventory_item_id')
      .eq('shipment_id', shipmentId)

    console.log('\nDB data:')
    console.log(`  channel: ${dbShipment?.channel_name}`)
    console.log(`  status: ${dbShipment?.status}`)
    console.log(`  items in DB: ${dbItems?.length || 0}`)
    if (dbItems?.length) {
      dbItems.forEach(item => {
        console.log(`    - name: "${item.name}", qty: ${item.quantity ?? 'NULL'}, product_id: ${item.product_id || 'NULL'}`)
      })
    }

    // Check order_items
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('name, quantity')
      .eq('order_id', dbShipment?.order_id)

    console.log(`  order_items in DB: ${orderItems?.length || 0}`)
    if (orderItems?.length) {
      orderItems.forEach(item => {
        console.log(`    - name: "${item.name}", qty: ${item.quantity ?? 'NULL'}`)
      })
    }

    // Fetch from API
    console.log('\nAPI response:')
    const apiData = await fetchShipmentFromApi(token, shipmentId)

    if (apiData.error) {
      console.log(`  ERROR: ${apiData.error}`)
      continue
    }

    console.log(`  status: ${apiData.status}`)
    console.log(`  channel: ${apiData.channel?.name || 'N/A'}`)

    // Check products array
    if (apiData.products && apiData.products.length > 0) {
      console.log(`  products: ${apiData.products.length} items`)
      apiData.products.forEach(p => {
        console.log(`    - name: "${p.name}", qty: ${p.quantity}, sku: ${p.sku || 'N/A'}`)
      })
    } else {
      console.log('  products: NONE - API returns empty/null products array')
    }

    // Check inventory array (some endpoints use this)
    if (apiData.inventory && apiData.inventory.length > 0) {
      console.log(`  inventory: ${apiData.inventory.length} items`)
      apiData.inventory.forEach(inv => {
        console.log(`    - name: "${inv.name}", qty: ${inv.quantity}`)
      })
    }
  }
}

async function main() {
  console.log('='.repeat(80))
  console.log('INVESTIGATING SHIPMENTS MISSING QUANTITY DATA')
  console.log('='.repeat(80))

  await checkShipments(HENSON_ID, 'HENSON', HENSON_SHIPMENTS)
  await checkShipments(METHYL_ID, 'METHYL-LIFE', METHYL_SHIPMENTS)
}

main().catch(console.error)
