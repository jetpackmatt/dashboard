/**
 * Full unmatched analysis - get complete picture
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== FULL UNMATCHED SHIPPING ANALYSIS ===\n')

  // Get total unmatched count
  const { count: total } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .lt('charge_date', '2025-12-01')

  console.log(`Total unmatched before 2025-12-01: ${total}`)

  // Break down by date range
  const ranges = [
    { start: '2025-03-01', end: '2025-03-31', label: 'March 2025' },
    { start: '2025-04-01', end: '2025-04-30', label: 'April 2025' },
    { start: '2025-05-01', end: '2025-05-31', label: 'May 2025' },
    { start: '2025-06-01', end: '2025-06-30', label: 'June 2025' },
    { start: '2025-07-01', end: '2025-07-31', label: 'July 2025' },
    { start: '2025-08-01', end: '2025-08-31', label: 'August 2025' },
    { start: '2025-09-01', end: '2025-09-30', label: 'September 2025' },
    { start: '2025-10-01', end: '2025-10-31', label: 'October 2025' },
    { start: '2025-11-01', end: '2025-11-30', label: 'November 2025' }
  ]

  console.log('\n=== BY MONTH ===')
  for (const range of ranges) {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
      .is('invoice_id_jp', null)
      .gte('charge_date', range.start)
      .lte('charge_date', range.end)

    if (count > 0) {
      console.log(`${range.label}: ${count} unmatched`)
    }
  }

  // Check JPHS-0001 specifically - the first invoice
  console.log('\n=== JPHS-0001 INVOICE ANALYSIS ===')
  const { data: jphs0001 } = await supabase
    .from('invoices_jetpack')
    .select('id, period_start, period_end')
    .eq('invoice_number', 'JPHS-0001-032425')
    .single()

  if (jphs0001) {
    console.log(`Period: ${jphs0001.period_start?.slice(0,10)} to ${jphs0001.period_end?.slice(0,10)}`)

    // How many shipping transactions were matched to this invoice?
    const { count: matched } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id_jp', jphs0001.id)
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])

    console.log(`Shipping transactions matched to JPHS-0001: ${matched}`)

    // How many shipping transactions are in this period but NOT matched?
    const { count: inPeriodUnmatched } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
      .is('invoice_id_jp', null)
      .gte('charge_date', jphs0001.period_start.slice(0, 10))
      .lte('charge_date', jphs0001.period_end.slice(0, 10))

    console.log(`Shipping in period but NOT matched: ${inPeriodUnmatched}`)

    // Total shipping transactions in this period
    const { count: totalInPeriod } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
      .gte('charge_date', jphs0001.period_start.slice(0, 10))
      .lte('charge_date', jphs0001.period_end.slice(0, 10))

    console.log(`Total shipping in period: ${totalInPeriod}`)
  }

  // Check if there's a pattern - maybe these are transactions NOT in XLS
  console.log('\n=== HYPOTHESIS: Some DB transactions not in XLS ===')
  console.log('This could happen if:')
  console.log('  1. ShipBob API returns transactions that were later voided/credited')
  console.log('  2. Timing differences between API sync and invoice generation')
  console.log('  3. Some shipments were free samples or internal test orders')

  // Check a specific unmatched reference ID
  const { data: sample } = await supabase
    .from('transactions')
    .select('reference_id, charge_date, cost, raw_data')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .lt('charge_date', '2025-04-01')
    .limit(5)

  console.log('\nSample unmatched transactions (with raw_data):')
  sample?.forEach(r => {
    console.log(`  ${r.reference_id} - ${r.charge_date} - $${r.cost}`)
    if (r.raw_data) {
      console.log(`    invoiced_status: ${r.raw_data.invoiced_status}`)
      console.log(`    invoice_id: ${r.raw_data.invoice_id}`)
    }
  })
}

check().catch(console.error)
