/**
 * Analyze Credit transactions to understand how to attribute them to clients
 *
 * Credits come from weekly credits invoice - need to be attributed to clients
 * and billed during Monday invoicing process.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('ANALYZING UNATTRIBUTED CREDITS, CC FEES, AND WAREHOUSING FEES')
  console.log('='.repeat(70))

  // Look at unattributed Credit transactions
  const { data: unattributed } = await supabase
    .from('transactions')
    .select('id, reference_type, reference_id, transaction_fee, amount, charge_date, invoice_id_sb, additional_details')
    .is('client_id', null)
    .in('transaction_fee', ['Credit', 'Credit Card Processing Fee', 'Warehousing Fee'])
    .order('charge_date', { ascending: false })

  const byFee = {}
  for (const tx of unattributed || []) {
    if (!byFee[tx.transaction_fee]) byFee[tx.transaction_fee] = []
    byFee[tx.transaction_fee].push(tx)
  }

  for (const [fee, txs] of Object.entries(byFee)) {
    console.log('\n' + '='.repeat(50))
    console.log(`${fee} (${txs.length} transactions)`)
    console.log('='.repeat(50))

    for (const tx of txs.slice(0, 5)) {
      console.log('\nTransaction ID:', tx.id)
      console.log('  Reference:', tx.reference_type, tx.reference_id)
      console.log('  Amount: $' + tx.amount.toFixed(2))
      console.log('  Date:', tx.charge_date)
      console.log('  Invoice ID:', tx.invoice_id_sb)
      console.log('  Additional Details:', JSON.stringify(tx.additional_details))
    }

    if (txs.length > 5) {
      console.log('\n  ... and ' + (txs.length - 5) + ' more')
    }
  }

  // Analyze Credit invoices specifically
  console.log('\n' + '='.repeat(70))
  console.log('CREDIT INVOICE ANALYSIS')
  console.log('='.repeat(70))

  const credits = (unattributed || []).filter(t => t.transaction_fee === 'Credit')
  const creditInvoices = {}
  for (const tx of credits) {
    const inv = tx.invoice_id_sb || 'no_invoice'
    if (!creditInvoices[inv]) creditInvoices[inv] = []
    creditInvoices[inv].push(tx)
  }

  console.log('\nCredits by Invoice ID:')
  for (const [inv, txs] of Object.entries(creditInvoices)) {
    console.log(`  Invoice ${inv}: ${txs.length} credits, total $${txs.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
  }

  // For each credit invoice, check if there are attributed transactions on the same invoice
  console.log('\n--- Checking for attributed transactions on same invoices ---')
  for (const invId of Object.keys(creditInvoices)) {
    if (invId === 'no_invoice') continue

    const { data: attributed } = await supabase
      .from('transactions')
      .select('client_id, clients(company_name)')
      .eq('invoice_id_sb', parseInt(invId))
      .not('client_id', 'is', null)
      .limit(5)

    if (attributed && attributed.length > 0) {
      console.log(`\nInvoice ${invId} has attributed transactions:`)
      const clients = [...new Set(attributed.map(a => a.clients?.company_name || a.client_id))]
      for (const c of clients) {
        console.log(`  Client: ${c}`)
      }
    } else {
      console.log(`\nInvoice ${invId}: NO attributed transactions found`)
    }
  }

  // Check ShipBob Payments client for Warehousing Fee
  console.log('\n' + '='.repeat(70))
  console.log('SHIPBOB PAYMENTS WAREHOUSING FEES')
  console.log('='.repeat(70))

  const { data: sbClient } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'ShipBob Payments')
    .single()

  if (sbClient) {
    const { data: sbWarehousing } = await supabase
      .from('transactions')
      .select('id, reference_id, amount, charge_date, invoice_id_sb, additional_details')
      .eq('client_id', sbClient.id)
      .eq('transaction_fee', 'Warehousing Fee')

    console.log(`\nWarehousing Fees attributed to ShipBob Payments: ${sbWarehousing?.length || 0}`)
    for (const tx of sbWarehousing || []) {
      console.log('\n  Transaction:', tx.id)
      console.log('    Reference ID:', tx.reference_id)
      console.log('    Amount: $' + tx.amount.toFixed(2))
      console.log('    Date:', tx.charge_date)
      console.log('    Invoice:', tx.invoice_id_sb)
      console.log('    Details:', JSON.stringify(tx.additional_details))
    }
  }

  // Look for pattern in Credit reference_ids
  console.log('\n' + '='.repeat(70))
  console.log('CREDIT REFERENCE ID PATTERNS')
  console.log('='.repeat(70))

  const creditRefIds = credits.map(c => c.reference_id)
  const uniqueRefs = [...new Set(creditRefIds)]
  console.log(`\nUnique reference_ids for Credits: ${uniqueRefs.length}`)
  console.log('Sample reference_ids:', uniqueRefs.slice(0, 10).join(', '))

  // Check if any reference_ids match known shipment IDs
  if (uniqueRefs.length > 0 && uniqueRefs[0] !== 'Default') {
    const { data: shipments } = await supabase
      .from('shipments')
      .select('id, client_id')
      .in('id', uniqueRefs.filter(r => /^\d+$/.test(r)).map(r => parseInt(r)))

    if (shipments && shipments.length > 0) {
      console.log(`\nMatched ${shipments.length} reference_ids to shipments`)
    } else {
      console.log('\nNo reference_ids matched to shipment IDs')
    }
  }

  // Check additional_details for clues
  console.log('\n--- Additional Details Analysis ---')
  const detailKeys = new Set()
  for (const tx of credits) {
    if (tx.additional_details) {
      Object.keys(tx.additional_details).forEach(k => detailKeys.add(k))
    }
  }
  console.log('Keys in additional_details:', [...detailKeys].join(', ') || 'none')

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`\nUnattributed Credits: ${credits.length}`)
  console.log(`Unattributed CC Processing Fees: ${(byFee['Credit Card Processing Fee'] || []).length}`)
  console.log(`Unattributed Warehousing Fees: ${(byFee['Warehousing Fee'] || []).length}`)

  const total = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)

  console.log(`\nTotal unattributed transactions: ${total.count}`)
}

main().catch(console.error)
