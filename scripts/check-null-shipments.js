#!/usr/bin/env node
/**
 * Check if the 220 NULL invoice transactions' shipments exist in our DB
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Get the 220 NULL invoice transactions
  console.log('=== NULL invoice transactions ===\n')

  const { data: nullTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, created_at')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('Count:', nullTx?.length)

  const refIds = (nullTx || []).map(t => t.reference_id)

  // Check if these shipment IDs exist in our shipments table
  console.log('\n=== Checking shipments table ===')

  const { data: shipments, count: shipCount } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, event_labeled, shipped_date', { count: 'exact' })
    .in('shipment_id', refIds)

  console.log('Shipments found:', shipCount, 'of', refIds.length)

  if (shipments && shipments.length > 0) {
    console.log('\nSample shipments:')
    for (const s of shipments.slice(0, 5)) {
      console.log('  ', s.shipment_id, 'client:', s.client_id?.substring(0, 8), 'labeled:', s.event_labeled?.split('T')[0])
    }
  }

  // Check if they're in orders table
  console.log('\n=== Checking orders by shipment_id ===')

  // Shipments table should have order_id
  const { data: shipmentsWithOrder } = await supabase
    .from('shipments')
    .select('shipment_id, order_id')
    .in('shipment_id', refIds.slice(0, 50))

  console.log('Shipments with order data:', shipmentsWithOrder?.length)

  // Maybe check if transaction_id format gives us hints
  console.log('\n=== Analyzing transaction IDs ===')

  const txIdPrefixes = {}
  for (const tx of nullTx || []) {
    const prefix = tx.transaction_id.substring(0, 6)
    txIdPrefixes[prefix] = (txIdPrefixes[prefix] || 0) + 1
  }
  console.log('Transaction ID prefixes:', txIdPrefixes)

  // Compare with linked transactions
  const { data: linkedTx } = await supabase
    .from('transactions')
    .select('transaction_id')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)
    .limit(500)

  const linkedPrefixes = {}
  for (const tx of linkedTx || []) {
    const prefix = tx.transaction_id.substring(0, 6)
    linkedPrefixes[prefix] = (linkedPrefixes[prefix] || 0) + 1
  }
  console.log('Linked tx ID prefixes (sample):', linkedPrefixes)

  // Check the shipment ID ranges
  console.log('\n=== Shipment ID ranges ===')

  const nullShipIds = (nullTx || []).map(t => parseInt(t.reference_id)).sort((a, b) => a - b)
  console.log('NULL tx shipment ID range:', nullShipIds[0], '-', nullShipIds[nullShipIds.length - 1])

  const linkedShipIds = (linkedTx || []).map(t => parseInt(t.reference_id)).filter(n => !isNaN(n)).sort((a, b) => a - b)
  console.log('Linked tx shipment ID range (sample):', linkedShipIds[0], '-', linkedShipIds[linkedShipIds.length - 1])

  // Check: did these transactions come from a different sync source?
  console.log('\n=== Checking transaction source/origin ===')

  // Look at when they were created vs when invoice was created
  const { data: invoice } = await supabase
    .from('invoices_sb')
    .select('created_at')
    .eq('shipbob_invoice_id', '8730385')
    .single()

  console.log('Invoice 8730385 created_at:', invoice?.created_at)

  // Group NULL tx by created_at
  const nullByCreated = {}
  for (const tx of nullTx || []) {
    const d = tx.created_at?.split('.')[0] // Remove milliseconds
    nullByCreated[d] = (nullByCreated[d] || 0) + 1
  }
  console.log('\nNULL tx by created_at:')
  for (const [d, c] of Object.entries(nullByCreated).sort()) {
    console.log('  ', d, ':', c)
  }

  // The key question: These were synced on Dec 15, before the invoice existed (Dec 22)
  // So they came from sync-transactions (by date range), not from invoice linking
  // Now when sync-invoices ran on Dec 22, why didn't they get linked?

  console.log('\n=== HYPOTHESIS ===')
  console.log('These 220 transactions were synced by sync-transactions on Dec 15')
  console.log('Invoice 8730385 was created on Dec 22')
  console.log('When sync-invoices ran, it called /invoices/8730385/transactions')
  console.log('That API returned 2451 transactions')
  console.log('But our 220 are NOT in those 2451!')
  console.log('')
  console.log('CONCLUSION: ShipBob did NOT include these 220 in the invoice!')
  console.log('They may be billed on a DIFFERENT invoice or not billed at all.')
}

main().catch(console.error)
