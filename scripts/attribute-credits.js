/**
 * Attribute Credit transactions to clients via invoice lookup
 *
 * Credits are client-level from weekly credits invoice.
 * They can be attributed by finding other transactions on the same invoice
 * that already have client attribution.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('ATTRIBUTING CREDITS VIA INVOICE LOOKUP')
  console.log('='.repeat(70))

  // Get unattributed Credit transactions
  const { data: credits } = await supabase
    .from('transactions')
    .select('id, invoice_id_sb, amount, charge_date')
    .is('client_id', null)
    .eq('transaction_fee', 'Credit')

  console.log(`\nUnattributed credits: ${credits?.length || 0}`)

  // Group by invoice
  const byInvoice = {}
  const noInvoice = []
  for (const tx of credits || []) {
    if (tx.invoice_id_sb) {
      if (!byInvoice[tx.invoice_id_sb]) byInvoice[tx.invoice_id_sb] = []
      byInvoice[tx.invoice_id_sb].push(tx)
    } else {
      noInvoice.push(tx)
    }
  }

  console.log(`With invoice: ${Object.values(byInvoice).flat().length}`)
  console.log(`Without invoice: ${noInvoice.length}`)

  // For each invoice, find attributed transactions and use that client
  const updates = []
  for (const [invId, txs] of Object.entries(byInvoice)) {
    const { data: attributed } = await supabase
      .from('transactions')
      .select('client_id, clients(company_name)')
      .eq('invoice_id_sb', parseInt(invId))
      .not('client_id', 'is', null)
      .limit(1)

    if (attributed && attributed.length > 0) {
      const clientId = attributed[0].client_id
      const clientName = attributed[0].clients?.company_name || clientId
      console.log(`\nInvoice ${invId}: ${txs.length} credits → ${clientName}`)

      for (const tx of txs) {
        updates.push({ id: tx.id, client_id: clientId })
      }
    } else {
      console.log(`\nInvoice ${invId}: NO attributed transactions found (skipping ${txs.length} credits)`)
    }
  }

  // Apply updates
  console.log(`\nApplying ${updates.length} updates...`)
  let updated = 0
  for (const upd of updates) {
    await supabase
      .from('transactions')
      .update({ client_id: upd.client_id })
      .eq('id', upd.id)
    updated++
  }
  console.log(`Updated: ${updated}`)

  // Report on remaining
  console.log('\n' + '='.repeat(70))
  console.log('REMAINING UNATTRIBUTED')
  console.log('='.repeat(70))

  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log(`\nTotal unattributed: ${count}`)

  // Breakdown
  const { data: remaining } = await supabase
    .from('transactions')
    .select('reference_type, transaction_fee')
    .is('client_id', null)

  const breakdown = {}
  for (const tx of remaining || []) {
    const key = `${tx.reference_type} - ${tx.transaction_fee}`
    breakdown[key] = (breakdown[key] || 0) + 1
  }

  console.log('\nBreakdown:')
  for (const [key, cnt] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${cnt}`)
  }

  // Show the one without invoice
  if (noInvoice.length > 0) {
    console.log('\n--- Credits without invoice (not yet invoiced) ---')
    for (const tx of noInvoice) {
      console.log(`  ${tx.id}: $${tx.amount.toFixed(2)} on ${tx.charge_date}`)
    }
  }
}

main().catch(console.error)
