#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get all unprocessed invoices (jetpack_invoice_id IS NULL)
  const { data: invoices, error } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_date, invoice_type, base_amount, period_start, period_end')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Unprocessed ShipBob invoices:\n')
  console.log('ID         | Invoice Date | Period Start | Period End   | Type     | Amount')
  console.log('-'.repeat(85))

  for (const inv of invoices) {
    const invDate = (inv.invoice_date || 'N/A').split('T')[0]
    const pStart = (inv.period_start || 'N/A').split('T')[0]
    const pEnd = (inv.period_end || 'N/A').split('T')[0]
    console.log(`${String(inv.shipbob_invoice_id).padEnd(10)} | ${invDate}   | ${pStart}   | ${pEnd}   | ${String(inv.invoice_type).padEnd(8)} | $${(inv.base_amount || 0).toLocaleString()}`)
  }
}

main()
