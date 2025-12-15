#!/usr/bin/env node
/**
 * Compare shipment_items vs order_items for the failing shipments
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
  console.log('COMPARING SHIPMENT_ITEMS VS ORDER_ITEMS')
  console.log('='.repeat(80))

  for (const shipmentId of TARGET_SHIPMENTS) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`SHIPMENT ${shipmentId}`)
    console.log('='.repeat(60))

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, channel_name')
      .eq('shipment_id', shipmentId)
      .single()

    console.log(`Order UUID: ${shipment?.order_id}`)
    console.log(`Channel: ${shipment?.channel_name}`)

    // Get shipment_items
    console.log('\n--- SHIPMENT_ITEMS ---')
    const { data: siList } = await supabase
      .from('shipment_items')
      .select('id, name, sku, quantity, shipbob_product_id')
      .eq('shipment_id', shipmentId)

    for (const si of siList || []) {
      console.log(`  SKU: ${si.sku || 'NULL'}`)
      console.log(`    name: "${si.name}"`)
      console.log(`    quantity: ${si.quantity ?? 'NULL'}`)
      console.log(`    shipbob_product_id: ${si.shipbob_product_id || 'NULL'}`)
    }

    // Get order_items
    console.log('\n--- ORDER_ITEMS ---')
    const { data: oiList } = await supabase
      .from('order_items')
      .select('id, sku, quantity, shipbob_product_id, reference_id')
      .eq('order_id', shipment?.order_id)

    for (const oi of oiList || []) {
      console.log(`  SKU: ${oi.sku || 'NULL'}`)
      console.log(`    quantity: ${oi.quantity ?? 'NULL'}`)
      console.log(`    shipbob_product_id: ${oi.shipbob_product_id || 'NULL'}`)
      console.log(`    reference_id: ${oi.reference_id || 'NULL'}`)
    }

    // Try to match by shipbob_product_id
    console.log('\n--- MATCHING BY SHIPBOB_PRODUCT_ID ---')
    const oiByProductId = {}
    for (const oi of oiList || []) {
      if (oi.shipbob_product_id) {
        oiByProductId[oi.shipbob_product_id] = oi.quantity
      }
    }

    for (const si of siList || []) {
      if (si.shipbob_product_id) {
        const matchedQty = oiByProductId[si.shipbob_product_id]
        console.log(`  Product ${si.shipbob_product_id}: si.qty=${si.quantity ?? 'NULL'}, oi.qty=${matchedQty ?? 'NOT FOUND'}`)
      } else {
        console.log(`  Product NULL: "${si.name}" - no product_id to match`)
      }
    }

    // Try to match by partial name
    console.log('\n--- MATCHING BY NAME (fuzzy) ---')
    for (const si of siList || []) {
      const siName = si.name?.toLowerCase() || ''
      for (const oi of oiList || []) {
        const oiRef = oi.reference_id?.toLowerCase() || ''
        if (siName && oiRef && (siName.includes(oiRef) || oiRef.includes(siName))) {
          console.log(`  Possible match: "${si.name}" <-> ref:"${oi.reference_id}" qty=${oi.quantity}`)
        }
      }
    }
  }
}

main().catch(console.error)
