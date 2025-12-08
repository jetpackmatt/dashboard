#!/usr/bin/env node
/**
 * Investigate storage transactions for invoice 8633618
 * to understand why we have 969 vs 981 (reference) rows
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const storageInvoiceId = 8633618

  console.log('='.repeat(70))
  console.log('INVESTIGATING STORAGE TRANSACTIONS FOR INVOICE 8633618')
  console.log('='.repeat(70))

  // Get all storage transactions for this invoice
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', hensonId)
    .eq('invoice_id_sb', storageInvoiceId)

  if (error) {
    console.log('Error:', error.message)
    return
  }

  console.log('\nTotal transactions found:', txns.length)
  console.log('Reference count:', 981)
  console.log('Discrepancy:', 981 - txns.length)

  // Check charge_date distribution
  const byChargeDate = {}
  for (const tx of txns) {
    const date = tx.charge_date?.substring(0, 10) || 'null'
    byChargeDate[date] = (byChargeDate[date] || 0) + 1
  }

  console.log('\n--- CHARGE_DATE DISTRIBUTION ---')
  for (const [date, count] of Object.entries(byChargeDate).sort()) {
    console.log(`  ${date}: ${count}`)
  }

  // Check if additional_details has any date fields
  console.log('\n--- ADDITIONAL_DETAILS DATE FIELDS (first 10 txns) ---')
  const sample = txns.slice(0, 10)
  for (const tx of sample) {
    const details = tx.additional_details || {}
    console.log(`  TX ${tx.id}:`)
    console.log(`    charge_date: ${tx.charge_date}`)
    console.log(`    additional_details keys: ${Object.keys(details).join(', ')}`)
    // Look for any date-like values
    for (const [key, value] of Object.entries(details)) {
      if (typeof value === 'string' && value.match(/\d{4}-\d{2}-\d{2}/)) {
        console.log(`    ${key}: ${value}`)
      }
    }
  }

  // Check reference_id patterns
  console.log('\n--- REFERENCE_ID PATTERNS (sample 20) ---')
  const refPatterns = {}
  for (const tx of txns) {
    const pattern = tx.reference_id?.replace(/\d+/g, '#') || 'null'
    refPatterns[pattern] = (refPatterns[pattern] || 0) + 1
  }
  for (const [pattern, count] of Object.entries(refPatterns).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${pattern}: ${count}`)
  }

  // Check if there are other storage invoices from same period
  console.log('\n--- OTHER STORAGE INVOICES AROUND 8633xxx ---')
  const { data: otherStorage } = await supabase
    .from('transactions')
    .select('invoice_id_sb, charge_date, transaction_fee, reference_type')
    .eq('client_id', hensonId)
    .in('transaction_fee', ['Warehousing Fee', 'Storage'])
    .gte('invoice_id_sb', 8630000)
    .lte('invoice_id_sb', 8640000)
    .neq('invoice_id_sb', storageInvoiceId)
    .limit(100)

  const otherByInvoice = {}
  for (const tx of otherStorage || []) {
    if (!otherByInvoice[tx.invoice_id_sb]) {
      otherByInvoice[tx.invoice_id_sb] = { count: 0, dates: new Set() }
    }
    otherByInvoice[tx.invoice_id_sb].count++
    otherByInvoice[tx.invoice_id_sb].dates.add(tx.charge_date?.substring(0, 10))
  }

  for (const [inv, info] of Object.entries(otherByInvoice).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  Invoice ${inv}: ${info.count} rows, dates: ${[...info.dates].sort().join(', ')}`)
  }

  // Check the previous week's storage invoice (should be 8595xxx or similar)
  console.log('\n--- LOOKING FOR PREVIOUS WEEK STORAGE INVOICES ---')
  const { data: prevWeekStorage } = await supabase
    .from('transactions')
    .select('invoice_id_sb, charge_date, transaction_fee')
    .eq('client_id', hensonId)
    .eq('transaction_fee', 'Warehousing Fee')
    .gte('charge_date', '2025-11-16')
    .lt('charge_date', '2025-11-24')
    .limit(100)

  const prevByInvoice = {}
  for (const tx of prevWeekStorage || []) {
    if (!prevByInvoice[tx.invoice_id_sb]) {
      prevByInvoice[tx.invoice_id_sb] = { count: 0, dates: new Set() }
    }
    prevByInvoice[tx.invoice_id_sb].count++
    prevByInvoice[tx.invoice_id_sb].dates.add(tx.charge_date?.substring(0, 10))
  }

  console.log('Storage invoices with charge_date in Nov 16-23:')
  for (const [inv, info] of Object.entries(prevByInvoice).sort((a, b) => Number(b[0]) - Number(a[0]))) {
    console.log(`  Invoice ${inv}: ${info.count} rows, dates: ${[...info.dates].sort().join(', ')}`)
  }

  // Check reference file format - what date field does it use?
  console.log('\n--- TRANSACTION_FEE DISTRIBUTION ---')
  const byFee = {}
  for (const tx of txns) {
    byFee[tx.transaction_fee] = (byFee[tx.transaction_fee] || 0) + 1
  }
  for (const [fee, count] of Object.entries(byFee).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fee}: ${count}`)
  }

  // Check for duplicate reference_ids
  console.log('\n--- CHECKING FOR DUPLICATE REFERENCE_IDS ---')
  const refCounts = {}
  for (const tx of txns) {
    refCounts[tx.reference_id] = (refCounts[tx.reference_id] || 0) + 1
  }
  const duplicates = Object.entries(refCounts).filter(([_, c]) => c > 1)
  console.log(`Unique reference_ids: ${Object.keys(refCounts).length}`)
  console.log(`Duplicate reference_ids: ${duplicates.length}`)
  if (duplicates.length > 0) {
    console.log('Sample duplicates:', duplicates.slice(0, 5))
  }

  // Sample some actual transactions
  console.log('\n--- SAMPLE TRANSACTIONS ---')
  const samples = txns.slice(0, 5)
  for (const tx of samples) {
    console.log(JSON.stringify({
      id: tx.id,
      reference_id: tx.reference_id,
      reference_type: tx.reference_type,
      transaction_fee: tx.transaction_fee,
      charge_date: tx.charge_date,
      cost: tx.cost,
      additional_details: tx.additional_details
    }, null, 2))
    console.log('')
  }
}

main().catch(console.error)
