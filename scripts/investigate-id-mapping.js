#!/usr/bin/env node
/**
 * Investigate how XLSX OrderID maps to our transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  // Get sample transaction to see structure
  const { data: samples } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'Shipment')
    .gte('charge_date', '2025-11-24')
    .limit(3)

  console.log('Sample Henson Nov 24+ transactions:')
  for (const tx of samples || []) {
    console.log('\n---')
    console.log('  id:', tx.id)
    console.log('  reference_id:', tx.reference_id)
    console.log('  cost:', tx.cost)
    console.log('  amount:', tx.amount)
    console.log('  charge_date:', tx.charge_date)
    console.log('  transaction_fee:', tx.transaction_fee)
    console.log('  invoice_id_sb:', tx.invoice_id_sb)
  }

  // Get some reference_ids from our DB
  console.log('\n' + '='.repeat(50))
  console.log('Our reference_id values (Henson Nov 24+ Shipments):')
  const { data: refs } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'Shipment')
    .gte('charge_date', '2025-11-24')
    .limit(20)

  for (const r of refs || []) {
    console.log('  ' + r.reference_id)
  }

  // Check if XLSX OrderIDs match shipments table
  console.log('\n' + '='.repeat(50))
  console.log('Checking if XLSX OrderIDs match shipments table...')

  const xlsxSamples = ['314479977', '318576741', '318621768', '319175572']

  // Try as shipbob_shipment_id (string)
  const { data: asShipmentId } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_shipment_id, shipbob_order_id')
    .in('shipbob_shipment_id', xlsxSamples)

  console.log('As shipbob_shipment_id (string):', asShipmentId?.length || 0)

  // Try as shipbob_order_id (number)
  const { data: asOrderId } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_shipment_id, shipbob_order_id')
    .in('shipbob_order_id', xlsxSamples.map(Number))

  console.log('As shipbob_order_id (number):', asOrderId?.length || 0)

  if (asOrderId && asOrderId.length > 0) {
    console.log('\n*** XLSX OrderID = shipbob_order_id ***')
    for (const m of asOrderId) {
      console.log('  shipbob_order_id=' + m.shipbob_order_id + ' -> shipbob_shipment_id=' + m.shipbob_shipment_id)
    }

    // Now check if shipbob_shipment_id matches transaction reference_id
    const shipmentIds = asOrderId.map(m => String(m.shipbob_shipment_id))
    const { data: txMatches } = await supabase
      .from('transactions')
      .select('reference_id, cost, amount, transaction_fee')
      .in('reference_id', shipmentIds)
      .eq('reference_type', 'Shipment')

    console.log('\nTransaction matches via shipbob_shipment_id:', txMatches?.length || 0)
    for (const tx of txMatches || []) {
      console.log('  ref=' + tx.reference_id + ' cost=' + tx.cost + ' amount=' + tx.amount + ' fee=' + tx.transaction_fee)
    }
  }

  // Check our DB reference_ids against shipments table
  console.log('\n' + '='.repeat(50))
  console.log('Checking if our reference_ids match shipments...')

  const ourRefs = (refs || []).map(r => r.reference_id).filter(Boolean)
  const { data: shipMatch } = await supabase
    .from('shipments')
    .select('shipment_id, shipbob_shipment_id, shipbob_order_id')
    .in('shipbob_shipment_id', ourRefs.slice(0, 10))

  console.log('Our reference_ids found as shipbob_shipment_id:', shipMatch?.length || 0)
  for (const s of shipMatch || []) {
    console.log('  shipbob_shipment_id=' + s.shipbob_shipment_id + ' -> shipbob_order_id=' + s.shipbob_order_id)
  }
}

main().catch(console.error)
