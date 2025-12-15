#!/usr/bin/env node
/**
 * Debug: Check a RECENT shipment to see API structure for quantity
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

async function main() {
  console.log('='.repeat(80))
  console.log('DEBUG: RECENT SHIPMENT API STRUCTURE')
  console.log('='.repeat(80))

  const token = await getApiToken(HENSON_ID)
  if (!token) {
    console.log('ERROR: No API token found')
    return
  }

  // Get a recent completed shipment from Henson
  const { data: recentShipments } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, channel_name, status, created_at')
    .eq('client_id', HENSON_ID)
    .eq('status', 'Completed')
    .order('created_at', { ascending: false })
    .limit(5)

  console.log('\nRecent shipments to check:')
  for (const s of recentShipments || []) {
    console.log(`  ${s.shipment_id} - ${s.channel_name} - ${s.created_at}`)
  }

  for (const shipment of recentShipments || []) {
    console.log('\n' + '='.repeat(60))
    console.log(`SHIPMENT ${shipment.shipment_id} (${shipment.channel_name})`)
    console.log('='.repeat(60))

    // Check our DB
    const { data: dbItems } = await supabase
      .from('shipment_items')
      .select('*')
      .eq('shipment_id', shipment.shipment_id)

    console.log('\nOUR DB shipment_items:', dbItems?.length || 0)
    if (dbItems?.length) {
      dbItems.forEach(item => {
        console.log(`  - name: "${item.name}", quantity: ${item.quantity ?? 'NULL'}`)
      })
    }

    // Check API
    const apiData = await fetchShipmentFromApi(token, shipment.shipment_id)

    if (apiData.error) {
      console.log(`\nAPI: ${apiData.error}`)
      continue
    }

    console.log('\nAPI shipment.products:', apiData.products?.length || 0)
    if (apiData.products?.length) {
      apiData.products.forEach(p => {
        console.log(`  - name: "${p.name}", quantity: ${p.quantity}, sku: ${p.sku}`)
        // Print ALL fields on product to see what's available
        console.log(`    ALL FIELDS: ${JSON.stringify(p)}`)
      })
    }

    // If we found one that works, we're done
    if (!apiData.error && apiData.products?.length) {
      console.log('\n\n' + '='.repeat(80))
      console.log('FOUND ACCESSIBLE SHIPMENT - FULL API RESPONSE')
      console.log('='.repeat(80))
      console.log(JSON.stringify(apiData, null, 2))
      break
    }
  }
}

main().catch(console.error)
