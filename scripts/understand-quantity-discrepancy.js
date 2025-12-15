#!/usr/bin/env node
/**
 * Understand why preflight only shows 2 failures when analysis showed 86.6% missing quantity
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
const DEC8_INVOICE_IDS = [8661966, 8661967, 8661968, 8661969]

async function main() {
  console.log('='.repeat(80))
  console.log('UNDERSTANDING THE QUANTITY DISCREPANCY')
  console.log('='.repeat(80))

  // Get all shipment IDs on Dec 8 invoices
  const { data: txs } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', DEC8_INVOICE_IDS)

  const shipmentIds = [...new Set(txs?.map(t => t.reference_id) || [])]
  console.log(`\nTotal shipments on Dec 8 invoices: ${shipmentIds.length}`)

  // For each shipment, check if it has items with quantity
  let hasQuantity = 0
  let missingQuantity = 0
  let noItems = 0
  const missingDetails = []

  for (const sid of shipmentIds) {
    const { data: items } = await supabase
      .from('shipment_items')
      .select('name, quantity')
      .eq('shipment_id', sid)

    if (!items || items.length === 0) {
      noItems++
      missingDetails.push({ shipment_id: sid, reason: 'NO_ITEMS', items: 0 })
    } else {
      const hasName = items.some(i => i.name)
      const hasQty = items.some(i => i.quantity !== null)

      if (hasName && hasQty) {
        hasQuantity++
      } else if (hasName && !hasQty) {
        missingQuantity++
        missingDetails.push({
          shipment_id: sid,
          reason: 'HAS_NAME_NO_QTY',
          items: items.length,
          sample: items.slice(0, 2).map(i => ({ name: i.name, qty: i.quantity }))
        })
      } else {
        missingQuantity++
        missingDetails.push({
          shipment_id: sid,
          reason: 'OTHER',
          items: items.length
        })
      }
    }
  }

  console.log(`\n--- BREAKDOWN OF DEC 8 SHIPMENTS ---`)
  console.log(`Has name AND quantity: ${hasQuantity}`)
  console.log(`Has name but NO quantity: ${missingQuantity}`)
  console.log(`Has NO items at all: ${noItems}`)
  console.log(`TOTAL FAILING: ${missingQuantity + noItems}`)

  console.log(`\n--- DETAILS OF FAILING SHIPMENTS ---`)
  for (const d of missingDetails) {
    console.log(`  ${d.shipment_id}: ${d.reason}, items=${d.items}`)
    if (d.sample) {
      d.sample.forEach(s => console.log(`    - "${s.name}" qty=${s.qty}`))
    }
  }

  // Now check - what about the 86.6% claim?
  console.log(`\n${'='.repeat(80)}`)
  console.log('CHECKING THE 86.6% CLAIM')
  console.log('='.repeat(80))

  // Count shipment_items with and without quantity for Dec 8 shipments ONLY
  const { data: dec8Items } = await supabase
    .from('shipment_items')
    .select('shipment_id, quantity')
    .in('shipment_id', shipmentIds)

  const dec8WithQty = dec8Items?.filter(i => i.quantity !== null).length || 0
  const dec8WithoutQty = dec8Items?.filter(i => i.quantity === null).length || 0
  const dec8Total = dec8Items?.length || 0

  console.log(`\nDec 8 shipment_items:`)
  console.log(`  Total: ${dec8Total}`)
  console.log(`  With quantity: ${dec8WithQty} (${((dec8WithQty / dec8Total) * 100).toFixed(1)}%)`)
  console.log(`  Without quantity: ${dec8WithoutQty} (${((dec8WithoutQty / dec8Total) * 100).toFixed(1)}%)`)

  // The 86.6% was for ALL Henson shipments - check that breakdown by date
  console.log(`\n--- COMPARING ALL TIME vs DEC 8 ---`)
  const { count: allWithQty } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .not('quantity', 'is', null)

  const { count: allWithoutQty } = await supabase
    .from('shipment_items')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .is('quantity', null)

  console.log(`\nAll time shipment_items (Henson):`)
  console.log(`  With quantity: ${allWithQty}`)
  console.log(`  Without quantity: ${allWithoutQty}`)
  console.log(`  % Without: ${((allWithoutQty / (allWithQty + allWithoutQty)) * 100).toFixed(1)}%`)
}

main().catch(console.error)
