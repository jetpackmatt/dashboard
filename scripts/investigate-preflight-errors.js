#!/usr/bin/env node
/**
 * Investigate preflight validation errors for Dec 8 invoices
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhehiuanvcowiktcsmjr.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Client IDs
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const METHYL_ID = 'a08be540-b912-4f74-a857-958b9f8e2cc5'

async function main() {
  console.log('='.repeat(80))
  console.log('INVESTIGATING PREFLIGHT VALIDATION ERRORS')
  console.log('='.repeat(80))

  // 1. Get ALL ShipBob invoices that haven't been processed yet
  console.log('\n1. Getting all unprocessed ShipBob invoices...')
  const { data: allInvoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, client_id, invoice_type, invoice_date, base_amount')
    .is('jetpack_invoice_id', null)
    .order('invoice_date', { ascending: false })
    .limit(20)

  console.log(`Found ${allInvoices?.length || 0} unprocessed invoices:`)
  allInvoices?.forEach(i => console.log(`  - ${i.shipbob_invoice_id} | ${i.invoice_date} | ${i.invoice_type} | $${i.base_amount}`))

  // 2. Check Methyl-Life specifically - find their invoices
  console.log('\n' + '='.repeat(80))
  console.log('2. Finding Methyl-Life transactions by charge date...')

  const { data: methylTx } = await supabase
    .from('transactions')
    .select('transaction_id, invoice_id_sb, fee_type, cost, charge_date')
    .eq('client_id', METHYL_ID)
    .eq('fee_type', 'Shipping')
    .gte('charge_date', '2025-12-01')
    .lte('charge_date', '2025-12-07')
    .limit(20)

  console.log(`Methyl-Life shipping transactions (Dec 1-7): ${methylTx?.length || 0}`)
  const methylInvoices = [...new Set(methylTx?.map(t => t.invoice_id_sb))]
  console.log('Invoice IDs:', methylInvoices)

  if (methylInvoices.length > 0) {
    // Check invoice details
    const { data: methylInvoiceDetails } = await supabase
      .from('invoices_sb')
      .select('shipbob_invoice_id, invoice_date, jetpack_invoice_id')
      .in('shipbob_invoice_id', methylInvoices)

    console.log('\nMethyl-Life invoice details:')
    methylInvoiceDetails?.forEach(i => {
      console.log(`  - ${i.shipbob_invoice_id} | date: ${i.invoice_date} | processed: ${i.jetpack_invoice_id || 'NO'}`)
    })
  }

  // 3. Check WRO reference_type breakdown by invoice_type
  console.log('\n' + '='.repeat(80))
  console.log('3. Henson WRO transactions breakdown by invoice_type...')

  const { data: wroTx } = await supabase
    .from('transactions')
    .select('reference_id, fee_type, cost, charge_date, invoice_id_sb')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'WRO')
    .gte('charge_date', '2025-12-01')
    .lte('charge_date', '2025-12-07')

  // Group by fee_type
  const feeTypeCounts = {}
  wroTx?.forEach(tx => {
    feeTypeCounts[tx.fee_type] = (feeTypeCounts[tx.fee_type] || 0) + 1
  })

  console.log(`\nWRO transactions by fee_type:`)
  Object.entries(feeTypeCounts).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`)
  })

  console.log('\nWRO transactions detail:')
  wroTx?.forEach(tx => {
    console.log(`  - WRO ${tx.reference_id} | ${tx.fee_type} | $${tx.cost} | invoice: ${tx.invoice_id_sb}`)
  })

  // 4. Get total shipping transaction count for Henson (paginated)
  console.log('\n' + '='.repeat(80))
  console.log('4. Henson total shipping transactions count...')

  const invoiceIds = [8661969, 8661968, 8661967, 8661966]
  let totalShipping = 0
  let offset = 0
  const PAGE_SIZE = 1000

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('transaction_id', { count: 'exact' })
      .eq('client_id', HENSON_ID)
      .eq('fee_type', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + PAGE_SIZE - 1)

    if (!batch || batch.length === 0) break
    totalShipping += batch.length
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log(`Total Henson shipping transactions: ${totalShipping}`)

  // 5. Check shipment_items completeness (with order_items fallback like preflight does)
  console.log('\n' + '='.repeat(80))
  console.log('5. Checking shipment_items with order_items fallback...')

  // Get all shipping transactions with reference_id
  offset = 0
  const allShipmentIds = []
  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('reference_id')
      .eq('client_id', HENSON_ID)
      .eq('fee_type', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + PAGE_SIZE - 1)

    if (!batch || batch.length === 0) break
    allShipmentIds.push(...batch.map(t => t.reference_id).filter(Boolean))
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log(`Total shipment IDs to check: ${allShipmentIds.length}`)

  // Get shipment_items for all these shipments (batched)
  const shipmentItemsMap = new Map() // shipment_id -> {hasName, hasQty}

  for (let i = 0; i < allShipmentIds.length; i += 500) {
    const batch = allShipmentIds.slice(i, i + 500)
    const { data: items } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .eq('client_id', HENSON_ID)
      .in('shipment_id', batch)
      .limit(3000)

    items?.forEach(item => {
      const existing = shipmentItemsMap.get(item.shipment_id) || { hasName: false, hasQty: false }
      if (item.name) existing.hasName = true
      if (item.quantity !== null && item.quantity !== undefined) existing.hasQty = true
      shipmentItemsMap.set(item.shipment_id, existing)
    })
  }

  const withName = [...shipmentItemsMap.values()].filter(v => v.hasName).length
  const withQty = [...shipmentItemsMap.values()].filter(v => v.hasQty).length
  const noItemsAtAll = allShipmentIds.filter(sid => !shipmentItemsMap.has(sid)).length

  console.log(`\nShipment items stats:`)
  console.log(`  - Shipments with any items: ${shipmentItemsMap.size}`)
  console.log(`  - With product name: ${withName}`)
  console.log(`  - With quantity in shipment_items: ${withQty}`)
  console.log(`  - No items at all: ${noItemsAtAll}`)

  // Now check order_items fallback for shipments missing quantity
  const shipmentsMissingQty = allShipmentIds.filter(sid => {
    const info = shipmentItemsMap.get(sid)
    return !info || !info.hasQty
  })

  console.log(`\nShipments needing order_items fallback: ${shipmentsMissingQty.length}`)

  // Get shipments table to get order_id
  const shipmentToOrder = new Map()
  for (let i = 0; i < shipmentsMissingQty.length; i += 500) {
    const batch = shipmentsMissingQty.slice(i, i + 500)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipment_id, order_id')
      .in('shipment_id', batch)

    shipments?.forEach(s => shipmentToOrder.set(s.shipment_id, s.order_id))
  }

  // Get unique order IDs
  const orderIds = [...new Set([...shipmentToOrder.values()].filter(Boolean))]
  console.log(`Unique orders to check for fallback: ${orderIds.length}`)

  // Check order_items for these orders
  const ordersWithQty = new Set()
  for (let i = 0; i < orderIds.length; i += 100) {
    const batch = orderIds.slice(i, i + 100)
    const { data: items } = await supabase
      .from('order_items')
      .select('order_id, quantity')
      .in('order_id', batch)
      .limit(1000)

    items?.forEach(item => {
      if (item.quantity !== null && item.quantity !== undefined) {
        ordersWithQty.add(item.order_id)
      }
    })
  }

  // Count how many shipments are saved by order_items fallback
  let savedByFallback = 0
  for (const sid of shipmentsMissingQty) {
    const orderId = shipmentToOrder.get(sid)
    if (orderId && ordersWithQty.has(orderId)) {
      savedByFallback++
    }
  }

  const stillMissing = shipmentsMissingQty.length - savedByFallback
  console.log(`\nFallback results:`)
  console.log(`  - Saved by order_items fallback: ${savedByFallback}`)
  console.log(`  - STILL MISSING products_sold/quantity: ${stillMissing}`)

  // Sample of shipments still missing
  if (stillMissing > 0) {
    const stillMissingIds = shipmentsMissingQty.filter(sid => {
      const orderId = shipmentToOrder.get(sid)
      return !orderId || !ordersWithQty.has(orderId)
    })
    console.log(`\nSample shipments still missing (first 5):`)
    stillMissingIds.slice(0, 5).forEach(sid => console.log(`  - ${sid}`))
  }

  console.log('\n' + '='.repeat(80))
  console.log('ANALYSIS COMPLETE')
  console.log('='.repeat(80))
}

main().catch(console.error)
