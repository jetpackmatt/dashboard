#!/usr/bin/env node
/**
 * Check which shipments are missing from shipping transactions
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const periodStart = '2025-12-15'
  const periodEnd = '2025-12-21'

  // Get shipping tx with NULL invoice_id_sb in the period
  const { data: nullTx, count: nullCount } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, charge_date, invoice_id_sb', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', periodStart)
    .lte('charge_date', periodEnd + 'T23:59:59Z')
    .is('dispute_status', null)
    .limit(10)

  console.log('Shipping tx with NULL invoice_id_sb (Dec 15-21):', nullCount)
  console.log('\nSample NULL invoice transactions:')
  for (const tx of nullTx || []) {
    console.log('  ', tx.reference_id, tx.charge_date?.split('T')[0])
  }

  // Check: are these shipments in the shipments table?
  if (nullTx && nullTx.length > 0) {
    const refIds = nullTx.map(t => t.reference_id)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipment_id, event_labeled, shipped_date')
      .in('shipment_id', refIds)

    console.log('\nShipments table data for these:')
    for (const s of shipments || []) {
      console.log('  ', s.shipment_id, 'event_labeled:', s.event_labeled?.split('T')[0])
    }
  }

  // Check: how many shipments in the period have NO shipping transaction?
  console.log('\n=== COMPARING SHIPMENTS VS TRANSACTIONS ===')

  // Get all shipment IDs from shipments table in the period
  const { data: allShipments, count: shipmentCount } = await supabase
    .from('shipments')
    .select('shipment_id', { count: 'exact' })
    .eq('client_id', hensonId)
    .gte('event_labeled', periodStart)
    .lte('event_labeled', periodEnd + 'T23:59:59Z')
    .limit(3000)

  console.log('Shipments in period (event_labeled):', shipmentCount)

  // Get all shipping transaction reference_ids linked to invoice 8730385
  const { data: linkedTx, count: linkedCount } = await supabase
    .from('transactions')
    .select('reference_id', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)
    .is('dispute_status', null)
    .limit(3000)

  console.log('Shipping tx with invoice 8730385:', linkedCount)

  // Find shipments without linked transactions
  const linkedIds = new Set((linkedTx || []).map(t => t.reference_id))
  const missingShipments = (allShipments || []).filter(s => {
    return !linkedIds.has(s.shipment_id)
  })

  console.log('Shipments missing from transactions:', missingShipments.length)
  console.log('\nSample missing shipment IDs:')
  for (const s of missingShipments.slice(0, 10)) {
    console.log('  ', s.shipment_id)
  }

  // Check if these missing shipments have ANY transaction (maybe with NULL invoice or different invoice)
  if (missingShipments.length > 0) {
    const missingSampleIds = missingShipments.slice(0, 100).map(s => s.shipment_id)
    const { data: anyTx } = await supabase
      .from('transactions')
      .select('reference_id, invoice_id_sb, charge_date, client_id')
      .eq('fee_type', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('reference_id', missingSampleIds)

    console.log('\nTransactions for these missing shipments (first 100):')
    const foundInTx = new Set((anyTx || []).map(t => t.reference_id))
    const notInTxAtAll = missingSampleIds.filter(id => !foundInTx.has(id))
    console.log('  Found in transactions (any invoice):', (anyTx || []).length)
    console.log('  Not in transactions at all:', notInTxAtAll.length)

    if (anyTx && anyTx.length > 0) {
      console.log('\n  Sample found tx:')
      for (const t of anyTx.slice(0, 10)) {
        console.log('    ', t.reference_id, 'invoice:', t.invoice_id_sb, 'date:', t.charge_date?.split('T')[0], 'client:', t.client_id?.substring(0, 8))
      }

      // Group by invoice_id_sb
      const byInvoice = {}
      for (const t of anyTx) {
        const inv = t.invoice_id_sb || 'NULL'
        byInvoice[inv] = (byInvoice[inv] || 0) + 1
      }
      console.log('\n  By invoice_id_sb:')
      for (const [inv, cnt] of Object.entries(byInvoice)) {
        console.log('    ', inv, ':', cnt)
      }
    }

    if (notInTxAtAll.length > 0) {
      console.log('\n  Sample IDs not in transactions at all:')
      for (const id of notInTxAtAll.slice(0, 5)) {
        console.log('    ', id)
      }
    }
  }

  // Check with NULL invoice for broader period
  console.log('\n=== ALL NULL INVOICE SHIPPING TX ===')
  const { count: allNullCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .is('dispute_status', null)

  console.log('All Henson Shipping tx with NULL invoice_id_sb:', allNullCount)

  // Check the total across any invoice
  const { count: anyInvoiceCount } = await supabase
    .from('transactions')
    .select('id', { count: 'exact' })
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('dispute_status', null)

  console.log('All Henson Shipping tx (any invoice_id_sb):', anyInvoiceCount)
}

main().catch(console.error)
