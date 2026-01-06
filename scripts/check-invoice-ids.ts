#!/usr/bin/env npx tsx
/**
 * Check which invoices are in invoices_sb for Dec 8-14 period
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  // Check for the invoices
  const { data, error } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, invoice_date, base_amount, jetpack_invoice_id')
    .in('shipbob_invoice_id', ['8661966', '8661967', '8661968', '8661969', '8693044', '8693045', '8693046', '8693047'])
    .order('invoice_date')
    .order('shipbob_invoice_id')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Dec 8-14 week invoices in invoices_sb:')
  console.log('=' .repeat(100))
  console.log('SB Invoice ID | Invoice Type         | Date       | Amount     | JP Invoice')
  console.log('-'.repeat(100))
  for (const inv of data || []) {
    console.log(
      `${inv.shipbob_invoice_id.padEnd(13)} | ` +
      `${inv.invoice_type.padEnd(20)} | ` +
      `${inv.invoice_date?.split('T')[0]} | ` +
      `$${inv.base_amount.toFixed(2).padStart(9)} | ` +
      `${inv.jetpack_invoice_id || 'NULL'}`
    )
  }

  // Also check which ones are missing
  const found = new Set((data || []).map(d => d.shipbob_invoice_id))
  const expected = ['8661966', '8661967', '8661968', '8661969', '8693044', '8693045', '8693046', '8693047']
  const missing = expected.filter(id => !found.has(id))

  if (missing.length > 0) {
    console.log('\nMISSING from invoices_sb:', missing.join(', '))
  }

  // Check the transaction for WRO 872067
  console.log('\n\nChecking transaction for WRO 872067:')
  const { data: txData, error: txError } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type, total_charge, invoice_id_sb, invoice_date_sb, client_id')
    .eq('reference_id', '872067')
    .eq('reference_type', 'WRO')

  if (txError) {
    console.error('Error:', txError)
    return
  }

  if (!txData || txData.length === 0) {
    console.log('  ❌ WRO 872067 NOT FOUND in transactions table!')
    console.log('  This explains why it\'s missing from the invoice.')
  } else {
    console.log('  Found:', JSON.stringify(txData, null, 2))
  }
}

main()
