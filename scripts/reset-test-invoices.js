/**
 * Reset database for fresh invoice generation test
 * Clears all evidence of the last test run
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function resetTestInvoices() {
  console.log('='.repeat(60))
  console.log('Resetting test invoices for fresh run')
  console.log('='.repeat(60))

  // The 6 ShipBob invoice IDs from Dec 1 week
  const dec1ShipbobInvoiceIds = [
    '8633612', '8633618', '8633632', '8633634', '8633637', '8633641'
  ]

  // Step 1: Reset ALL transactions that have any invoice marking (with pagination)
  console.log('\n1. Resetting transactions with invoice marking...')
  let totalReset = 0

  // Keep resetting until no more marked transactions remain
  while (true) {
    // Get a batch of marked transactions
    const { data: txBatch } = await supabase
      .from('transactions')
      .select('id, cost')
      .or('invoiced_status_jp.eq.true,markup_applied.neq.0,invoice_id_jp.not.is.null')
      .limit(500)

    if (!txBatch || txBatch.length === 0) break

    console.log(`   Processing batch of ${txBatch.length} transactions...`)

    // Update each transaction
    for (const tx of txBatch) {
      await supabase
        .from('transactions')
        .update({
          invoice_id_jp: null,
          invoiced_status_jp: false,
          markup_applied: 0,
          billed_amount: tx.cost,
          markup_percentage: 0,
          markup_rule_id: null,
          base_charge: null,
          total_charge: null,
          insurance_charge: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', tx.id)
    }

    totalReset += txBatch.length
    console.log(`   Total reset so far: ${totalReset}`)
  }

  console.log(`   Total reset: ${totalReset} transactions`)

  // Step 2: Reset ShipBob invoices (clear jetpack_invoice_id)
  console.log('\n2. Resetting ShipBob invoices...')
  const { error: sbError } = await supabase
    .from('invoices_sb')
    .update({ jetpack_invoice_id: null })
    .in('shipbob_invoice_id', dec1ShipbobInvoiceIds)

  if (sbError) {
    console.error(`   Error:`, sbError.message)
  } else {
    console.log(`   Reset ${dec1ShipbobInvoiceIds.length} ShipBob invoices`)
  }

  // Step 3: Delete ALL Jetpack invoices (any that exist)
  console.log('\n3. Deleting all Jetpack invoices...')

  const { data: allJpInvoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, pdf_path, xlsx_path')

  for (const invoice of allJpInvoices || []) {
    console.log(`   Deleting ${invoice.invoice_number}...`)
    if (invoice.pdf_path) {
      await supabase.storage.from('invoices').remove([invoice.pdf_path])
    }
    if (invoice.xlsx_path) {
      await supabase.storage.from('invoices').remove([invoice.xlsx_path])
    }
    await supabase.from('invoices_jetpack').delete().eq('id', invoice.id)
  }

  console.log(`   Deleted ${allJpInvoices?.length || 0} invoices`)

  // Step 4: Reset client next_invoice_number
  console.log('\n4. Resetting client invoice numbers...')

  await supabase
    .from('clients')
    .update({ next_invoice_number: 37 })
    .eq('short_code', 'HS')
  console.log('   Henson: next_invoice_number = 37')

  await supabase
    .from('clients')
    .update({ next_invoice_number: 21 })
    .eq('short_code', 'ML')
  console.log('   Methyl-Life: next_invoice_number = 21')

  // Verify the reset
  console.log('\n' + '='.repeat(60))
  console.log('Verification')
  console.log('='.repeat(60))

  const { count: jpCount } = await supabase
    .from('invoices_jetpack')
    .select('*', { count: 'exact', head: true })
  console.log(`Jetpack invoices remaining: ${jpCount || 0}`)

  const { count: unmarkedSbCount } = await supabase
    .from('invoices_sb')
    .select('*', { count: 'exact', head: true })
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
  console.log(`Unprocessed ShipBob invoices: ${unmarkedSbCount || 0}`)

  const { count: invoicedCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('invoiced_status_jp', true)
  console.log(`Invoiced transactions: ${invoicedCount || 0}`)

  const { count: markupCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .neq('markup_applied', 0)
  console.log(`Transactions with markup: ${markupCount || 0}`)

  const { data: clients } = await supabase
    .from('clients')
    .select('short_code, next_invoice_number')
    .in('short_code', ['HS', 'ML'])
  console.log('Client invoice numbers:', clients)

  console.log('\n✅ Reset complete! Ready for fresh test run.')
}

resetTestInvoices().catch(console.error)
