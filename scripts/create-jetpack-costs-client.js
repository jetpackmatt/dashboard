/**
 * Create "Jetpack Costs" system client for parent-level charges
 *
 * This client holds transactions that are costs TO Jetpack, not billable to clients:
 * - Credit Card Processing Fee (charges from payment processor)
 * - Warehousing Fee (aggregate FC-level monthly fees, not per-client)
 *
 * Distinct from "ShipBob Payments" which is for ACH payments FROM clients TO ShipBob.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('CREATING JETPACK COSTS SYSTEM CLIENT')
  console.log('='.repeat(70))

  // Check if already exists
  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'Jetpack Costs')
    .single()

  let clientId
  if (existing) {
    console.log('Jetpack Costs client already exists:', existing.id)
    clientId = existing.id
  } else {
    // Create the client
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        company_name: 'Jetpack Costs',
        is_active: false, // System client, not shown in normal lists
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating client:', error)
      return
    }

    console.log('Created Jetpack Costs client:', newClient.id)
    clientId = newClient.id
  }

  // Attribute CC Processing Fee to Jetpack Costs
  console.log('\n--- Attributing CC Processing Fees ---')
  const { data: ccFees, error: ccErr } = await supabase
    .from('transactions')
    .select('id, amount, charge_date')
    .is('client_id', null)
    .eq('transaction_fee', 'Credit Card Processing Fee')

  console.log(`Unattributed CC Processing Fees: ${ccFees?.length || 0}`)

  if (ccFees && ccFees.length > 0) {
    for (const tx of ccFees) {
      await supabase
        .from('transactions')
        .update({ client_id: clientId })
        .eq('id', tx.id)
      console.log(`  Attributed: $${tx.amount.toFixed(2)} on ${tx.charge_date}`)
    }
  }

  // Move Warehousing Fees from ShipBob Payments to Jetpack Costs
  console.log('\n--- Moving Warehousing Fees from ShipBob Payments ---')

  const { data: sbClient } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'ShipBob Payments')
    .single()

  if (sbClient) {
    const { data: whFees } = await supabase
      .from('transactions')
      .select('id, amount, charge_date')
      .eq('client_id', sbClient.id)
      .eq('transaction_fee', 'Warehousing Fee')

    console.log(`Warehousing Fees on ShipBob Payments: ${whFees?.length || 0}`)

    if (whFees && whFees.length > 0) {
      for (const tx of whFees) {
        await supabase
          .from('transactions')
          .update({ client_id: clientId })
          .eq('id', tx.id)
        console.log(`  Moved: $${tx.amount.toFixed(2)} on ${tx.charge_date}`)
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('FINAL STATE')
  console.log('='.repeat(70))

  // Total attributed to Jetpack Costs
  const { data: jcTx } = await supabase
    .from('transactions')
    .select('transaction_fee, amount')
    .eq('client_id', clientId)

  console.log(`\nJetpack Costs transactions:`)
  const byFee = {}
  for (const tx of jcTx || []) {
    if (!byFee[tx.transaction_fee]) byFee[tx.transaction_fee] = { count: 0, total: 0 }
    byFee[tx.transaction_fee].count++
    byFee[tx.transaction_fee].total += tx.amount
  }
  for (const [fee, stats] of Object.entries(byFee)) {
    console.log(`  ${fee}: ${stats.count} ($${stats.total.toFixed(2)})`)
  }

  // Total attributed to ShipBob Payments
  if (sbClient) {
    const { data: sbTx } = await supabase
      .from('transactions')
      .select('transaction_fee, amount')
      .eq('client_id', sbClient.id)

    console.log(`\nShipBob Payments transactions:`)
    const sbByFee = {}
    for (const tx of sbTx || []) {
      if (!sbByFee[tx.transaction_fee]) sbByFee[tx.transaction_fee] = { count: 0, total: 0 }
      sbByFee[tx.transaction_fee].count++
      sbByFee[tx.transaction_fee].total += tx.amount
    }
    for (const [fee, stats] of Object.entries(sbByFee)) {
      console.log(`  ${fee}: ${stats.count} ($${stats.total.toFixed(2)})`)
    }
  }

  // Total unattributed
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log(`\nTotal unattributed: ${count}`)

  // Show what's left
  if (count > 0) {
    const { data: remaining } = await supabase
      .from('transactions')
      .select('reference_type, transaction_fee')
      .is('client_id', null)

    const breakdown = {}
    for (const tx of remaining || []) {
      const key = `${tx.reference_type} - ${tx.transaction_fee}`
      breakdown[key] = (breakdown[key] || 0) + 1
    }

    console.log('\nUnattributed breakdown:')
    for (const [key, cnt] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key}: ${cnt}`)
    }
  }
}

main().catch(console.error)
