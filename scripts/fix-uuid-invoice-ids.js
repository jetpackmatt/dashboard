/**
 * Fix remaining UUID-format invoice_id_jp to human-readable format
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const FIXES = [
  { uuid: 'e6aff0ec-beb3-46f6-80d4-5edcebbb65b2', invoiceNumber: 'JPHS-0037-120125' },
  { uuid: '1d299af5-576b-473f-aff3-9578728b47ae', invoiceNumber: 'JPML-0021-120125' },
]

async function main() {
  console.log('=== Fix UUID invoice_id_jp values ===\n')

  for (const fix of FIXES) {
    console.log(`Fixing ${fix.uuid} → ${fix.invoiceNumber}...`)

    const { data, error } = await supabase
      .from('transactions')
      .update({ invoice_id_jp: fix.invoiceNumber })
      .eq('invoice_id_jp', fix.uuid)
      .select('id')

    if (error) {
      console.log(`  ERROR: ${error.message}`)
    } else {
      console.log(`  ✅ Updated ${data?.length || 0} transactions`)
    }
  }

  console.log('\n=== Done ===')
}

main().catch(console.error)
