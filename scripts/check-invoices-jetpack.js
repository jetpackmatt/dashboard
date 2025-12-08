/**
 * Check invoices_jetpack table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== INVOICES_JETPACK TABLE ===\n')

  // Count total
  const { count } = await supabase
    .from('invoices_jetpack')
    .select('*', { count: 'exact', head: true })

  console.log('Total invoices_jetpack records:', count)

  // List all
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('*')
    .order('period_start')

  if (error) {
    console.log('Error:', error)
    return
  }

  console.log('\nAll invoices:')
  invoices.forEach(inv => {
    console.log(`  ${inv.invoice_number}: ${inv.period_start?.slice(0,10)} to ${inv.period_end?.slice(0,10)}`)
    console.log(`    ID: ${inv.id}`)
    console.log(`    Totals - Shipping: $${inv.shipping_total}, Addl: $${inv.additional_services_total}, Credits: $${inv.credits_total}`)
  })

  // Now check how many transactions reference each invoice
  console.log('\n=== TRANSACTIONS PER INVOICE ===')
  const knownIds = [
    '0b13e9d2-be0f-436f-81ae-dfa7d773487c',
    '64ebfe3f-f1aa-415f-81af-5252530b231f',
    '29c9883f-b1df-4441-82ed-7703778421d8',
    '2be4d8d4-32aa-4bfa-9bb1-1a0aa467ddb3',
    '9d53ce76-89c6-4389-ad1b-fcd313283f64',
    'aada1d66-92b3-4b5e-8905-776fc214361c',
    '50282657-25e7-4d79-a8d3-76bf145c3958'
  ]

  for (const id of knownIds) {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id_jp', id)

    // Find which invoice this is
    const inv = invoices.find(i => i.id === id)
    console.log(`  ${inv?.invoice_number || id}: ${count} transactions`)
  }
}

check().catch(console.error)
