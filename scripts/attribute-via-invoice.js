/**
 * Attribute remaining unattributed transactions via invoice lookup
 *
 * For each unattributed transaction that has an invoice_id_sb,
 * look for other transactions on the same invoice that DO have a client_id,
 * and use that to attribute the unattributed transaction.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('ATTRIBUTING REMAINING TRANSACTIONS VIA INVOICE LOOKUP')
  console.log('='.repeat(70))

  // Get all unattributed transactions
  const { data: unattr } = await supabase
    .from('transactions')
    .select('id, transaction_id, reference_type, transaction_fee, invoice_id_sb, amount, charge_date')
    .is('client_id', null)

  console.log(`\nUnattributed transactions: ${unattr?.length || 0}`)

  if (!unattr || unattr.length === 0) {
    console.log('All transactions are attributed!')
    return
  }

  // Group by invoice_id
  const byInvoice = {}
  const noInvoice = []
  for (const tx of unattr) {
    if (tx.invoice_id_sb) {
      if (!byInvoice[tx.invoice_id_sb]) byInvoice[tx.invoice_id_sb] = []
      byInvoice[tx.invoice_id_sb].push(tx)
    } else {
      noInvoice.push(tx)
    }
  }

  console.log(`\nWith invoice_id: ${Object.keys(byInvoice).length} invoices`)
  console.log(`Without invoice_id: ${noInvoice.length}`)

  // For each invoice, find attributed transactions on same invoice
  const updates = []
  const couldNotAttribute = []

  for (const [invoiceId, txs] of Object.entries(byInvoice)) {
    // Find any attributed transaction on this invoice
    const { data: attributed } = await supabase
      .from('transactions')
      .select('client_id, clients(company_name)')
      .eq('invoice_id_sb', parseInt(invoiceId))
      .not('client_id', 'is', null)
      .limit(1)

    if (attributed && attributed.length > 0) {
      const clientId = attributed[0].client_id
      const clientName = attributed[0].clients?.company_name || 'Unknown'
      console.log(`\nInvoice ${invoiceId}: Found client "${clientName}"`)
      console.log(`  Attributing ${txs.length} transactions...`)

      for (const tx of txs) {
        updates.push({ id: tx.id, client_id: clientId })
        console.log(`    ${tx.reference_type} - ${tx.transaction_fee}: $${tx.amount.toFixed(2)}`)
      }
    } else {
      console.log(`\nInvoice ${invoiceId}: No attributed siblings found`)
      couldNotAttribute.push(...txs)
    }
  }

  // Apply updates
  if (updates.length > 0) {
    console.log(`\n${'='.repeat(50)}`)
    console.log(`Applying ${updates.length} updates...`)
    for (const upd of updates) {
      await supabase
        .from('transactions')
        .update({ client_id: upd.client_id })
        .eq('id', upd.id)
    }
    console.log('Done!')
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`)
  console.log('FINAL STATE')
  console.log('='.repeat(70))

  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log(`\nTotal unattributed: ${count}`)

  if (count > 0) {
    const { data: remaining } = await supabase
      .from('transactions')
      .select('reference_type, transaction_fee, invoice_id_sb, amount, charge_date')
      .is('client_id', null)

    console.log('\nRemaining unattributed:')
    for (const tx of remaining || []) {
      console.log(`  ${tx.reference_type} - ${tx.transaction_fee}`)
      console.log(`    Invoice: ${tx.invoice_id_sb || 'none'}`)
      console.log(`    Amount: $${tx.amount.toFixed(2)}`)
      console.log(`    Date: ${tx.charge_date}`)
    }
  }

  // Total stats
  const { count: total } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  const { count: attributed } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('client_id', 'is', null)

  console.log(`\n${'='.repeat(50)}`)
  console.log(`Total transactions: ${total}`)
  console.log(`Attributed: ${attributed} (${((attributed/total)*100).toFixed(1)}%)`)
  console.log(`Unattributed: ${total - attributed}`)
}

main().catch(console.error)
