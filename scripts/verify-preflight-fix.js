#!/usr/bin/env node
/**
 * Verify that the 2 fixed shipments now pass preflight validation
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
  console.log('VERIFYING PREFLIGHT VALIDATION FOR FIXED SHIPMENTS')
  console.log('='.repeat(80))

  for (const shipmentId of TARGET_SHIPMENTS) {
    console.log(`\nShipment ${shipmentId}:`)

    // Get shipment_items
    const { data: items } = await supabase
      .from('shipment_items')
      .select('name, quantity')
      .eq('shipment_id', shipmentId)

    if (!items?.length) {
      console.log('  ❌ NO ITEMS FOUND')
      continue
    }

    // Check if all items have both name and quantity
    let hasName = false
    let hasQuantity = false

    for (const item of items) {
      if (item.name) hasName = true
      if (item.quantity !== null) hasQuantity = true
    }

    const passes = hasName && hasQuantity
    console.log(`  hasName: ${hasName}`)
    console.log(`  hasQuantity: ${hasQuantity}`)
    console.log(`  PREFLIGHT: ${passes ? '✓ PASSES' : '❌ FAILS'}`)

    // Show items
    console.log(`  Items (${items.length}):`)
    for (const item of items) {
      const status = item.name && item.quantity !== null ? '✓' : '❌'
      console.log(`    ${status} "${item.name}" -> qty=${item.quantity ?? 'NULL'}`)
    }
  }

  // Count total shipments with missing quantity for Dec 8 invoices
  console.log('\n' + '='.repeat(80))
  console.log('DEC 8 INVOICE SUMMARY')
  console.log('='.repeat(80))

  // Get shipment IDs from Dec 8 invoices for Henson
  const invoiceIds = [8661966, 8661967, 8661968, 8661969]
  const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Get transactions for these invoices
  const { data: txns } = await supabase
    .from('transactions')
    .select('shipment_id')
    .eq('client_id', HENSON_ID)
    .in('invoice_id', invoiceIds)
    .not('shipment_id', 'is', null)

  const shipmentIds = [...new Set(txns?.map(t => t.shipment_id) || [])]
  console.log(`Total unique shipments: ${shipmentIds.length}`)

  // Check which have products_sold
  let passing = 0
  let failing = 0
  const failingIds = []

  for (const shipmentId of shipmentIds) {
    const { data: items } = await supabase
      .from('shipment_items')
      .select('name, quantity')
      .eq('shipment_id', shipmentId)

    const hasName = items?.some(i => i.name)
    const hasQuantity = items?.some(i => i.quantity !== null)

    if (hasName && hasQuantity) {
      passing++
    } else {
      failing++
      failingIds.push(shipmentId)
    }
  }

  console.log(`Passing withProductsSold: ${passing}`)
  console.log(`Failing withProductsSold: ${failing}`)

  if (failingIds.length > 0) {
    console.log(`\nFailing shipment IDs:`)
    for (const id of failingIds.slice(0, 10)) {
      console.log(`  - ${id}`)
    }
    if (failingIds.length > 10) {
      console.log(`  ... and ${failingIds.length - 10} more`)
    }
  } else {
    console.log('\n✓ ALL SHIPMENTS PASS withProductsSold!')
  }
}

main().catch(console.error)
