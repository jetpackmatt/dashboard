/**
 * Investigate client attribution problem in invoice 8633612
 * Henson should have $9,715.24 but has $8,329.54 (missing $1,385.70)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get both clients
  const { data: clients, error: clientsErr } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')

  if (clientsErr) {
    console.error('Error fetching clients:', clientsErr)
    return
  }

  console.log('='.repeat(70))
  console.log('CLIENTS:')
  console.log('='.repeat(70))
  for (const c of clients || []) {
    console.log(`  ${c.company_name}`)
    console.log(`    ID: ${c.id}`)
    console.log(`    Merchant ID: ${c.merchant_id}`)
    console.log('')
  }

  const henson = clients.find(c => c.company_name.toLowerCase().includes('henson'))
  const other = clients.find(c => c.id === 'ca33dd0e-28a7-4c77-9d86-0d5da5e1bcfd')

  // Invoice 8633612 is the shipping invoice
  const invoiceId = 8633612

  // Get transactions grouped by client_id and merchant_id
  const { data: txByClient } = await supabase
    .from('transactions')
    .select('client_id, merchant_id, amount')
    .eq('invoice_id_sb', invoiceId)

  // Group by client_id and merchant_id
  const groups = {}
  for (const tx of txByClient || []) {
    const key = `${tx.client_id}|${tx.merchant_id}`
    if (!groups[key]) groups[key] = { client_id: tx.client_id, merchant_id: tx.merchant_id, count: 0, total: 0 }
    groups[key].count++
    groups[key].total += Number(tx.amount)
  }

  console.log('='.repeat(70))
  console.log('TRANSACTIONS IN INVOICE 8633612 BY CLIENT AND MERCHANT:')
  console.log('='.repeat(70))
  for (const [key, g] of Object.entries(groups).sort((a, b) => b[1].total - a[1].total)) {
    const clientName = clients.find(c => c.id === g.client_id)?.company_name || 'Unknown'
    console.log(`  ${clientName.substring(0, 25).padEnd(25)} merchant: ${String(g.merchant_id).padEnd(10)} ${g.count} tx  $${g.total.toFixed(2)}`)
  }

  // Now let's check: do these transactions have correct merchant_id?
  // If Henson has merchant_id 386350, ALL transactions with merchant_id 386350 should be Henson's
  console.log('\n' + '='.repeat(70))
  console.log('CHECKING IF MERCHANT_ID MATCHES CLIENT ASSIGNMENT:')
  console.log('='.repeat(70))

  // Get all transactions in this invoice with their merchant_id
  const { data: allTx } = await supabase
    .from('transactions')
    .select('id, client_id, merchant_id, amount')
    .eq('invoice_id_sb', invoiceId)

  // Check for mismatches
  let mismatches = 0
  let mismatchTotal = 0
  const mismatchSamples = []

  for (const tx of allTx || []) {
    const client = clients.find(c => c.id === tx.client_id)
    if (client && client.merchant_id && tx.merchant_id) {
      if (String(client.merchant_id) !== String(tx.merchant_id)) {
        mismatches++
        mismatchTotal += Number(tx.amount)
        if (mismatchSamples.length < 10) {
          mismatchSamples.push({
            txId: tx.id,
            txMerchantId: tx.merchant_id,
            clientMerchantId: client.merchant_id,
            clientName: client.company_name,
            amount: tx.amount
          })
        }
      }
    }
  }

  console.log(`  Transactions with merchant_id mismatch: ${mismatches}`)
  console.log(`  Total amount in mismatched tx: $${mismatchTotal.toFixed(2)}`)

  if (mismatchSamples.length > 0) {
    console.log('\n  Sample mismatches:')
    for (const m of mismatchSamples) {
      console.log(`    Tx ${m.txId}: merchant_id=${m.txMerchantId}, client merchant_id=${m.clientMerchantId}, client=${m.clientName}, $${m.amount}`)
    }
  }

  // Let's also check if there are transactions with merchant_id = 386350 (Henson's) that are NOT assigned to Henson
  console.log('\n' + '='.repeat(70))
  console.log('TRANSACTIONS WITH HENSON MERCHANT_ID (386350) NOT ASSIGNED TO HENSON:')
  console.log('='.repeat(70))

  const { data: hensonMerchantTx } = await supabase
    .from('transactions')
    .select('id, client_id, merchant_id, amount, transaction_fee')
    .eq('invoice_id_sb', invoiceId)
    .eq('merchant_id', henson?.merchant_id || 386350)
    .neq('client_id', henson?.id)

  console.log(`  Count: ${hensonMerchantTx?.length || 0}`)
  if (hensonMerchantTx?.length > 0) {
    let total = 0
    for (const tx of hensonMerchantTx) {
      total += Number(tx.amount)
    }
    console.log(`  Total: $${total.toFixed(2)}`)
    console.log(`  This is the MISATTRIBUTED amount!`)
  }

  // Check the reverse: transactions assigned to Henson but with different merchant_id
  console.log('\n' + '='.repeat(70))
  console.log('TRANSACTIONS ASSIGNED TO HENSON WITH NON-HENSON MERCHANT_ID:')
  console.log('='.repeat(70))

  const { data: wrongMerchantTx } = await supabase
    .from('transactions')
    .select('id, client_id, merchant_id, amount, transaction_fee')
    .eq('invoice_id_sb', invoiceId)
    .eq('client_id', henson?.id)
    .neq('merchant_id', henson?.merchant_id || 386350)

  console.log(`  Count: ${wrongMerchantTx?.length || 0}`)
  if (wrongMerchantTx?.length > 0) {
    let total = 0
    for (const tx of wrongMerchantTx) {
      total += Number(tx.amount)
    }
    console.log(`  Total: $${total.toFixed(2)}`)
  }

  // Let's see what OTHER merchant_ids exist in this invoice
  console.log('\n' + '='.repeat(70))
  console.log('ALL MERCHANT_IDS IN INVOICE 8633612:')
  console.log('='.repeat(70))

  const merchantIds = new Set()
  for (const tx of allTx || []) {
    merchantIds.add(tx.merchant_id)
  }

  for (const mid of merchantIds) {
    const matchingClient = clients.find(c => String(c.merchant_id) === String(mid))
    const txsWithMid = (allTx || []).filter(t => t.merchant_id === mid)
    const total = txsWithMid.reduce((s, t) => s + Number(t.amount), 0)
    console.log(`  merchant_id ${mid}: ${txsWithMid.length} tx, $${total.toFixed(2)} -> ${matchingClient?.company_name || 'NO MATCHING CLIENT'}`)
  }
}

main().catch(console.error)
