/**
 * Fix invoice numbers: delete 0022/0038 and recreate as 0021/0037
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(60))
  console.log('FIX: Correcting invoice numbers')
  console.log('='.repeat(60))

  // Delete the wrongly numbered invoices
  const wrongInvoices = [
    { id: '37322b38-17e5-4c64-8cf0-e04c31b47cc0', number: 'JPML-0022-120125' },
    { id: '1a55d7cb-3448-47cc-a568-15f975face75', number: 'JPHS-0038-120125' },
  ]

  for (const inv of wrongInvoices) {
    console.log(`\nDeleting ${inv.number}...`)
    const { error } = await supabase
      .from('invoices_jetpack')
      .delete()
      .eq('id', inv.id)

    if (error) {
      console.log(`  Error: ${error.message}`)
    } else {
      console.log(`  ✅ Deleted`)
    }
  }

  // Reset next_invoice_number to correct values
  // Methyl-Life: should be 21 (last was 0020)
  // Henson: should be 37 (last was 0036)
  console.log('\nResetting invoice counters...')

  await supabase
    .from('clients')
    .update({ next_invoice_number: 21 })
    .eq('id', 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e') // Methyl-Life
  console.log('  Methyl-Life: next_invoice_number = 21')

  await supabase
    .from('clients')
    .update({ next_invoice_number: 37 })
    .eq('id', '6b94c274-0446-4167-9d02-b998f8be59ad') // Henson
  console.log('  Henson: next_invoice_number = 37')

  console.log('\n✅ Done! Now re-run generate-invoices-for-period.js')
}

main().catch(console.error)
