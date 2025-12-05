/**
 * Un-attribute Warehousing Fees from Jetpack Costs
 *
 * Per user feedback: Warehousing Fees should ALL be attributable to clients
 * (child accounts), not to Jetpack Costs. They will be attributed via
 * invoice-based fallback during Monday invoicing.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('UN-ATTRIBUTING WAREHOUSING FEES FROM JETPACK COSTS')
  console.log('='.repeat(70))

  // Get the Jetpack Costs client ID
  const { data: jcClient } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'Jetpack Costs')
    .single()

  if (!jcClient) {
    console.log('Jetpack Costs client not found')
    return
  }

  console.log('Jetpack Costs client ID:', jcClient.id)

  // Find Warehousing Fees attributed to Jetpack Costs
  const { data: whFees } = await supabase
    .from('transactions')
    .select('id, amount, charge_date')
    .eq('client_id', jcClient.id)
    .eq('transaction_fee', 'Warehousing Fee')

  console.log(`\nWarehousing Fees on Jetpack Costs: ${whFees?.length || 0}`)

  if (whFees && whFees.length > 0) {
    console.log('\nUn-attributing...')
    for (const tx of whFees) {
      await supabase
        .from('transactions')
        .update({ client_id: null })
        .eq('id', tx.id)
    }
    console.log(`Un-attributed ${whFees.length} Warehousing Fee transactions`)
  }

  // Show what's left on Jetpack Costs
  const { data: remaining } = await supabase
    .from('transactions')
    .select('transaction_fee, amount')
    .eq('client_id', jcClient.id)

  console.log('\n--- Jetpack Costs remaining transactions ---')
  const byFee = {}
  for (const tx of remaining || []) {
    if (!byFee[tx.transaction_fee]) byFee[tx.transaction_fee] = { count: 0, total: 0 }
    byFee[tx.transaction_fee].count++
    byFee[tx.transaction_fee].total += tx.amount
  }
  for (const [fee, stats] of Object.entries(byFee)) {
    console.log(`  ${fee}: ${stats.count} ($${stats.total.toFixed(2)})`)
  }

  // Total unattributed
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log(`\nTotal unattributed transactions: ${count}`)

  // Show breakdown of unattributed
  const { data: unattr } = await supabase
    .from('transactions')
    .select('reference_type, transaction_fee')
    .is('client_id', null)

  const breakdown = {}
  for (const tx of unattr || []) {
    const key = `${tx.reference_type} - ${tx.transaction_fee}`
    breakdown[key] = (breakdown[key] || 0) + 1
  }

  console.log('\nUnattributed breakdown:')
  for (const [key, cnt] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${cnt}`)
  }
}

main().catch(console.error)
