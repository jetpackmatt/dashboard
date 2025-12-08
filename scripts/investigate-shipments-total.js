#!/usr/bin/env node
/**
 * Investigate why shipments totals differ between XLS and DB
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const SHIPMENTS_INVOICE = 8633612

async function main() {
  // Get sample DB shipment transactions
  const { data: dbShipments } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', HENSON_ID)
    .eq('invoice_id_sb', SHIPMENTS_INVOICE)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .limit(5)

  console.log('=== DB SHIPMENT TRANSACTIONS ===')
  console.log('Sample records:')
  for (const tx of dbShipments || []) {
    console.log({
      id: tx.id,
      reference_id: tx.reference_id,
      cost: tx.cost,
      transaction_fee: tx.transaction_fee,
      reference_type: tx.reference_type,
      additional_details: tx.additional_details
    })
  }

  // What transaction_fees do we have for this invoice?
  const { data: allFees } = await supabase
    .from('transactions')
    .select('transaction_fee, cost')
    .eq('invoice_id_sb', SHIPMENTS_INVOICE)
    .eq('client_id', HENSON_ID)

  const feeBreakdown = {}
  for (const tx of allFees || []) {
    const fee = tx.transaction_fee || 'null'
    if (!feeBreakdown[fee]) {
      feeBreakdown[fee] = { count: 0, total: 0 }
    }
    feeBreakdown[fee].count++
    feeBreakdown[fee].total += Number(tx.cost)
  }

  console.log('\n=== TRANSACTION FEES IN SHIPMENTS INVOICE ===')
  console.log('Fee breakdown for invoice_id_sb', SHIPMENTS_INVOICE + ':')
  for (const [fee, stats] of Object.entries(feeBreakdown)) {
    console.log('  ' + fee + ': ' + stats.count + ' rows, $' + stats.total.toFixed(2))
  }

  // Check if surcharges are stored separately
  const { data: surcharges } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', HENSON_ID)
    .eq('invoice_id_sb', SHIPMENTS_INVOICE)
    .neq('transaction_fee', 'Shipping')
    .limit(5)

  if (surcharges && surcharges.length > 0) {
    console.log('\n=== NON-SHIPPING TRANSACTIONS IN SHIPMENTS INVOICE ===')
    for (const tx of surcharges) {
      console.log({
        reference_id: tx.reference_id,
        transaction_fee: tx.transaction_fee,
        cost: tx.cost
      })
    }
  }

  // Check total with ALL transactions from this invoice
  const { data: allTx, count: totalCount } = await supabase
    .from('transactions')
    .select('cost', { count: 'exact' })
    .eq('invoice_id_sb', SHIPMENTS_INVOICE)
    .eq('client_id', HENSON_ID)

  const dbTotal = (allTx || []).reduce((s, t) => s + Number(t.cost), 0)
  console.log('\n=== TOTAL (ALL fees in this invoice) ===')
  console.log('Total rows:', totalCount)
  console.log('Total cost: $' + dbTotal.toFixed(2))
  console.log('XLS expects: $19430.48')
}

main().catch(console.error)
