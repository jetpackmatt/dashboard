/**
 * Debug invoice discrepancy - compare our totals vs ShipBob invoice
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get Henson
  const { data: henson } = await supabase
    .from('clients')
    .select('id')
    .ilike('company_name', '%henson%')
    .single()

  // Check invoices_sb for Dec 1 (covers Nov 24-30)
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('*')
    .eq('invoice_date', '2025-12-01')
    .order('invoice_type')

  console.log('ShipBob Invoices for Dec 1, 2025:')
  console.log('='.repeat(100))
  let totalBase = 0
  for (const inv of invoices || []) {
    const amt = Number(inv.base_amount)
    totalBase += amt
    console.log(
      inv.shipbob_invoice_id.padEnd(12),
      inv.invoice_type.padEnd(25),
      ('$' + amt.toFixed(2)).padStart(12),
      'Period:', inv.period_start, 'to', inv.period_end
    )
  }
  console.log('='.repeat(100))
  console.log('Total from invoices_sb:', '$' + totalBase.toFixed(2))

  // Filter to non-Payment invoices
  const invoiceIds = (invoices || [])
    .filter(i => i.invoice_type !== 'Payment')
    .map(i => i.shipbob_invoice_id)

  console.log('\nInvoice IDs (excluding Payment):', invoiceIds.join(', '))

  // Get transaction totals by fee type for Henson
  let allTx = []
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('transaction_fee, amount')
      .eq('client_id', henson.id)
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  const byFee = {}
  for (const tx of allTx) {
    const fee = tx.transaction_fee || 'Unknown'
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += Number(tx.amount)
  }

  console.log('\nTransactions by Fee Type (Henson only):')
  console.log('-'.repeat(70))
  let grandTotal = 0
  const sorted = Object.entries(byFee).sort((a, b) => b[1].total - a[1].total)
  for (const [fee, stats] of sorted) {
    console.log(
      fee.padEnd(45),
      String(stats.count).padStart(5),
      ('$' + stats.total.toFixed(2)).padStart(14)
    )
    grandTotal += stats.total
  }
  console.log('-'.repeat(70))
  console.log('Transaction Total (Henson):'.padEnd(45), '', ('$' + grandTotal.toFixed(2)).padStart(14))

  // Now get ALL transactions for these invoice IDs (all clients)
  console.log('\n\nNow checking ALL transactions for these invoice IDs (all clients):')
  let allClientsTx = []
  offset = 0
  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('client_id, transaction_fee, amount')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (!data || data.length === 0) break
    allClientsTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  // Group by client
  const byClient = {}
  for (const tx of allClientsTx) {
    const cid = tx.client_id || 'null'
    if (!byClient[cid]) byClient[cid] = 0
    byClient[cid] += Number(tx.amount)
  }

  console.log('-'.repeat(50))
  let allClientsTotal = 0
  for (const [cid, total] of Object.entries(byClient)) {
    console.log('Client', cid.substring(0,8) + '...', ('$' + total.toFixed(2)).padStart(14))
    allClientsTotal += total
  }
  console.log('-'.repeat(50))
  console.log('All Clients Total:', ('$' + allClientsTotal.toFixed(2)).padStart(14))

  // Check for transactions with NULL client_id
  const nullClientTx = allClientsTx.filter(t => t.client_id === null)
  if (nullClientTx.length > 0) {
    console.log('\n⚠️  Found', nullClientTx.length, 'transactions with NULL client_id')
    const nullByFee = {}
    for (const tx of nullClientTx) {
      const fee = tx.transaction_fee || 'Unknown'
      if (!nullByFee[fee]) nullByFee[fee] = { count: 0, total: 0 }
      nullByFee[fee].count++
      nullByFee[fee].total += Number(tx.amount)
    }
    for (const [fee, stats] of Object.entries(nullByFee)) {
      console.log('  ', fee.padEnd(40), stats.count, ('$' + stats.total.toFixed(2)).padStart(12))
    }
  }

  // Compare
  console.log('\n\nCOMPARISON:')
  console.log('='.repeat(50))
  console.log('ShipBob Invoice Total:    $' + totalBase.toFixed(2))
  console.log('Henson Transaction Total: $' + grandTotal.toFixed(2))
  console.log('All Clients Total:        $' + allClientsTotal.toFixed(2))
  console.log('Difference (ShipBob - Henson): $' + (totalBase - grandTotal).toFixed(2))
}

main().catch(console.error)
