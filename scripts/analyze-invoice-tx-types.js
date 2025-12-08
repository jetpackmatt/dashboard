/**
 * Analyze transaction fee types for invoice 8633612
 * to understand why XLSX totals don't match our DB
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('TRANSACTION FEE TYPES FOR INVOICE 8633612')
  console.log('='.repeat(70))

  // Get all transactions for this invoice
  let allTx = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('transaction_fee, reference_type, amount, client_id')
      .eq('invoice_id_sb', 8633612)
      .range(offset, offset + 999)

    if (error) {
      console.log('Error:', error)
      return
    }
    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  console.log('\nTotal transactions:', allTx.length)

  // Aggregate by transaction_fee and reference_type
  const summary = {}
  for (const tx of allTx) {
    const key = `${tx.transaction_fee} | ${tx.reference_type}`
    if (!summary[key]) {
      summary[key] = { count: 0, total: 0 }
    }
    summary[key].count++
    summary[key].total += Number(tx.amount)
  }

  console.log('\nBy Fee Type:')
  console.log('-'.repeat(70))

  // Sort by total descending
  const sorted = Object.entries(summary).sort((a, b) => b[1].total - a[1].total)
  for (const [key, val] of sorted) {
    console.log(`${key.padEnd(45)} Count: ${String(val.count).padStart(5)} Total: $${val.total.toFixed(2)}`)
  }

  const grandTotal = allTx.reduce((s, t) => s + Number(t.amount), 0)
  console.log('-'.repeat(70))
  console.log(`GRAND TOTAL: ${allTx.length} transactions, $${grandTotal.toFixed(2)}`)

  // Get Henson client ID
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name')
    .ilike('company_name', '%henson%')
    .single()

  if (henson) {
    console.log('\n' + '='.repeat(70))
    console.log('HENSON ONLY (client_id:', henson.id + ')')
    console.log('='.repeat(70))

    const hensonTx = allTx.filter(t => t.client_id === henson.id)

    // Aggregate Henson by fee type
    const hensonSummary = {}
    for (const tx of hensonTx) {
      const key = `${tx.transaction_fee} | ${tx.reference_type}`
      if (!hensonSummary[key]) {
        hensonSummary[key] = { count: 0, total: 0 }
      }
      hensonSummary[key].count++
      hensonSummary[key].total += Number(tx.amount)
    }

    const hensonSorted = Object.entries(hensonSummary).sort((a, b) => b[1].total - a[1].total)
    for (const [key, val] of hensonSorted) {
      console.log(`${key.padEnd(45)} Count: ${String(val.count).padStart(5)} Total: $${val.total.toFixed(2)}`)
    }

    const hensonTotal = hensonTx.reduce((s, t) => s + Number(t.amount), 0)
    console.log('-'.repeat(70))
    console.log(`HENSON TOTAL: ${hensonTx.length} transactions, $${hensonTotal.toFixed(2)}`)

    // Count shipping-related only
    const hensonShipping = hensonTx.filter(t => t.reference_type === 'Shipment')
    const shippingTotal = hensonShipping.reduce((s, t) => s + Number(t.amount), 0)
    console.log(`\nHenson Shipping only: ${hensonShipping.length} tx, $${shippingTotal.toFixed(2)}`)
    console.log('\nXLSX Henson Shipping: $9,715.24')
    console.log(`Gap: $${(9715.24 - shippingTotal).toFixed(2)}`)
  }
}

main().catch(console.error)
