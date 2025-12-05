/**
 * Fix incorrect ShipBob Payments attributions
 *
 * ShipBob Payments should ONLY be used for:
 * - ACH "Payment" transactions (one-way payments TO ShipBob)
 *
 * Should NOT include:
 * - Credit Card Processing Fee (parent-level charge TO Jetpack)
 * - Credit (client-level credits from weekly credits invoice)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('FIXING INCORRECT SHIPBOB PAYMENTS ATTRIBUTIONS')
  console.log('='.repeat(70))

  // Get the ShipBob Payments client ID
  const { data: sbClient } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'ShipBob Payments')
    .single()

  if (!sbClient) {
    console.log('ShipBob Payments client not found')
    return
  }

  console.log('ShipBob Payments client ID:', sbClient.id)

  // Get all transactions attributed to ShipBob Payments
  const { data: sbTx } = await supabase
    .from('transactions')
    .select('id, transaction_fee, amount, reference_type')
    .eq('client_id', sbClient.id)

  console.log('\nTransactions currently attributed to ShipBob Payments:')
  const byFee = {}
  for (const tx of sbTx || []) {
    const fee = tx.transaction_fee
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += tx.amount
  }

  for (const [fee, stats] of Object.entries(byFee)) {
    console.log(`  ${fee}: ${stats.count} ($${stats.total.toFixed(2)})`)
  }

  // Undo Credit and Credit Card Processing Fee attributions
  // These should NOT be attributed to ShipBob Payments
  const toUndo = (sbTx || []).filter(tx =>
    tx.transaction_fee === 'Credit' ||
    tx.transaction_fee === 'Credit Card Processing Fee'
  )

  console.log('\nTransactions to un-attribute:', toUndo.length)

  if (toUndo.length > 0) {
    for (const tx of toUndo) {
      await supabase
        .from('transactions')
        .update({ client_id: null })
        .eq('id', tx.id)
    }
    console.log('Un-attributed:', toUndo.length)
  }

  // Verify what remains
  const { data: remaining } = await supabase
    .from('transactions')
    .select('transaction_fee, amount')
    .eq('client_id', sbClient.id)

  console.log('\nRemaining ShipBob Payments transactions (should only be Payment):')
  const remainingByFee = {}
  for (const tx of remaining || []) {
    remainingByFee[tx.transaction_fee] = (remainingByFee[tx.transaction_fee] || 0) + 1
  }
  for (const [fee, count] of Object.entries(remainingByFee)) {
    console.log(`  ${fee}: ${count}`)
  }

  // Check unattributed again
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log('\nTotal unattributed now:', count)

  // Show breakdown of unattributed
  const { data: unattr } = await supabase
    .from('transactions')
    .select('reference_type, transaction_fee')
    .is('client_id', null)

  const unattrByType = {}
  for (const tx of unattr || []) {
    const key = `${tx.reference_type} - ${tx.transaction_fee}`
    unattrByType[key] = (unattrByType[key] || 0) + 1
  }

  console.log('\nUnattributed breakdown:')
  for (const [key, count] of Object.entries(unattrByType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${count}`)
  }
}

main().catch(console.error)
