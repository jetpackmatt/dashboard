#!/usr/bin/env node
/**
 * Debug: Check ALL fields returned by ShipBob API for shipments
 * to find where quantity data lives
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
const SHIPMENTS = ['314477032', '325911412']

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
      'shipbob_channel_id': '0'
    }
  })

  if (!response.ok) {
    return { error: `HTTP ${response.status}`, status: response.status }
  }
  return response.json()
}

async function fetchOrderFromApi(token, orderId) {
  const url = `https://api.shipbob.com/1.0/order/${orderId}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'shipbob_channel_id': '0'
    }
  })

  if (!response.ok) {
    return { error: `HTTP ${response.status}`, status: response.status }
  }
  return response.json()
}

async function main() {
  console.log('='.repeat(80))
  console.log('DEBUG: SHIPBOB API FIELDS FOR QUANTITY DATA')
  console.log('='.repeat(80))

  const token = await getApiToken(HENSON_ID)
  if (!token) {
    console.log('ERROR: No API token found')
    return
  }

  for (const shipmentId of SHIPMENTS) {
    console.log('\n' + '='.repeat(80))
    console.log(`SHIPMENT ${shipmentId}`)
    console.log('='.repeat(80))

    // Get shipment from our DB
    const { data: dbShipment } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, channel_name, status')
      .eq('shipment_id', shipmentId)
      .single()

    console.log('\n--- OUR DATABASE ---')
    console.log('Order ID:', dbShipment?.order_id)
    console.log('Channel:', dbShipment?.channel_name)
    console.log('Status:', dbShipment?.status)

    // Get shipment_items from our DB
    const { data: dbItems } = await supabase
      .from('shipment_items')
      .select('*')
      .eq('shipment_id', shipmentId)

    console.log('\nshipment_items in DB:', dbItems?.length || 0)
    if (dbItems?.length) {
      dbItems.forEach(item => {
        console.log(`  - name: "${item.name}", quantity: ${item.quantity ?? 'NULL'}, product_id: ${item.product_id || 'NULL'}`)
      })
    }

    // Get order_items from our DB
    const { data: dbOrderItems } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', dbShipment?.order_id)

    console.log('\norder_items in DB:', dbOrderItems?.length || 0)
    if (dbOrderItems?.length) {
      dbOrderItems.forEach(item => {
        console.log(`  - name: "${item.name}", quantity: ${item.quantity ?? 'NULL'}`)
      })
    }

    // Fetch from ShipBob API - SHIPMENT endpoint
    console.log('\n--- SHIPBOB API: SHIPMENT ENDPOINT ---')
    const shipmentData = await fetchShipmentFromApi(token, shipmentId)

    if (shipmentData.error) {
      console.log(`ERROR: ${shipmentData.error}`)
    } else {
      // Print raw products array
      console.log('\nshipment.products:', JSON.stringify(shipmentData.products, null, 2))

      // Check other potential quantity fields
      console.log('\nOther potential fields:')
      console.log('  shipment.inventory:', shipmentData.inventory ? JSON.stringify(shipmentData.inventory, null, 2) : 'N/A')
      console.log('  shipment.items:', shipmentData.items ? JSON.stringify(shipmentData.items, null, 2) : 'N/A')
      console.log('  shipment.line_items:', shipmentData.line_items ? JSON.stringify(shipmentData.line_items, null, 2) : 'N/A')

      // Print all top-level keys
      console.log('\nAll top-level keys in shipment response:')
      Object.keys(shipmentData).forEach(key => {
        const val = shipmentData[key]
        const type = Array.isArray(val) ? `array[${val.length}]` : typeof val
        console.log(`  ${key}: ${type}`)
      })
    }

    // Fetch from ShipBob API - ORDER endpoint
    console.log('\n--- SHIPBOB API: ORDER ENDPOINT ---')

    // Get the ShipBob order_id from our orders table
    const { data: ourOrder } = await supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('id', dbShipment?.order_id)
      .single()

    if (ourOrder?.shipbob_order_id) {
      const orderData = await fetchOrderFromApi(token, ourOrder.shipbob_order_id)

      if (orderData.error) {
        console.log(`ERROR: ${orderData.error}`)
      } else {
        // Print raw products array from order
        console.log('\norder.products:', JSON.stringify(orderData.products, null, 2))

        // Check shipments within order
        if (orderData.shipments && orderData.shipments.length > 0) {
          console.log('\norder.shipments:')
          orderData.shipments.forEach((s, i) => {
            console.log(`  Shipment ${i + 1} (ID: ${s.id}):`)
            console.log(`    products: ${JSON.stringify(s.products, null, 2)}`)
            console.log(`    inventory: ${s.inventory ? JSON.stringify(s.inventory, null, 2) : 'N/A'}`)
          })
        }

        // Print all top-level keys
        console.log('\nAll top-level keys in order response:')
        Object.keys(orderData).forEach(key => {
          const val = orderData[key]
          const type = Array.isArray(val) ? `array[${val.length}]` : typeof val
          console.log(`  ${key}: ${type}`)
        })
      }
    } else {
      console.log('No shipbob_order_id found in our database')
    }
  }
}

main().catch(console.error)
