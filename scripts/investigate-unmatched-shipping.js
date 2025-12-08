/**
 * Investigate unmatched shipping transactions before latest invoice cutoff
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== UNMATCHED SHIPPING BEFORE 2025-12-01 ===\n')

  // Get all unmatched shipping before cutoff
  const { data: unmatched, error } = await supabase
    .from('transactions')
    .select('reference_id, charge_date, client_id, cost, transaction_fee')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .lt('charge_date', '2025-12-01')
    .order('charge_date')

  if (error) {
    console.log('Error:', error)
    return
  }

  console.log(`Total unmatched: ${unmatched.length}`)

  // Group by client
  const byClient = {}
  unmatched.forEach(r => {
    if (!byClient[r.client_id]) byClient[r.client_id] = []
    byClient[r.client_id].push(r)
  })

  console.log('\n=== BY CLIENT ===')
  for (const [clientId, txs] of Object.entries(byClient)) {
    console.log(`Client ${clientId}: ${txs.length} unmatched`)
  }

  // Get client names
  const clientIds = Object.keys(byClient)
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')
    .in('id', clientIds)

  const clientMap = {}
  clients?.forEach(c => { clientMap[c.id] = c.company_name })

  console.log('\n=== BY CLIENT (with names) ===')
  for (const [clientId, txs] of Object.entries(byClient)) {
    const name = clientMap[clientId] || 'Unknown'
    console.log(`${name}: ${txs.length} unmatched`)
  }

  // Group by date for the largest client
  const largestClientId = Object.entries(byClient).sort((a, b) => b[1].length - a[1].length)[0][0]
  const largestClientName = clientMap[largestClientId] || 'Unknown'

  console.log(`\n=== ${largestClientName} (${largestClientId}) UNMATCHED BY DATE ===`)
  const byDate = {}
  byClient[largestClientId].forEach(r => {
    byDate[r.charge_date] = (byDate[r.charge_date] || 0) + 1
  })

  Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0])).forEach(([date, count]) => {
    if (count > 10) console.log(`  ${date}: ${count}`)
  })

  // Check if these reference_ids appear in ANY invoice's period
  console.log('\n=== SAMPLE REFERENCE IDS ===')
  const sampleIds = unmatched.slice(0, 10)
  console.log('First 10 unmatched:')
  sampleIds.forEach(r => {
    console.log(`  ${r.reference_id} - ${r.charge_date} - $${r.cost}`)
  })

  // Check JPHS-0010 specifically since we know it had issues
  console.log('\n=== JPHS-0010 (May 19-26) ANALYSIS ===')
  const may19to26 = unmatched.filter(r => r.charge_date >= '2025-05-19' && r.charge_date <= '2025-05-26')
  console.log(`Unmatched in May 19-26: ${may19to26.length}`)

  // Check Methyl-Life specifically - they started later
  console.log('\n=== METHYL-LIFE FIRST INVOICE PERIOD ===')
  const { data: mlInvoices } = await supabase
    .from('invoices_jetpack')
    .select('invoice_number, period_start, period_end')
    .like('invoice_number', 'JPML%')
    .order('period_start')
    .limit(3)

  console.log('First Methyl-Life invoices:')
  mlInvoices?.forEach(inv => {
    console.log(`  ${inv.invoice_number}: ${inv.period_start?.slice(0,10)} to ${inv.period_end?.slice(0,10)}`)
  })

  // Get ML client ID
  const { data: mlClient } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'Methyl-Life')
    .single()

  if (mlClient) {
    // Count ML transactions before their first invoice
    const { count: mlBeforeFirst } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', mlClient.id)
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
      .lt('charge_date', mlInvoices?.[0]?.period_start?.slice(0, 10) || '2025-07-08')

    console.log(`\nMethyl-Life shipping transactions BEFORE first invoice (${mlInvoices?.[0]?.period_start?.slice(0,10)}): ${mlBeforeFirst}`)
  }
}

check().catch(console.error)
