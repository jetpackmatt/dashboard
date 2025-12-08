/**
 * Analyze unmatched transactions by type
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== UNMATCHED TRANSACTIONS BY TYPE ===\n')

  const types = [
    'Shipping',
    'Shipping Zone',
    'Dimensional Shipping Upgrade',
    'Per Pick Fee',
    'Kitting Fee',
    'Box Fee',
    'Storage Removal Fee',
    'Returns',
    'Receiving',
    'Storage',
    'Credit',
    'Credit Card Processing Fee'
  ]

  console.log('Type'.padEnd(30) + 'Matched'.padStart(10) + 'Unmatched'.padStart(12) + 'Total'.padStart(10) + 'Match%'.padStart(8))
  console.log('-'.repeat(70))

  let totalMatched = 0
  let totalUnmatched = 0
  let totalAll = 0

  for (const fee of types) {
    const { count: total } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_fee', fee)

    if (total > 0) {
      const { count: matched } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('transaction_fee', fee)
        .not('invoice_id_jp', 'is', null)

      const unmatched = total - (matched || 0)
      totalMatched += matched || 0
      totalUnmatched += unmatched
      totalAll += total

      console.log(fee.padEnd(30) + String(matched || 0).padStart(10) + String(unmatched).padStart(12) + String(total).padStart(10) + (Math.round((matched || 0) / total * 100) + '%').padStart(8))
    }
  }

  console.log('-'.repeat(70))
  console.log('TOTAL'.padEnd(30) + String(totalMatched).padStart(10) + String(totalUnmatched).padStart(12) + String(totalAll).padStart(10) + (Math.round(totalMatched / totalAll * 100) + '%').padStart(8))

  // Now analyze WHERE the unmatched shipping transactions are
  console.log('\n=== UNMATCHED SHIPPING BY DATE ===')

  const { data: unmatchedShipping } = await supabase
    .from('transactions')
    .select('charge_date')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)

  if (unmatchedShipping) {
    const byDate = {}
    unmatchedShipping.forEach(r => {
      byDate[r.charge_date] = (byDate[r.charge_date] || 0) + 1
    })

    // Sort by date and show first 20
    const sortedDates = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]))
    console.log(`Total unmatched: ${unmatchedShipping.length}`)
    console.log('First 20 dates:')
    sortedDates.slice(0, 20).forEach(([date, count]) => {
      console.log(`  ${date}: ${count}`)
    })
  }

  // Check if unmatched are recent (no invoice yet) vs old (sync gap)
  console.log('\n=== UNMATCHED SHIPPING BY PERIOD ===')
  const { data: latestInvoice } = await supabase
    .from('invoices_jetpack')
    .select('period_end')
    .order('period_end', { ascending: false })
    .limit(1)

  const latestPeriodEnd = latestInvoice?.[0]?.period_end?.slice(0, 10) || '2025-12-01'
  console.log(`Latest invoice period_end: ${latestPeriodEnd}`)

  const { count: unmatchedAfterLatest } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .gte('charge_date', latestPeriodEnd)

  const { count: unmatchedBeforeLatest } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .lt('charge_date', latestPeriodEnd)

  console.log(`Unmatched AFTER ${latestPeriodEnd} (expected - no invoice yet): ${unmatchedAfterLatest}`)
  console.log(`Unmatched BEFORE ${latestPeriodEnd} (unexpected - should have invoice): ${unmatchedBeforeLatest}`)
}

check().catch(console.error)
