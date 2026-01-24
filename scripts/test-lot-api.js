#!/usr/bin/env node
/**
 * Test script to check what ShipBob API returns for lot/expiration data
 *
 * Usage: node scripts/test-lot-api.js
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

async function main() {
  // Get Methyl-Life (Eli) client credentials
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('client_id, api_token')
    .eq('provider', 'shipbob')

  if (!creds || creds.length === 0) {
    console.log('No ShipBob credentials found')
    return
  }

  // Find a recent delivered shipment for Methyl-Life
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')
    .ilike('company_name', '%methyl%')

  console.log('Clients:', clients)

  if (!clients || clients.length === 0) {
    console.log('No Methyl-Life client found')
    return
  }

  const clientId = clients[0].id
  const cred = creds.find(c => c.client_id === clientId)

  if (!cred) {
    console.log('No credentials for Methyl-Life')
    return
  }

  // Find a completed shipment with KIT-CL-4 (Cortisol Pack)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, tracking_id, status, created_at')
    .eq('client_id', clientId)
    .eq('status', 'Completed')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log('\nRecent delivered shipments:', shipments?.length)

  if (!shipments || shipments.length === 0) {
    console.log('No delivered shipments found')
    return
  }

  // Check each shipment's items
  for (const ship of shipments.slice(0, 3)) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Shipment: ${ship.shipment_id}`)
    console.log(`Order: ${ship.order_id}`)
    console.log(`Status: ${ship.status}`)

    // Check what's in the database
    const { data: dbItems } = await supabase
      .from('shipment_items')
      .select('sku, name, lot, expiration_date, quantity')
      .eq('shipment_id', ship.shipment_id)

    console.log('\n--- Database shipment_items ---')
    console.log(JSON.stringify(dbItems, null, 2))

    // Fetch from ShipBob Order API
    const { data: order } = await supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('id', ship.order_id)
      .single()

    if (order) {
      console.log('\n--- ShipBob Order API Response ---')
      try {
        const orderRes = await fetch(`${SHIPBOB_API_BASE}/order/${order.shipbob_order_id}`, {
          headers: { Authorization: `Bearer ${cred.api_token}` }
        })

        if (orderRes.ok) {
          const orderData = await orderRes.json()

          // Find the shipment in the order
          const apiShipment = orderData.shipments?.find(s => s.id === parseInt(ship.shipment_id))

          if (apiShipment) {
            console.log('Shipment products from Order API:')
            for (const prod of apiShipment.products || []) {
              console.log(`  Product: ${prod.name} (${prod.sku})`)
              console.log(`    inventory array:`, JSON.stringify(prod.inventory, null, 4))
            }
          }
        } else {
          console.log(`Order API error: ${orderRes.status}`)
        }
      } catch (e) {
        console.log('Order API error:', e.message)
      }

      // Also try the Shipment API directly
      console.log('\n--- ShipBob Shipment API Response ---')
      try {
        const shipRes = await fetch(`${SHIPBOB_API_BASE}/shipment/${ship.shipment_id}`, {
          headers: { Authorization: `Bearer ${cred.api_token}` }
        })

        if (shipRes.ok) {
          const shipData = await shipRes.json()
          console.log('Shipment products from Shipment API:')
          for (const prod of shipData.products || []) {
            console.log(`  Full product object:`, JSON.stringify(prod, null, 4))
          }
          // Also check if there's anything at the shipment level
          console.log('\n  Other shipment fields (keys):', Object.keys(shipData))
          if (shipData.inventory_items) {
            console.log('  inventory_items:', JSON.stringify(shipData.inventory_items, null, 4))
          }
          if (shipData.fulfillment_center) {
            console.log('  FC:', shipData.fulfillment_center)
          }
        } else {
          console.log(`Shipment API error: ${shipRes.status}`)
        }
      } catch (e) {
        console.log('Shipment API error:', e.message)
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500))
  }
}

main().catch(console.error)
