#!/usr/bin/env node
/**
 * Find shipments still failing withProductsSold validation
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
  console.log('Finding failing shipments in UNPROCESSED invoices...\n')

  // Get unprocessed ShipBob invoices (same as preflight validation)
  const { data: unprocessedInvoices } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_date')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  // transactions.invoice_id uses shipbob_invoice_id (the integer), not the internal id
  const invoiceIds = unprocessedInvoices
    ?.map(inv => parseInt(inv.shipbob_invoice_id, 10))
    .filter(id => !isNaN(id)) || []

  console.log('Unprocessed invoices:', invoiceIds.length)
  console.log('ShipBob Invoice IDs:', invoiceIds.join(', '))
  console.log('Dates:', unprocessedInvoices?.map(i => i.invoice_date).join(', '))

  // Get shipment IDs from these invoices for Henson
  // NOTE: transactions uses invoice_id_sb column (the shipbob integer ID)
  const { data: txns } = await supabase
    .from('transactions')
    .select('shipment_id, invoice_id_sb')
    .eq('client_id', HENSON_ID)
    .in('invoice_id_sb', invoiceIds)
    .not('shipment_id', 'is', null)

  const shipmentIds = [...new Set(txns?.map(t => t.shipment_id) || [])]
  console.log('\nHenson shipments in unprocessed invoices:', shipmentIds.length)

  // Check each shipment for withProductsSold status
  const failing = []

  for (const shipmentId of shipmentIds) {
    const { data: items } = await supabase
      .from('shipment_items')
      .select('name, quantity')
      .eq('shipment_id', shipmentId)

    const hasName = items?.some(i => i.name)
    const hasQuantity = items?.some(i => i.quantity !== null)

    if (!hasName || !hasQuantity) {
      // Get order info for this shipment
      const { data: shipment } = await supabase
        .from('shipments')
        .select('order_id, channel_name')
        .eq('shipment_id', shipmentId)
        .single()

      const { data: order } = await supabase
        .from('orders')
        .select('order_type, store_order_id, channel_name')
        .eq('id', shipment?.order_id)
        .single()

      // Check if this should be excluded
      const isB2B = order?.order_type === 'B2B'
      const isManual = !order?.store_order_id &&
        (!order?.channel_name || order?.channel_name === 'ShipBob Default' || order?.channel_name === 'N/A')

      if (!isB2B && !isManual) {
        failing.push({
          shipmentId,
          hasName,
          hasQuantity,
          orderType: order?.order_type,
          storeOrderId: order?.store_order_id,
          channel: order?.channel_name || shipment?.channel_name
        })
      }
    }
  }

  console.log('\nFailing (should not pass withProductsSold):', failing.length)
  failing.forEach(f => {
    console.log(`  - ${f.shipmentId}: hasName=${f.hasName}, hasQty=${f.hasQuantity}, type=${f.orderType}, storeId=${f.storeOrderId}, channel=${f.channel}`)
  })

  // If there are failures, check what items they have
  if (failing.length > 0) {
    console.log('\n--- DETAILS ---')
    for (const f of failing) {
      console.log(`\nShipment ${f.shipmentId}:`)

      const { data: items } = await supabase
        .from('shipment_items')
        .select('id, name, quantity, shipbob_product_id, sku')
        .eq('shipment_id', f.shipmentId)

      console.log('  Items:', items?.length || 0)
      for (const item of items || []) {
        console.log(`    - "${item.name}" qty=${item.quantity ?? 'NULL'} product_id=${item.shipbob_product_id} sku=${item.sku}`)
      }

      // Check order_items for this order
      const { data: shipment } = await supabase
        .from('shipments')
        .select('order_id')
        .eq('shipment_id', f.shipmentId)
        .single()

      if (shipment?.order_id) {
        const { data: orderItems } = await supabase
          .from('order_items')
          .select('shipbob_product_id, quantity, sku')
          .eq('order_id', shipment.order_id)

        console.log('  Order items:', orderItems?.length || 0)
        for (const oi of orderItems || []) {
          console.log(`    - product_id=${oi.shipbob_product_id} qty=${oi.quantity} sku=${oi.sku}`)
        }
      }
    }
  }
}

main().catch(console.error)
