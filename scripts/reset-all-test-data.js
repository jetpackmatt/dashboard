/**
 * Complete reset of ALL test invoice data
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function resetAll() {
  console.log('='.repeat(60))
  console.log('COMPLETE RESET - Removing ALL invoice data')
  console.log('='.repeat(60))

  // Dec 1 week ShipBob invoice IDs
  const dec1ShipbobInvoiceIds = [
    '8633612', '8633618', '8633632', '8633634', '8633637', '8633641'
  ]

  // Step 1: Delete ALL Jetpack invoices
  console.log('\n1. Deleting ALL Jetpack invoices...')
  const { data: allInvoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, pdf_path, xlsx_path')

  for (const inv of allInvoices || []) {
    console.log(`   Deleting ${inv.invoice_number}...`)
    if (inv.pdf_path) {
      await supabase.storage.from('invoices').remove([inv.pdf_path])
    }
    if (inv.xlsx_path) {
      await supabase.storage.from('invoices').remove([inv.xlsx_path])
    }
  }

  const { error: delErr } = await supabase
    .from('invoices_jetpack')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all

  if (delErr) console.error('   Delete error:', delErr.message)
  else console.log(`   Deleted ${allInvoices?.length || 0} invoices`)

  // Step 2: Reset ALL transactions with invoice marking
  console.log('\n2. Resetting ALL transactions...')
  let totalReset = 0

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('id, cost')
      .or('invoiced_status_jp.eq.true,markup_applied.neq.0,invoice_id_jp.not.is.null')
      .limit(500)

    if (!batch || batch.length === 0) break

    for (const tx of batch) {
      await supabase
        .from('transactions')
        .update({
          invoice_id_jp: null,
          invoiced_status_jp: false,
          markup_applied: 0,
          billed_amount: tx.cost,
          markup_percentage: 0,
          markup_rule_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', tx.id)
    }

    totalReset += batch.length
    process.stdout.write(`   Reset ${totalReset} transactions...\r`)
  }
  console.log(`\n   Total reset: ${totalReset} transactions`)

  // Step 3: Reset ShipBob invoices
  console.log('\n3. Resetting ShipBob invoices...')
  await supabase
    .from('invoices_sb')
    .update({ jetpack_invoice_id: null })
    .in('shipbob_invoice_id', dec1ShipbobInvoiceIds)
  console.log(`   Reset ${dec1ShipbobInvoiceIds.length} ShipBob invoices`)

  // Step 4: Reset client invoice numbers
  console.log('\n4. Resetting client invoice numbers...')
  await supabase.from('clients').update({ next_invoice_number: 37 }).eq('short_code', 'HS')
  await supabase.from('clients').update({ next_invoice_number: 21 }).eq('short_code', 'ML')
  console.log('   Done')

  // Verify
  console.log('\n' + '='.repeat(60))
  console.log('Verification')
  console.log('='.repeat(60))

  const { count: jpCount } = await supabase.from('invoices_jetpack').select('*', { count: 'exact', head: true })
  const { count: unmarkedCount } = await supabase.from('invoices_sb').select('*', { count: 'exact', head: true }).is('jetpack_invoice_id', null).neq('invoice_type', 'Payment')
  const { count: invoicedCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('invoiced_status_jp', true)
  const { count: markupCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true }).neq('markup_applied', 0)
  const { data: clients } = await supabase.from('clients').select('short_code, next_invoice_number').in('short_code', ['HS', 'ML'])

  console.log(`Jetpack invoices: ${jpCount}`)
  console.log(`Unprocessed SB invoices: ${unmarkedCount}`)
  console.log(`Invoiced transactions: ${invoicedCount}`)
  console.log(`Transactions with markup: ${markupCount}`)
  console.log('Client numbers:', clients)

  console.log('\n✅ Complete reset done!')
}

resetAll().catch(console.error)
