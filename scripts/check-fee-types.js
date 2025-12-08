/**
 * Check if unmatched transactions are Shipping Zone/Dimensional types
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== UNMATCHED SHIPPING BY TRANSACTION_FEE TYPE ===\n')

  // Get unmatched shipping transactions by type
  for (const feeType of ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade']) {
    const { count: total } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_fee', feeType)

    const { count: matched } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_fee', feeType)
      .not('invoice_id_jp', 'is', null)

    const { count: unmatched } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_fee', feeType)
      .is('invoice_id_jp', null)

    console.log(`${feeType}:`)
    console.log(`  Total: ${total}`)
    console.log(`  Matched: ${matched} (${Math.round(matched/total*100)}%)`)
    console.log(`  Unmatched: ${unmatched}`)
    console.log()
  }

  // Check if unmatched 'Shipping Zone' have matching 'Shipping' with invoice
  console.log('=== CHECKING IF SHIPPING ZONE MATCHES HAVE INVOICED SHIPPING ===')

  const { data: unmatchedZone } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('transaction_fee', 'Shipping Zone')
    .is('invoice_id_jp', null)
    .limit(100)

  const zoneRefIds = unmatchedZone?.map(r => r.reference_id) || []
  console.log(`Sample unmatched Shipping Zone reference_ids: ${zoneRefIds.length}`)

  // Check if these reference_ids have matched 'Shipping' transactions
  const { data: correspondingShipping } = await supabase
    .from('transactions')
    .select('reference_id, invoice_id_jp')
    .eq('transaction_fee', 'Shipping')
    .in('reference_id', zoneRefIds)

  const matchedShippingCount = correspondingShipping?.filter(r => r.invoice_id_jp).length || 0
  console.log(`Of ${zoneRefIds.length} unmatched Shipping Zone, ${matchedShippingCount} have corresponding matched 'Shipping' transaction`)

  // Conclusion
  console.log('\n=== CONCLUSION ===')
  console.log('The import script only matches transaction_fee="Shipping"')
  console.log('Shipping Zone and Dimensional Shipping Upgrade transactions are NOT matched')
  console.log('These share the same reference_id as the main Shipping transaction')
  console.log('They should inherit the invoice_id_jp from their parent Shipping transaction')
}

check().catch(console.error)
