#!/usr/bin/env npx tsx
/**
 * Investigate missing WRO 872067 from Henson invoice
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const MISSING_WRO = '872067'
const INCLUDED_WROS = ['870436', '869297', '871028']

async function main() {
  console.log('='.repeat(60))
  console.log('Investigating Missing WRO 872067')
  console.log('='.repeat(60))

  // 1. Find the missing WRO transaction
  console.log('\n1. Looking for WRO 872067 in transactions...')
  const { data: missingTx, error: err1 } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_id', MISSING_WRO)

  if (err1) {
    console.error('Error:', err1)
    return
  }

  if (!missingTx || missingTx.length === 0) {
    console.log('   ❌ WRO 872067 NOT FOUND in transactions table!')
    console.log('   This means the transaction was never synced from ShipBob')
  } else {
    console.log(`   Found ${missingTx.length} transaction(s) for WRO 872067:`)
    for (const tx of missingTx) {
      console.log(`   - ID: ${tx.transaction_id}`)
      console.log(`     fee_type: ${tx.fee_type}`)
      console.log(`     reference_type: ${tx.reference_type}`)
      console.log(`     total_charge: $${tx.total_charge}`)
      console.log(`     client_id: ${tx.client_id}`)
      console.log(`     invoice_id_sb: ${tx.invoice_id_sb}`)
      console.log(`     invoice_id_jp: ${tx.invoice_id_jp}`)
      console.log(`     invoiced_status_sb: ${tx.invoiced_status_sb}`)
      console.log(`     transaction_date: ${tx.transaction_date}`)
      console.log()
    }
  }

  // 2. Compare with included WROs
  console.log('\n2. Comparing with included WROs...')
  for (const wro of INCLUDED_WROS) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('transaction_id, fee_type, invoice_id_sb, invoice_id_jp, client_id')
      .eq('reference_id', wro)
      .limit(1)

    if (txs && txs.length > 0) {
      const tx = txs[0]
      console.log(`   WRO ${wro}:`)
      console.log(`     invoice_id_sb: ${tx.invoice_id_sb}`)
      console.log(`     invoice_id_jp: ${tx.invoice_id_jp}`)
      console.log(`     client_id: ${tx.client_id}`)
    }
  }

  // 3. Check what ShipBob invoices are being used for this week
  console.log('\n3. Checking unprocessed ShipBob invoices...')
  const { data: sbInvoices } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_type, invoice_date, jetpack_invoice_id')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: true })

  if (sbInvoices) {
    console.log(`   ${sbInvoices.length} unprocessed invoices:`)
    for (const inv of sbInvoices) {
      console.log(`   - ${inv.shipbob_invoice_id} (${inv.invoice_type}) - ${inv.invoice_date}`)
    }

    // Check if missing WRO's invoice_id_sb matches any of these
    if (missingTx && missingTx.length > 0) {
      const missingInvoiceId = missingTx[0].invoice_id_sb
      const matchingInvoice = sbInvoices.find(inv =>
        parseInt(inv.shipbob_invoice_id) === missingInvoiceId
      )
      if (matchingInvoice) {
        console.log(`\n   ✅ Missing WRO's invoice ${missingInvoiceId} IS in unprocessed list`)
      } else {
        console.log(`\n   ❌ Missing WRO's invoice ${missingInvoiceId} is NOT in unprocessed list!`)
      }
    }
  }

  // 4. Check the invoice generation query criteria
  console.log('\n4. Testing collectBillingTransactionsByInvoiceIds criteria...')

  // Get the invoice IDs used for generation
  const invoiceIds = sbInvoices?.map(inv => parseInt(inv.shipbob_invoice_id)).filter(id => !isNaN(id)) || []
  console.log(`   Invoice IDs used: ${invoiceIds.join(', ')}`)

  // Query with exact same criteria as collectBillingTransactionsByInvoiceIds
  const { data: allReceiving, error: err2 } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, reference_type, invoice_id_sb, invoice_id_jp')
    .eq('client_id', HENSON_CLIENT_ID)
    .eq('fee_type', 'Receiving')
    .in('invoice_id_sb', invoiceIds)
    .is('invoice_id_jp', null)

  if (err2) {
    console.error('Error:', err2)
  } else {
    console.log(`\n   Found ${allReceiving?.length || 0} Receiving transactions for Henson:`)
    for (const tx of allReceiving || []) {
      const isMissing = tx.reference_id === MISSING_WRO
      console.log(`   ${isMissing ? '>>> ' : '    '}WRO ${tx.reference_id} (invoice_sb: ${tx.invoice_id_sb})`)
    }
  }

  // 5. Direct check - is the missing WRO in the query results?
  if (missingTx && missingTx.length > 0) {
    const tx = missingTx[0]
    console.log('\n5. Why might it be excluded?')
    console.log(`   - client_id matches Henson? ${tx.client_id === HENSON_CLIENT_ID ? '✅ YES' : '❌ NO - ' + tx.client_id}`)
    console.log(`   - fee_type is Receiving? ${tx.fee_type === 'Receiving' ? '✅ YES' : '❌ NO - ' + tx.fee_type}`)
    console.log(`   - invoice_id_sb in list? ${invoiceIds.includes(tx.invoice_id_sb) ? '✅ YES' : '❌ NO - ' + tx.invoice_id_sb}`)
    console.log(`   - invoice_id_jp is null? ${tx.invoice_id_jp === null ? '✅ YES' : '❌ NO - ' + tx.invoice_id_jp}`)
  }
}

main().catch(console.error)
