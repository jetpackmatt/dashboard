#!/usr/bin/env npx tsx
/**
 * Fix missing WRO 872067 transaction for Henson's invoice
 *
 * ROOT CAUSE: ShipBob API inconsistency
 * - /transactions:query shows WRO 872067 with invoice_id 8693047
 * - /invoices/8693047/transactions does NOT return this transaction
 *
 * This script manually inserts the missing transaction using data from
 * the transactions:query API.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  console.log('='.repeat(60))
  console.log('Fixing missing WRO 872067 transaction')
  console.log('='.repeat(60))

  // Step 1: Get Henson's client_id
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .ilike('company_name', '%henson%')

  if (clientError || !clients || clients.length === 0) {
    console.error('Error finding Henson:', clientError)
    return
  }

  const henson = clients[0]
  console.log(`\nFound Henson: ${henson.company_name}`)
  console.log(`  client_id: ${henson.id}`)
  console.log(`  merchant_id: ${henson.merchant_id}`)

  // Step 2: Check if WRO 872067 exists in receiving_orders
  const { data: wros, error: wroError } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id')
    .eq('shipbob_receiving_id', 872067)

  if (wroError) {
    console.error('Error checking WRO:', wroError)
    return
  }

  if (wros && wros.length > 0) {
    console.log(`\nWRO 872067 found in receiving_orders:`, wros[0])
  } else {
    console.log('\nWRO 872067 NOT in receiving_orders table')
    console.log('  Will use Henson client_id for attribution')
  }

  // Step 3: Check if transaction already exists
  const { data: existingTx, error: existingError } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, total_charge, invoice_id_sb')
    .eq('transaction_id', '01KBZKW9HFA92T8212DSH5F9MW')

  if (existingError) {
    console.error('Error checking existing transaction:', existingError)
    return
  }

  if (existingTx && existingTx.length > 0) {
    console.log('\n⚠️ Transaction already exists:')
    console.log(JSON.stringify(existingTx[0], null, 2))
    return
  }

  // Step 4: Insert the missing transaction
  // Data from ShipBob /transactions:query API response
  // Using correct column names from schema
  const missingTx = {
    transaction_id: '01KBZKW9HFA92T8212DSH5F9MW',
    reference_id: '872067',
    reference_type: 'WRO',
    fee_type: 'WRO Receiving Fee',
    cost: 35.00,  // "cost" not "total_charge" for API amount
    currency_code: 'USD',
    charge_date: '2025-12-08',  // "charge_date" not "transaction_date"
    invoice_id_sb: 8693047,
    invoice_date_sb: '2025-12-15',
    invoiced_status_sb: true,  // boolean
    client_id: henson.id,
    merchant_id: henson.merchant_id,
    fulfillment_center: null,
    additional_details: { _note: 'Manually inserted - ShipBob API inconsistency fix' },
  }

  console.log('\nInserting missing transaction:')
  console.log(`  Reference: WRO ${missingTx.reference_id}`)
  console.log(`  Fee Type: ${missingTx.fee_type}`)
  console.log(`  Amount: $${missingTx.cost}`)
  console.log(`  Invoice: ${missingTx.invoice_id_sb}`)
  console.log(`  Client: ${henson.company_name}`)

  const { error: insertError } = await supabase
    .from('transactions')
    .insert(missingTx)

  if (insertError) {
    console.error('\n❌ Error inserting transaction:', insertError)
    return
  }

  console.log('\n✅ Successfully inserted missing WRO 872067 transaction!')

  // Step 5: Verify the insert
  const { data: verifyTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, total_charge, invoice_id_sb, client_id')
    .eq('reference_id', '872067')
    .eq('reference_type', 'WRO')

  console.log('\nVerification - WRO 872067 transactions:')
  console.log(JSON.stringify(verifyTx, null, 2))

  // Step 6: Show all WRO transactions for invoice 8693047
  const { data: allWroTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, total_charge, client_id')
    .eq('invoice_id_sb', 8693047)
    .eq('reference_type', 'WRO')

  console.log(`\nAll WRO transactions on invoice 8693047: ${allWroTx?.length || 0}`)
  for (const tx of allWroTx || []) {
    console.log(`  WRO ${tx.reference_id}: ${tx.fee_type} $${tx.total_charge}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
