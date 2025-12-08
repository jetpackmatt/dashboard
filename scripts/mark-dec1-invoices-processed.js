/**
 * Mark Dec 1 ShipBob invoices as processed in invoices_sb table
 *
 * These invoices were generated but invoices_sb.jetpack_invoice_id was never updated,
 * causing them to keep showing in preflight.
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(60))
  console.log('Mark Dec 1 ShipBob invoices as processed')
  console.log('='.repeat(60))

  // Get all Dec 1 ShipBob invoices that are still unprocessed
  const { data: sbInvoices, error: fetchError } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, jetpack_invoice_id')
    .like('shipbob_invoice_id', '8633%')
    .is('jetpack_invoice_id', null)

  if (fetchError) {
    console.error('Error fetching invoices:', fetchError)
    return
  }

  console.log(`\nFound ${sbInvoices?.length || 0} unprocessed Dec 1 ShipBob invoices`)

  for (const inv of sbInvoices || []) {
    // Find which Jetpack invoices reference this ShipBob invoice
    const { data: txLinks } = await supabase
      .from('transactions')
      .select('invoice_id_jp')
      .eq('invoice_id_sb', parseInt(inv.shipbob_invoice_id))
      .not('invoice_id_jp', 'is', null)

    const jpInvoices = [...new Set((txLinks || []).map(t => t.invoice_id_jp))]

    if (jpInvoices.length === 0) {
      console.log(`  ${inv.shipbob_invoice_id} (${inv.invoice_type}): No Jetpack invoices linked - skipping`)
      continue
    }

    // Update with comma-separated list of Jetpack invoice numbers
    const jetpackIds = jpInvoices.join(', ')
    const { error: updateError } = await supabase
      .from('invoices_sb')
      .update({ jetpack_invoice_id: jetpackIds })
      .eq('shipbob_invoice_id', inv.shipbob_invoice_id)

    if (updateError) {
      console.log(`  ${inv.shipbob_invoice_id} (${inv.invoice_type}): ERROR - ${updateError.message}`)
    } else {
      console.log(`  ${inv.shipbob_invoice_id} (${inv.invoice_type}): Marked as ${jetpackIds}`)
    }
  }

  // Verify
  console.log('\n' + '='.repeat(60))
  console.log('Verification:')
  const { data: verify } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, jetpack_invoice_id')
    .like('shipbob_invoice_id', '8633%')

  for (const inv of verify || []) {
    console.log(`  ${inv.shipbob_invoice_id} (${inv.invoice_type}): ${inv.jetpack_invoice_id || 'NULL'}`)
  }

  console.log('\n' + '='.repeat(60))
  console.log('DONE - Dec 1 invoices should no longer appear in preflight')
  console.log('='.repeat(60))
}

main().catch(console.error)
