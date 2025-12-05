/**
 * Attribute WRO/URO transactions via invoice lookup
 *
 * Strategy: Find transactions on the same ShipBob invoice that ARE attributed,
 * then use that client_id for the unattributed WRO/URO transactions.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('WRO/URO ATTRIBUTION VIA INVOICE')
  console.log('='.repeat(70))

  // Get unattributed WRO/URO transactions
  const { data: wroUroTx } = await supabase
    .from('transactions')
    .select('*')
    .in('reference_type', ['WRO', 'URO'])
    .is('client_id', null)

  console.log('\nTotal unattributed WRO/URO:', wroUroTx?.length || 0)

  // Group by invoice_id_sb
  const byInvoice = {}
  for (const tx of wroUroTx || []) {
    const inv = tx.invoice_id_sb
    if (byInvoice[inv] === undefined) byInvoice[inv] = []
    byInvoice[inv].push(tx)
  }

  console.log('Grouped by invoice:', Object.keys(byInvoice).length, 'invoices')

  // For each invoice, find the majority client from attributed transactions
  const updates = []
  const issues = []

  for (const [invId, txs] of Object.entries(byInvoice)) {
    // Get all attributed transactions on this invoice
    const { data: attributed } = await supabase
      .from('transactions')
      .select('client_id, reference_type')
      .eq('invoice_id_sb', parseInt(invId))
      .not('client_id', 'is', null)

    if (!attributed || attributed.length === 0) {
      issues.push({ invId, reason: 'No attributed transactions on invoice', count: txs.length })
      continue
    }

    // Count clients
    const clientCounts = {}
    for (const t of attributed) {
      clientCounts[t.client_id] = (clientCounts[t.client_id] || 0) + 1
    }

    const clients = Object.keys(clientCounts)

    if (clients.length === 1) {
      // Single client - easy attribution
      const clientId = clients[0]
      for (const tx of txs) {
        updates.push({ id: tx.id, client_id: clientId })
      }
      console.log(`Invoice ${invId}: ${txs.length} WRO/URO -> ${clientId.slice(0, 8)}...`)
    } else {
      // Multiple clients - use majority client (most transactions on the invoice)
      console.log(`\nInvoice ${invId} has multiple clients:`)
      for (const [cid, count] of Object.entries(clientCounts)) {
        console.log(`  ${cid.slice(0, 8)}...: ${count} transactions`)
      }

      const sortedClients = Object.entries(clientCounts).sort((a, b) => b[1] - a[1])
      const majorityClient = sortedClients[0][0]

      for (const tx of txs) {
        updates.push({ id: tx.id, client_id: majorityClient })
      }
      console.log(`  Using majority client: ${majorityClient.slice(0, 8)}...`)
    }
  }

  console.log('\n--- APPLYING UPDATES ---')
  console.log('Total to update:', updates.length)

  if (updates.length > 0) {
    let updated = 0
    for (const upd of updates) {
      await supabase
        .from('transactions')
        .update({ client_id: upd.client_id })
        .eq('id', upd.id)
      updated++
    }
    console.log('Updated:', updated)
  }

  // Check final status
  const { count: remaining } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('reference_type', ['WRO', 'URO'])
    .is('client_id', null)

  console.log('\nRemaining unattributed WRO/URO:', remaining)

  if (issues.length > 0) {
    console.log('\nIssues:')
    issues.forEach(i => console.log(`  Invoice ${i.invId}: ${i.reason} (${i.count} transactions)`))
  }

  // Final overall attribution status
  console.log('\n' + '='.repeat(70))
  console.log('OVERALL ATTRIBUTION STATUS')
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

  console.log(`\nTotal transactions: ${totalTx}`)
  console.log(`Attributed: ${attributed}`)
  console.log(`Unattributed: ${unattributed}`)
  console.log(`Attribution rate: ${((attributed / totalTx) * 100).toFixed(2)}%`)

  // Breakdown of remaining unattributed
  if (unattributed > 0) {
    const { data: remaining } = await supabase
      .from('transactions')
      .select('reference_type')
      .is('client_id', null)

    const byType = {}
    for (const tx of remaining || []) {
      byType[tx.reference_type] = (byType[tx.reference_type] || 0) + 1
    }

    console.log('\nRemaining unattributed by type:')
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`)
    }
  }
}

main().catch(console.error)
