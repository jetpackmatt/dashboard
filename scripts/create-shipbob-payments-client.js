/**
 * Create ShipBob Payments system client and attribute account-level transactions
 *
 * This creates a special system client for:
 * - Default transactions (Payments, Credits, Processing Fees)
 * - FC aggregate storage fees (warehouse-level, not tied to specific inventory)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('CREATING SHIPBOB PAYMENTS SYSTEM CLIENT')
  console.log('='.repeat(70))

  // Check if ShipBob Payments client exists
  const { data: existing } = await supabase
    .from('clients')
    .select('*')
    .eq('company_name', 'ShipBob Payments')
    .single()

  let shipbobPaymentsId

  if (existing) {
    console.log('\nShipBob Payments client already exists:', existing.id)
    shipbobPaymentsId = existing.id
  } else {
    // Create system client for ShipBob Payments
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        company_name: 'ShipBob Payments',
        is_active: false // Mark as inactive so it does not show in normal client lists
      })
      .select()
      .single()

    if (error) {
      console.log('Error creating client:', error.message)
      return
    }

    console.log('\nCreated ShipBob Payments client:', newClient.id)
    shipbobPaymentsId = newClient.id
  }

  // Attribute Default transactions to ShipBob Payments
  console.log('\nAttributing Default transactions to ShipBob Payments...')

  const { data: defaultTx } = await supabase
    .from('transactions')
    .select('id')
    .eq('reference_type', 'Default')
    .is('client_id', null)

  console.log('Default transactions to attribute:', defaultTx?.length || 0)

  if (defaultTx && defaultTx.length > 0) {
    for (const tx of defaultTx) {
      await supabase
        .from('transactions')
        .update({ client_id: shipbobPaymentsId })
        .eq('id', tx.id)
    }
    console.log('Attributed:', defaultTx.length)
  }

  // Also attribute aggregate FC fees (FC without inventory) to ShipBob Payments
  // These are warehouse-level fees not tied to specific client inventory
  console.log('\nChecking FC aggregate fees...')

  const { data: fcTx } = await supabase
    .from('transactions')
    .select('id, reference_id')
    .eq('reference_type', 'FC')
    .is('client_id', null)

  // FC aggregate fees have reference_id with only FC ID (single number, no dashes)
  const aggregateFees = (fcTx || []).filter(t => t.reference_id.indexOf('-') === -1)
  console.log('FC aggregate fees (no inventory):', aggregateFees.length)

  if (aggregateFees.length > 0) {
    for (const tx of aggregateFees) {
      await supabase
        .from('transactions')
        .update({ client_id: shipbobPaymentsId })
        .eq('id', tx.id)
    }
    console.log('Attributed FC aggregate fees:', aggregateFees.length)
  }

  // Final status
  console.log('\n' + '='.repeat(70))
  console.log('FINAL ATTRIBUTION STATUS')
  console.log('='.repeat(70))

  const { count: totalTx } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  const { count: attributed } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('client_id', 'is', null)

  const { count: unattributed } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log('\nTotal transactions:', totalTx)
  console.log('Attributed:', attributed)
  console.log('Unattributed:', unattributed)
  console.log('Attribution rate:', ((attributed / totalTx) * 100).toFixed(2) + '%')

  // Breakdown by client
  console.log('\nBreakdown by client:')
  const { data: byClient } = await supabase
    .from('transactions')
    .select('client_id, clients(company_name)')
    .not('client_id', 'is', null)

  const clientCounts = {}
  for (const t of byClient || []) {
    const name = t.clients?.company_name || t.client_id.slice(0, 8) + '...'
    clientCounts[name] = (clientCounts[name] || 0) + 1
  }

  for (const [name, count] of Object.entries(clientCounts).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + name + ': ' + count)
  }

  // Show remaining unattributed
  if (unattributed > 0) {
    const { data: remaining } = await supabase
      .from('transactions')
      .select('reference_type, reference_id, transaction_fee')
      .is('client_id', null)

    console.log('\nRemaining unattributed:')
    const byType = {}
    for (const tx of remaining || []) {
      byType[tx.reference_type] = (byType[tx.reference_type] || 0) + 1
    }
    for (const [type, count] of Object.entries(byType)) {
      console.log('  ' + type + ': ' + count)
    }

    // Show specific unattributed
    console.log('\nUnattributed details:')
    for (const tx of (remaining || []).slice(0, 10)) {
      console.log('  ' + tx.reference_type + ' - ' + tx.reference_id + ' - ' + tx.transaction_fee)
    }
  }
}

main().catch(console.error)
