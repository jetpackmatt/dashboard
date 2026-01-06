#!/usr/bin/env node

/**
 * Revert invoice paths back to non-versioned format
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Henson
  const { error: error1 } = await supabase
    .from('invoices_jetpack')
    .update({
      pdf_path: '6b94c274-0446-4167-9d02-b998f8be59ad/JPHS-0042-010526/JPHS-0042-010526.pdf',
      xlsx_path: '6b94c274-0446-4167-9d02-b998f8be59ad/JPHS-0042-010526/JPHS-0042-010526-details.xlsx'
    })
    .eq('invoice_number', 'JPHS-0042-010526')

  if (error1) {
    console.error('Error updating Henson:', error1.message)
  } else {
    console.log('Reverted JPHS-0042-010526 to non-versioned paths')
  }

  // Eli Health
  const { error: error2 } = await supabase
    .from('invoices_jetpack')
    .update({
      pdf_path: 'e6220921-695e-41f9-9f49-af3e0cdc828a/JPEH-0004-010526/JPEH-0004-010526.pdf',
      xlsx_path: 'e6220921-695e-41f9-9f49-af3e0cdc828a/JPEH-0004-010526/JPEH-0004-010526-details.xlsx'
    })
    .eq('invoice_number', 'JPEH-0004-010526')

  if (error2) {
    console.error('Error updating Eli Health:', error2.message)
  } else {
    console.log('Reverted JPEH-0004-010526 to non-versioned paths')
  }

  console.log('\nDone!')
}

main().catch(console.error)
