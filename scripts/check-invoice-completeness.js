/**
 * Check if we have all transactions for the Dec 1 invoices
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Invoice IDs for Dec 1
  const invoiceIds = [8633641, 8633637, 8633634, 8633632, 8633618, 8633612]

  console.log('='.repeat(70))
  console.log('INVOICE COMPLETENESS CHECK')
  console.log('='.repeat(70))

  // Check invoices_sb table
  console.log('\nInvoices from invoices_sb table:')
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('*')
    .in('invoice_id', invoiceIds)

  for (const inv of invoices || []) {
    console.log(`  Invoice ${inv.invoice_id}: $${Number(inv.total_amount).toFixed(2)} (${inv.category})`)
  }

  // Count transactions for each invoice
  console.log('\n\nTransaction counts from transactions table:')
  for (const invId of invoiceIds) {
    // Count all transactions for this invoice
    let allTx = []
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('transactions')
        .select('client_id, amount')
        .eq('invoice_id_sb', invId)
        .range(offset, offset + 999)

      if (error) {
        console.log('Error:', error)
        break
      }
      if (!data || data.length === 0) break
      allTx.push(...data)
      offset += data.length
      if (data.length < 1000) break
    }

    const total = allTx.reduce((s, t) => s + Number(t.amount), 0)

    // Find matching invoice
    const inv = invoices?.find(i => i.invoice_id === invId)
    const diff = inv ? (Number(inv.total_amount) - total) : null

    console.log(`  Invoice ${invId}: ${allTx.length} tx, $${total.toFixed(2)} (expected: $${inv?.total_amount || 'N/A'}, diff: $${diff?.toFixed(2) || 'N/A'})`)

    // By client
    const byClient = {}
    for (const tx of allTx) {
      if (!byClient[tx.client_id]) byClient[tx.client_id] = { count: 0, total: 0 }
      byClient[tx.client_id].count++
      byClient[tx.client_id].total += Number(tx.amount)
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name')

    for (const [clientId, stats] of Object.entries(byClient)) {
      const name = clients?.find(c => c.id === clientId)?.company_name || 'Unknown'
      console.log(`      ${name}: ${stats.count} tx, $${stats.total.toFixed(2)}`)
    }
  }

  // Get Henson's total
  console.log('\n' + '='.repeat(70))
  console.log('HENSON TOTALS ACROSS ALL DEC 1 INVOICES:')
  console.log('='.repeat(70))

  const { data: henson } = await supabase
    .from('clients')
    .select('id')
    .ilike('company_name', '%henson%')
    .single()

  let hensonTx = []
  let offset2 = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('invoice_id_sb, transaction_fee, amount')
      .eq('client_id', henson.id)
      .in('invoice_id_sb', invoiceIds)
      .range(offset2, offset2 + 999)

    if (error) break
    if (!data || data.length === 0) break
    hensonTx.push(...data)
    offset2 += data.length
    if (data.length < 1000) break
  }

  // By invoice
  const byInvoice = {}
  for (const tx of hensonTx) {
    if (!byInvoice[tx.invoice_id_sb]) byInvoice[tx.invoice_id_sb] = { count: 0, total: 0 }
    byInvoice[tx.invoice_id_sb].count++
    byInvoice[tx.invoice_id_sb].total += Number(tx.amount)
  }

  console.log('\nHenson by Invoice:')
  let grandTotal = 0
  for (const invId of invoiceIds) {
    const inv = invoices?.find(i => i.invoice_id === invId)
    const stats = byInvoice[invId] || { count: 0, total: 0 }
    grandTotal += stats.total
    console.log(`  ${inv?.category?.padEnd(25) || 'Unknown'.padEnd(25)}: ${String(stats.count).padStart(5)} tx, $${stats.total.toFixed(2)}`)
  }
  console.log('')
  console.log(`  ${'TOTAL'.padEnd(25)}: ${hensonTx.length.toString().padStart(5)} tx, $${grandTotal.toFixed(2)}`)

  // Expected totals from the manual invoice
  console.log('\n' + '='.repeat(70))
  console.log('COMPARISON TO EXPECTED (ShipBob Manual Invoice):')
  console.log('='.repeat(70))
  const expected = {
    'Shipping': 9715.24,
    'Additional Services': 765.95,
    'Returns': 14.79,
    'Receiving': 35.00,
    'Storage': 997.94,
    'Credits': -686.12,
  }

  // Map our transaction categories
  const FEE_TO_EXPECTED = {
    'Shipping': 'Shipping',
    'Delivery Area Surcharge': 'Shipping',
    'Residential Surcharge': 'Shipping',
    'Fuel Surcharge': 'Shipping',
    'Oversized Surcharge': 'Shipping',
    'Extended Area Surcharge': 'Shipping',
    'Additional Handling Surcharge': 'Shipping',
    'Per Pick Fee': 'Additional Services',
    'B2B - Each Pick Fee': 'Additional Services',
    'B2B - Case Pick Fee': 'Additional Services',
    'B2B - Label Fee': 'Additional Services',
    'Inventory Placement Program Fee': 'Additional Services',
    'Warehousing Fee': 'Storage',
    'Credit': 'Credits',
    'Return to sender - Processing Fees': 'Returns',
    'Return Processed by Operations Fee': 'Returns',
    'WRO Receiving Fee': 'Receiving',
  }

  const byExpectedCategory = {}
  for (const tx of hensonTx) {
    const cat = FEE_TO_EXPECTED[tx.transaction_fee] || 'Other'
    if (!byExpectedCategory[cat]) byExpectedCategory[cat] = 0
    byExpectedCategory[cat] += Number(tx.amount)
  }

  console.log('\nOur Totals vs Expected:')
  for (const [cat, expAmt] of Object.entries(expected)) {
    const ourAmt = byExpectedCategory[cat] || 0
    const diff = ourAmt - expAmt
    const status = Math.abs(diff) < 0.01 ? '✓' : `DIFF: $${diff.toFixed(2)}`
    console.log(`  ${cat.padEnd(20)}: $${ourAmt.toFixed(2).padStart(10)} vs $${expAmt.toFixed(2).padStart(10)} ${status}`)
  }

  const ourTotal = Object.values(byExpectedCategory).reduce((s, v) => s + v, 0)
  const expTotal = Object.values(expected).reduce((s, v) => s + v, 0)
  console.log('')
  console.log(`  ${'TOTAL'.padEnd(20)}: $${ourTotal.toFixed(2).padStart(10)} vs $${expTotal.toFixed(2).padStart(10)} DIFF: $${(ourTotal - expTotal).toFixed(2)}`)
}

main().catch(console.error)
