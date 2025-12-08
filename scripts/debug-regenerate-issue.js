/**
 * Debug why credits and receiving are missing from JPHS-0037 regeneration
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  console.log('=== Debug JPHS-0037 Regeneration Issue ===\n')

  // Step 1: Get ShipBob invoice IDs the same way regenerate route does
  console.log('Step 1: Getting ShipBob invoice IDs from transactions with invoice_id_jp = JPHS-0037-120125\n')

  const invoiceIdSet = new Set()
  let offset = 0
  const PAGE_SIZE = 1000
  let hasMore = true
  let totalTxChecked = 0

  while (hasMore) {
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('invoice_id_sb, transaction_fee')
      .eq('client_id', HENSON_CLIENT_ID)
      .eq('invoice_id_jp', 'JPHS-0037-120125')
      .not('invoice_id_sb', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (txError) {
      console.error('Error:', txError.message)
      return
    }

    for (const t of transactions || []) {
      if (t.invoice_id_sb !== null) {
        invoiceIdSet.add(t.invoice_id_sb)
      }
    }

    totalTxChecked += transactions?.length || 0
    hasMore = (transactions?.length || 0) === PAGE_SIZE
    offset += PAGE_SIZE
  }

  const shipbobInvoiceIds = Array.from(invoiceIdSet)
  console.log(`Found ${shipbobInvoiceIds.length} unique ShipBob invoice IDs from ${totalTxChecked} transactions:`)
  console.log(shipbobInvoiceIds)

  // Step 2: Now fetch transactions using those invoice IDs (like collectBillingTransactionsByInvoiceIds does)
  console.log('\n\nStep 2: Fetching transactions by invoice_id_sb IN (...)\n')

  const allTransactions = []
  for (const invoiceId of shipbobInvoiceIds) {
    let innerOffset = 0
    while (true) {
      const { data: batch } = await supabase
        .from('transactions')
        .select('id, transaction_fee, reference_type, cost, invoice_id_sb')
        .eq('client_id', HENSON_CLIENT_ID)
        .eq('invoice_id_sb', invoiceId)
        .order('charge_date', { ascending: true })
        .range(innerOffset, innerOffset + 999)

      if (!batch || batch.length === 0) break
      allTransactions.push(...batch)
      if (batch.length < 1000) break
      innerOffset += 1000
    }
  }

  console.log(`Total transactions fetched: ${allTransactions.length}`)

  // Breakdown by transaction_fee
  const byFee = {}
  for (const tx of allTransactions) {
    const fee = tx.transaction_fee || 'NULL'
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += parseFloat(tx.cost) || 0
  }

  console.log('\nBreakdown by transaction_fee:')
  for (const [fee, data] of Object.entries(byFee)) {
    console.log(`  ${fee}: ${data.count} transactions, $${data.total.toFixed(2)}`)
  }

  // Check specifically for credits and receiving
  const credits = allTransactions.filter(tx => tx.transaction_fee === 'Credit')
  const receiving = allTransactions.filter(tx => tx.transaction_fee === 'WRO Receiving Fee')

  console.log(`\n\nCredits found: ${credits.length}`)
  if (credits.length > 0) {
    console.log('Sample credit:', credits[0])
  }

  console.log(`\nReceiving found: ${receiving.length}`)
  if (receiving.length > 0) {
    console.log('Sample receiving:', receiving[0])
  }

  // Step 3: Check if there are credits/receiving that SHOULD be included but have different invoice_id_sb
  console.log('\n\nStep 3: Check for credits/receiving with invoice_id_jp but NOT in shipbobInvoiceIds\n')

  const { data: missingCredits } = await supabase
    .from('transactions')
    .select('id, transaction_fee, cost, invoice_id_sb, invoice_id_jp')
    .eq('client_id', HENSON_CLIENT_ID)
    .eq('invoice_id_jp', 'JPHS-0037-120125')
    .eq('transaction_fee', 'Credit')

  console.log(`Credits with invoice_id_jp = JPHS-0037-120125: ${missingCredits?.length || 0}`)
  if (missingCredits?.length > 0) {
    console.log('Their invoice_id_sb values:', [...new Set(missingCredits.map(c => c.invoice_id_sb))])
  }

  const { data: missingReceiving } = await supabase
    .from('transactions')
    .select('id, transaction_fee, cost, invoice_id_sb, invoice_id_jp')
    .eq('client_id', HENSON_CLIENT_ID)
    .eq('invoice_id_jp', 'JPHS-0037-120125')
    .eq('transaction_fee', 'WRO Receiving Fee')

  console.log(`\nReceiving with invoice_id_jp = JPHS-0037-120125: ${missingReceiving?.length || 0}`)
  if (missingReceiving?.length > 0) {
    console.log('Their invoice_id_sb values:', [...new Set(missingReceiving.map(r => r.invoice_id_sb))])
  }
}

main().catch(console.error)
