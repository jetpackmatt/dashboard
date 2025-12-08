/**
 * Final analysis - get to the root cause
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== FINAL ROOT CAUSE ANALYSIS ===\n')

  // What is invoice 23e99fe1-2af7-4022-a2a0-4fe9071b3151?
  const { data: inv } = await supabase
    .from('invoices_jetpack')
    .select('invoice_number, period_start, period_end')
    .eq('id', '23e99fe1-2af7-4022-a2a0-4fe9071b3151')
    .single()

  console.log('Invoice 23e99fe1...:', inv?.invoice_number, inv?.period_start?.slice(0,10), 'to', inv?.period_end?.slice(0,10))

  // Get JPHS-0001 actual ID
  const { data: jphs0001 } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, period_start, period_end')
    .eq('invoice_number', 'JPHS-0001-032425')
    .single()

  console.log('JPHS-0001:', jphs0001?.id, jphs0001?.period_start?.slice(0,10), 'to', jphs0001?.period_end?.slice(0,10))

  // Total shipping transactions in JPHS-0001 period (using exact count)
  const { count: totalInPeriod } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  console.log(`\nTotal shipping in JPHS-0001 period (${jphs0001.period_start.slice(0,10)} to ${jphs0001.period_end.slice(0,10)}): ${totalInPeriod}`)

  // Matched to JPHS-0001
  const { count: matchedToJphs0001 } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('invoice_id_jp', jphs0001.id)
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])

  console.log(`Matched to JPHS-0001: ${matchedToJphs0001}`)

  // Unmatched in period
  const { count: unmatchedInPeriod } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .is('invoice_id_jp', null)
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  console.log(`Unmatched in period: ${unmatchedInPeriod}`)

  // How many are matched to OTHER invoices in this period?
  const { count: otherInvoice } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .not('invoice_id_jp', 'is', null)
    .neq('invoice_id_jp', jphs0001.id)
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  console.log(`Matched to OTHER invoice: ${otherInvoice}`)

  // What invoice IDs are in the JPHS-0001 period?
  const { data: invoicesInPeriod } = await supabase
    .from('transactions')
    .select('invoice_id_jp')
    .in('transaction_fee', ['Shipping', 'Shipping Zone', 'Dimensional Shipping Upgrade'])
    .not('invoice_id_jp', 'is', null)
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  const uniqueInvoices = [...new Set(invoicesInPeriod?.map(r => r.invoice_id_jp) || [])]
  console.log(`\nUnique invoice_id_jp values in period: ${uniqueInvoices.length}`)

  for (const invId of uniqueInvoices) {
    const { data: invInfo } = await supabase
      .from('invoices_jetpack')
      .select('invoice_number')
      .eq('id', invId)
      .single()

    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id_jp', invId)
      .gte('charge_date', jphs0001.period_start.slice(0, 10))
      .lte('charge_date', jphs0001.period_end.slice(0, 10))

    console.log(`  ${invInfo?.invoice_number || invId}: ${count} transactions in period`)
  }

  // SUMMARY
  console.log('\n=== SUMMARY ===')
  console.log(`Total in period: ${totalInPeriod}`)
  console.log(`Matched to JPHS-0001: ${matchedToJphs0001}`)
  console.log(`Matched to other invoices: ${otherInvoice}`)
  console.log(`Unmatched: ${unmatchedInPeriod}`)
  console.log(`Sum: ${matchedToJphs0001 + otherInvoice + unmatchedInPeriod}`)

  // Check if periods overlap
  console.log('\n=== OVERLAPPING PERIODS CHECK ===')
  const { data: allInvoices } = await supabase
    .from('invoices_jetpack')
    .select('invoice_number, period_start, period_end')
    .like('invoice_number', 'JPHS%')
    .order('period_start')
    .limit(10)

  console.log('First 10 Henson invoices:')
  allInvoices?.forEach(inv => {
    console.log(`  ${inv.invoice_number}: ${inv.period_start?.slice(0,10)} to ${inv.period_end?.slice(0,10)}`)
  })
}

check().catch(console.error)
