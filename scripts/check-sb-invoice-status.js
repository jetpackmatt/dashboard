/**
 * Check ShipBob invoice status on unmatched transactions
 * Are these transactions that ShipBob charged but we didn't invoice?
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== SHIPBOB INVOICE STATUS ON UNMATCHED ===\n')

  // Get a sample of unmatched transactions with their ShipBob invoice status
  const { data: unmatched } = await supabase
    .from('transactions')
    .select('reference_id, charge_date, cost, invoiced_status_sb, invoice_id_sb, transaction_fee')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .lt('charge_date', '2025-12-01')
    .limit(1000)

  // Group by ShipBob invoiced status
  const byStatus = {}
  unmatched?.forEach(r => {
    const status = r.invoiced_status_sb || 'NULL'
    if (!byStatus[status]) byStatus[status] = 0
    byStatus[status]++
  })

  console.log('ShipBob invoiced status distribution (first 1000):')
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`)
  }

  // Get count by invoice_id_sb
  const byInvoice = {}
  unmatched?.forEach(r => {
    const inv = r.invoice_id_sb || 'NULL'
    if (!byInvoice[inv]) byInvoice[inv] = 0
    byInvoice[inv]++
  })

  console.log('\nShipBob invoice ID distribution:')
  const sortedInvoices = Object.entries(byInvoice).sort((a, b) => b[1] - a[1])
  sortedInvoices.slice(0, 20).forEach(([inv, count]) => {
    console.log(`  ${inv}: ${count}`)
  })

  // Check if unmatched transactions have the same invoice_id_sb as matched ones
  console.log('\n=== COMPARING MATCHED vs UNMATCHED INVOICE_ID_SB ===')

  // Get distinct invoice_id_sb from MATCHED transactions in March
  const { data: matchedInMarch } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .not('invoice_id_jp', 'is', null)
    .gte('charge_date', '2025-03-01')
    .lte('charge_date', '2025-03-31')
    .limit(1000)

  const matchedSbInvoices = new Set(matchedInMarch?.map(r => r.invoice_id_sb).filter(Boolean))
  console.log(`Matched transactions have ${matchedSbInvoices.size} distinct ShipBob invoice IDs`)
  console.log('Sample matched invoice IDs:', [...matchedSbInvoices].slice(0, 5))

  // Get distinct invoice_id_sb from UNMATCHED transactions in March
  const { data: unmatchedInMarch } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .gte('charge_date', '2025-03-01')
    .lte('charge_date', '2025-03-31')
    .limit(1000)

  const unmatchedSbInvoices = new Set(unmatchedInMarch?.map(r => r.invoice_id_sb).filter(Boolean))
  console.log(`\nUnmatched transactions have ${unmatchedSbInvoices.size} distinct ShipBob invoice IDs`)
  console.log('Sample unmatched invoice IDs:', [...unmatchedSbInvoices].slice(0, 5))

  // Check overlap
  const overlap = [...unmatchedSbInvoices].filter(id => matchedSbInvoices.has(id))
  console.log(`\nOverlap: ${overlap.length} ShipBob invoice IDs appear in BOTH matched and unmatched`)

  // Check if any unmatched have no ShipBob invoice
  const unmatchedNoSbInvoice = unmatchedInMarch?.filter(r => !r.invoice_id_sb).length || 0
  console.log(`Unmatched with NO ShipBob invoice_id_sb: ${unmatchedNoSbInvoice}`)

  // Hypothesis test: Are unmatched from DIFFERENT ShipBob invoices?
  console.log('\n=== HYPOTHESIS: Unmatched are from different SB invoices ===')
  const onlyInUnmatched = [...unmatchedSbInvoices].filter(id => !matchedSbInvoices.has(id))
  console.log(`ShipBob invoice IDs only in UNMATCHED (not in matched): ${onlyInUnmatched.length}`)
  console.log('Sample:', onlyInUnmatched.slice(0, 10))
}

check().catch(console.error)
