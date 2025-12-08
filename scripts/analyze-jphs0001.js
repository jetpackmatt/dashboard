/**
 * Analyze JPHS-0001 matching in detail
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  // Get JPHS-0001 XLS shipping rows
  const xlsPath = path.join(process.cwd(), 'reference/invoices-historical/INVOICE-DETAILS-JPHS-0001-0302425.xlsx')
  const workbook = XLSX.readFile(xlsPath)
  const sheet = workbook.Sheets[workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))]
  const rows = XLSX.utils.sheet_to_json(sheet)

  const xlsOrderIds = new Set()
  rows.forEach(row => {
    const orderId = String(row['OrderID'] || '')
    if (orderId && orderId !== 'undefined') {
      xlsOrderIds.add(orderId)
    }
  })

  console.log('XLS JPHS-0001 unique OrderIDs:', xlsOrderIds.size)
  console.log('Sample OrderIDs from XLS:', [...xlsOrderIds].slice(0, 5))

  // Count DB transactions with Shipping type in the period
  const { data: jphs0001 } = await supabase
    .from('invoices_jetpack')
    .select('id, period_start, period_end')
    .eq('invoice_number', 'JPHS-0001-032425')
    .single()

  console.log('\nJPHS-0001 period:', jphs0001.period_start.slice(0, 10), 'to', jphs0001.period_end.slice(0, 10))

  // How many Shipping transactions total in period?
  const { count: totalShipping } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('transaction_fee', 'Shipping')
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  console.log('Total Shipping in JPHS-0001 period:', totalShipping)

  // How many matched to JPHS-0001?
  const { count: matchedJphs0001 } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('invoice_id_jp', jphs0001.id)
    .eq('transaction_fee', 'Shipping')

  console.log('Matched to JPHS-0001:', matchedJphs0001)

  // How many matched to other invoices?
  const { count: matchedOther } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('transaction_fee', 'Shipping')
    .not('invoice_id_jp', 'is', null)
    .neq('invoice_id_jp', jphs0001.id)
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  console.log('Matched to OTHER invoices (same dates):', matchedOther)

  // How many unmatched?
  const { count: unmatched } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('transaction_fee', 'Shipping')
    .is('invoice_id_jp', null)
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))

  console.log('Unmatched in period:', unmatched)
  console.log('Sum:', matchedJphs0001 + matchedOther + unmatched)

  // Get sample unmatched reference_ids
  const { data: unmatchedSample } = await supabase
    .from('transactions')
    .select('reference_id')
    .eq('transaction_fee', 'Shipping')
    .is('invoice_id_jp', null)
    .gte('charge_date', jphs0001.period_start.slice(0, 10))
    .lte('charge_date', jphs0001.period_end.slice(0, 10))
    .limit(20)

  console.log('\nSample unmatched reference_ids:', unmatchedSample?.map(t => t.reference_id))

  // Are these in XLS?
  const sampleIds = unmatchedSample?.map(t => t.reference_id) || []
  const inXls = sampleIds.filter(id => xlsOrderIds.has(id))
  const notInXls = sampleIds.filter(id => !xlsOrderIds.has(id))

  console.log('\nOf sample unmatched:')
  console.log('  In XLS:', inXls.length, inXls)
  console.log('  NOT in XLS:', notInXls.length, notInXls)

  // Check what invoice matched the "in XLS" ones
  if (inXls.length > 0) {
    console.log('\n=== TRANSACTIONS THAT ARE IN XLS BUT NOT MATCHED ===')
    const { data: inXlsTxs } = await supabase
      .from('transactions')
      .select('reference_id, invoice_id_jp, charge_date')
      .eq('transaction_fee', 'Shipping')
      .in('reference_id', inXls)

    console.log('Details:', inXlsTxs)
  }
}

check().catch(console.error)
