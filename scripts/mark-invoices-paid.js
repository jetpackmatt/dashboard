#!/usr/bin/env node

/**
 * Mark all approved/sent invoices as paid except 121525 invoices
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get all approved/sent invoices
  const { data: invoices, error: fetchError } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, paid_status')
    .in('status', ['approved', 'sent'])
    .order('invoice_number')

  if (fetchError) {
    console.error('Error fetching invoices:', fetchError)
    process.exit(1)
  }

  // Filter to exclude 121525 invoices
  const toUpdate = invoices.filter(inv => !inv.invoice_number.endsWith('-121525'))
  const excluded = invoices.filter(inv => inv.invoice_number.endsWith('-121525'))

  console.log(`Total invoices: ${invoices.length}`)
  console.log(`Marking as paid: ${toUpdate.length}`)
  console.log(`Excluding (121525): ${excluded.map(i => i.invoice_number).join(', ')}`)
  console.log('')

  // Update all non-121525 invoices
  const ids = toUpdate.map(inv => inv.id)

  const { error: updateError } = await supabase
    .from('invoices_jetpack')
    .update({ paid_status: 'paid' })
    .in('id', ids)

  if (updateError) {
    console.error('Error updating invoices:', updateError)
    process.exit(1)
  }

  console.log(`Successfully marked ${toUpdate.length} invoices as paid`)

  // Verify
  const { data: verify } = await supabase
    .from('invoices_jetpack')
    .select('invoice_number, paid_status')
    .in('status', ['approved', 'sent'])
    .order('invoice_number')

  const paid = verify.filter(i => i.paid_status === 'paid').length
  const unpaid = verify.filter(i => i.paid_status === 'unpaid').length
  console.log(`\nVerification: ${paid} paid, ${unpaid} unpaid`)
  console.log('Unpaid invoices:', verify.filter(i => i.paid_status === 'unpaid').map(i => i.invoice_number).join(', '))
}

main().catch(console.error)
