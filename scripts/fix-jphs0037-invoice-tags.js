/**
 * Fix JPHS-0037-120125 incorrect invoice_id_jp tags
 *
 * Problem: 8,625 transactions from March-November 2025 are incorrectly
 * tagged with JPHS-0037-120125 when they should be NULL.
 * The correct period is Nov 24 - Dec 1, 2025 (3,543 transactions).
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('=== Fix JPHS-0037-120125 Invoice Tags ===\n')

  // First, verify the problem
  const { data: counts, error: countError } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id_jp', 'JPHS-0037-120125')
    .lt('charge_date', '2025-11-24')

  if (countError) {
    console.error('Error counting:', countError.message)
    return
  }

  console.log(`Found ${counts} transactions incorrectly tagged (before Nov 24)`)

  // Clear the invoice_id_jp for transactions outside the correct period
  const { data, error } = await supabase
    .from('transactions')
    .update({ invoice_id_jp: null })
    .eq('invoice_id_jp', 'JPHS-0037-120125')
    .lt('charge_date', '2025-11-24')
    .select('id')

  if (error) {
    console.error('Error updating:', error.message)
    return
  }

  console.log(`\nCleared invoice_id_jp for ${data?.length || 0} transactions`)

  // Verify the fix
  const { count: remaining } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id_jp', 'JPHS-0037-120125')

  console.log(`\nTransactions now linked to JPHS-0037-120125: ${remaining}`)
  console.log('Expected: ~3543 (Nov 24 - Dec 1, 2025)')
}

main().catch(console.error)
