#!/usr/bin/env node
/**
 * Check the 2 remaining sjconsulting shipments that are still failing
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

// The 2 sjconsulting shipments that should still be failing
const SHIPMENTS = ['314477032', '325911412']

async function main() {
  console.log('='.repeat(60))
  console.log('CHECKING REMAINING 2 FAILING SHIPMENTS')
  console.log('='.repeat(60))

  for (const sid of SHIPMENTS) {
    console.log('\n' + '-'.repeat(40))
    console.log('Shipment:', sid)

    const { data: s } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, channel_name')
      .eq('shipment_id', sid)
      .single()

    if (!s) {
      console.log('NOT FOUND')
      continue
    }

    const { data: o } = await supabase
      .from('orders')
      .select('id, order_type, store_order_id, channel_name')
      .eq('id', s.order_id)
      .single()

    const { data: items } = await supabase
      .from('shipment_items')
      .select('name, quantity')
      .eq('shipment_id', sid)

    console.log('Shipment channel:', s.channel_name || 'NULL')
    console.log('Order channel:', o?.channel_name || 'NULL')
    console.log('Order type:', o?.order_type || 'NULL')
    console.log('Store order ID:', o?.store_order_id || 'NULL')
    console.log('Shipment items:', items?.length || 0)

    if (items && items.length > 0) {
      items.forEach(i => console.log('  -', i.name, 'qty:', i.quantity ?? 'NULL'))
    }

    // Show why it's failing
    const hasName = items && items.length > 0 && items.some(i => i.name)
    const hasQuantity = items && items.length > 0 && items.some(i => i.quantity !== null)

    console.log('\nValidation status:')
    console.log('  hasName:', hasName)
    console.log('  hasQuantity:', hasQuantity)
    console.log('  isB2B:', o?.order_type === 'B2B')
    console.log('  isManualOrder:', !o?.store_order_id && (!o?.channel_name || o.channel_name === 'ShipBob Default' || o.channel_name === 'N/A'))
    console.log('  WOULD PASS:', hasName && hasQuantity || o?.order_type === 'B2B' || (!o?.store_order_id && (!o?.channel_name || o.channel_name === 'ShipBob Default' || o.channel_name === 'N/A')))
  }

  // Check if there are other failing shipments from the Dec 8 invoices
  console.log('\n' + '='.repeat(60))
  console.log('CHECKING ALL HENSON SHIPMENTS ON DEC 8 INVOICES')
  console.log('='.repeat(60))

  const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const INVOICE_IDS = [8661966, 8661967, 8661968, 8661969]

  // Get all shipping transactions for these invoices
  const { data: txs } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', INVOICE_IDS)

  const shipmentIds = [...new Set(txs?.map(t => t.reference_id) || [])]
  console.log('Total shipments on Dec 8 invoices:', shipmentIds.length)

  // Check which ones are missing products_sold
  let failingCount = 0
  const failingShipments = []

  for (const sid of shipmentIds) {
    const { data: s } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, channel_name')
      .eq('shipment_id', sid)
      .single()

    if (!s) continue

    const { data: o } = await supabase
      .from('orders')
      .select('order_type, store_order_id, channel_name')
      .eq('id', s.order_id)
      .single()

    const { data: items } = await supabase
      .from('shipment_items')
      .select('name, quantity')
      .eq('shipment_id', sid)

    // Check validation
    const hasName = items && items.length > 0 && items.some(i => i.name)
    const hasQuantity = items && items.length > 0 && items.some(i => i.quantity !== null)
    const isB2B = o?.order_type === 'B2B'
    const isManualOrder = !o?.store_order_id && (!o?.channel_name || o.channel_name === 'ShipBob Default' || o.channel_name === 'N/A')

    const wouldPass = (hasName && hasQuantity) || isB2B || isManualOrder

    if (!wouldPass) {
      failingCount++
      failingShipments.push({
        shipment_id: sid,
        channel: s.channel_name,
        order_type: o?.order_type,
        store_order_id: o?.store_order_id,
        items: items?.length || 0,
        hasName,
        hasQuantity
      })
    }
  }

  console.log('\nShipments that would FAIL products_sold validation:', failingCount)
  if (failingShipments.length > 0) {
    console.log('\nFailing shipments details:')
    for (const f of failingShipments) {
      console.log(`  ${f.shipment_id}: channel=${f.channel || 'NULL'}, type=${f.order_type || 'NULL'}, store_id=${f.store_order_id || 'NULL'}, items=${f.items}, hasName=${f.hasName}, hasQty=${f.hasQuantity}`)
    }
  }
}

main().catch(console.error)
