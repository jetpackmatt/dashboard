#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const eliId = 'f47f90e4-5108-47e2-96a8-c24c1c54721e'

  // Henson storage linked to invoice 8730389
  const { data: hensonLinked } = await supabase
    .from('transactions')
    .select('id, cost')
    .eq('client_id', hensonId)
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  console.log('Henson FC with invoice 8730389:', hensonLinked?.length || 0)
  if (hensonLinked) {
    const total = hensonLinked.reduce((sum, tx) => sum + parseFloat(tx.cost || 0), 0)
    console.log('  Total:', total.toFixed(2))
  }

  // Henson storage with NULL invoice (Dec 1-15)
  const { data: hensonNull } = await supabase
    .from('transactions')
    .select('id, cost')
    .eq('client_id', hensonId)
    .eq('reference_type', 'FC')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-01')
    .lte('charge_date', '2025-12-15')

  console.log('Henson FC NULL invoice (Dec 1-15):', hensonNull?.length || 0)
  if (hensonNull) {
    const total = hensonNull.reduce((sum, tx) => sum + parseFloat(tx.cost || 0), 0)
    console.log('  Total:', total.toFixed(2))
  }

  // Eli Health storage linked to invoice 8730389
  const { data: eliLinked } = await supabase
    .from('transactions')
    .select('id, cost')
    .eq('client_id', eliId)
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  console.log('\nEli Health FC with invoice 8730389:', eliLinked?.length || 0)
  if (eliLinked) {
    const total = eliLinked.reduce((sum, tx) => sum + parseFloat(tx.cost || 0), 0)
    console.log('  Total:', total.toFixed(2))
  }

  // Eli Health storage with NULL invoice (Dec 1-15)
  const { data: eliNull } = await supabase
    .from('transactions')
    .select('id, cost')
    .eq('client_id', eliId)
    .eq('reference_type', 'FC')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-01')
    .lte('charge_date', '2025-12-15')

  console.log('Eli Health FC NULL invoice (Dec 1-15):', eliNull?.length || 0)
  if (eliNull) {
    const total = eliNull.reduce((sum, tx) => sum + parseFloat(tx.cost || 0), 0)
    console.log('  Total:', total.toFixed(2))
  }

  // Check pending invoices
  const { data: pendingInv } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, period_start, period_end')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  console.log('\nPending ShipBob invoices:')
  for (const inv of pendingInv || []) {
    console.log(' ', inv.shipbob_invoice_id, inv.invoice_type,
      inv.period_start?.split('T')[0], '-', inv.period_end?.split('T')[0])
  }

  // Check ALL Eli Health FC transactions regardless of date/invoice
  const { data: allEliFc } = await supabase
    .from('transactions')
    .select('id, cost, charge_date, invoice_id_sb')
    .eq('client_id', eliId)
    .eq('reference_type', 'FC')
    .order('charge_date', { ascending: false })
    .limit(20)

  console.log('\nEli Health recent FC transactions:')
  for (const tx of allEliFc || []) {
    console.log(' ', tx.charge_date?.split('T')[0], 'cost:', tx.cost, 'invoice:', tx.invoice_id_sb)
  }

  // Check Henson FC charge date distribution for invoice 8730389
  const { data: hensonFcDates } = await supabase
    .from('transactions')
    .select('charge_date, cost')
    .eq('client_id', hensonId)
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  console.log('\nHenson FC charge dates for invoice 8730389:')
  const dateGroups = {}
  for (const tx of hensonFcDates || []) {
    const d = tx.charge_date?.split('T')[0]
    if (!dateGroups[d]) dateGroups[d] = { count: 0, total: 0 }
    dateGroups[d].count++
    dateGroups[d].total += parseFloat(tx.cost || 0)
  }
  for (const [d, g] of Object.entries(dateGroups).sort()) {
    console.log(' ', d, 'count:', g.count, 'total:', g.total.toFixed(2))
  }

  // Check the invoice period for 8730389
  const { data: invoice } = await supabase
    .from('invoices_sb')
    .select('*')
    .eq('shipbob_invoice_id', '8730389')
    .single()

  console.log('\nInvoice 8730389 details:')
  console.log('  period_start:', invoice?.period_start)
  console.log('  period_end:', invoice?.period_end)
  console.log('  base_amount:', invoice?.base_amount)
  console.log('  total_amount:', invoice?.total_amount)

  // Check FC transactions by client_id for this invoice
  const { data: fcByClient } = await supabase
    .from('transactions')
    .select('client_id, cost')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  console.log('\nFC transactions by client_id for invoice 8730389:')
  const clientTotals = {}
  for (const tx of fcByClient || []) {
    const cid = tx.client_id || 'NULL'
    if (!clientTotals[cid]) clientTotals[cid] = { count: 0, total: 0 }
    clientTotals[cid].count++
    clientTotals[cid].total += parseFloat(tx.cost || 0)
  }
  for (const [cid, g] of Object.entries(clientTotals)) {
    console.log(' ', cid, 'count:', g.count, 'total:', g.total.toFixed(2))
  }

  // Look at xlsx to see Eli Health entries
  console.log('\n--- Reading xlsx for merchant breakdown ---')
  const XLSX = require('xlsx')
  const workbook = XLSX.readFile('reference/storage-backfills/storage-122225.xlsx')
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)
  const dataRows = rows.filter(r => r['Inventory ID'] && !isNaN(r['ChargeStartdate']))

  const byMerchant = {}
  for (const row of dataRows) {
    const merchant = row['Merchant Name']
    if (!byMerchant[merchant]) byMerchant[merchant] = { count: 0, total: 0 }
    byMerchant[merchant].count++
    byMerchant[merchant].total += parseFloat(row['TotalCharge'] || 0)
  }
  console.log('xlsx breakdown by merchant:')
  for (const [m, g] of Object.entries(byMerchant)) {
    console.log(' ', m, 'count:', g.count, 'total:', g.total.toFixed(2))
  }

  // Check who is client e6220921-695e-41f9-9f49-af3e0cdc828a
  const mysteryClientId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'
  const { data: mysteryClient } = await supabase
    .from('clients')
    .select('id, company_name')
    .eq('id', mysteryClientId)
    .single()

  console.log('\nMystery client (has $40.68 storage):')
  console.log('  id:', mysteryClient?.id)
  console.log('  name:', mysteryClient?.company_name)

  // Also check all clients in the system
  const { data: allClients } = await supabase
    .from('clients')
    .select('id, company_name')
    .order('company_name')

  console.log('\nAll clients in system:')
  for (const c of allClients || []) {
    console.log(' ', c.id, c.company_name)
  }

  // Now check why Henson is $1091.47 not $1089.73 (diff = $1.74)
  // The diff could be due to transactions from wrong period
  // Invoice period is Dec 15-21, but storage charges cover Dec 1-15
  // Let me check charge_date distribution across ALL clients

  const { data: allFc8730389 } = await supabase
    .from('transactions')
    .select('client_id, charge_date, cost')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  console.log('\nFC transactions in invoice 8730389 - total sum:')
  const totalSum = (allFc8730389 || []).reduce((s, tx) => s + parseFloat(tx.cost || 0), 0)
  console.log('  Total:', totalSum.toFixed(2))
  console.log('  Invoice base_amount:', invoice?.base_amount)
  console.log('  Difference:', (totalSum - parseFloat(invoice?.base_amount || 0)).toFixed(2))

  // Check what was in the xlsx TotalCharge column
  console.log('\nxlsx columns:')
  const sampleRow = dataRows[0]
  console.log('  Columns:', Object.keys(sampleRow).join(', '))
  console.log('  Sample row:', JSON.stringify(sampleRow, null, 2))

  // Sum the correct column from xlsx
  let xlsxTotal = 0
  for (const row of dataRows) {
    // Try different possible column names
    const charge = parseFloat(row['TotalCharge']) || parseFloat(row['Total Charge']) || parseFloat(row['Amount']) || 0
    xlsxTotal += charge
  }
  console.log('  xlsx TotalCharge sum:', xlsxTotal.toFixed(2))

  // Check for FC transactions that might be duplicates or from wrong date
  // The invoice covers Dec 15-21 but FC transactions have charge_date Dec 15
  // which represents storage from Dec 1-15 (billed on Dec 15)

  // Count by charge_date
  const dateDist = {}
  for (const tx of allFc8730389 || []) {
    const d = tx.charge_date?.split('T')[0]
    dateDist[d] = (dateDist[d] || 0) + 1
  }
  console.log('\nFC charge_date distribution for invoice 8730389:')
  for (const [d, count] of Object.entries(dateDist).sort()) {
    console.log(' ', d, count, 'transactions')
  }

  // Check for duplicate reference_ids
  const { data: allFcWithRef } = await supabase
    .from('transactions')
    .select('reference_id, cost')
    .eq('reference_type', 'FC')
    .eq('invoice_id_sb', 8730389)

  const refCounts = {}
  for (const tx of allFcWithRef || []) {
    refCounts[tx.reference_id] = (refCounts[tx.reference_id] || 0) + 1
  }

  const duplicates = Object.entries(refCounts).filter(([_, count]) => count > 1)
  console.log('\nDuplicate reference_ids in invoice 8730389:', duplicates.length)
  if (duplicates.length > 0) {
    console.log('Duplicates:')
    for (const [ref, count] of duplicates.slice(0, 10)) {
      // Find the costs for this ref
      const costs = (allFcWithRef || []).filter(tx => tx.reference_id === ref).map(tx => tx.cost)
      console.log(' ', ref, 'count:', count, 'costs:', costs.join(', '))
    }
  }

  // Let's sum the xlsx "Invoice" column since that might have per-day charges
  console.log('\nxlsx "Invoice" column sum:')
  let invoiceColSum = 0
  for (const row of dataRows) {
    invoiceColSum += parseFloat(row['Invoice']) || 0
  }
  console.log('  Sum of Invoice column:', invoiceColSum.toFixed(2))
  console.log('  (xlsx has', dataRows.length, 'rows)')

  // Sum xlsx Invoice column BY MERCHANT
  console.log('\nxlsx Invoice column by merchant:')
  const byMerchantInvoice = {}
  for (const row of dataRows) {
    const merchant = row['Merchant Name']
    if (!byMerchantInvoice[merchant]) byMerchantInvoice[merchant] = { count: 0, total: 0 }
    byMerchantInvoice[merchant].count++
    byMerchantInvoice[merchant].total += parseFloat(row['Invoice']) || 0
  }
  for (const [m, g] of Object.entries(byMerchantInvoice)) {
    console.log(' ', m, 'count:', g.count, 'total:', g.total.toFixed(2))
  }

  // Compare xlsx vs DB by merchant
  console.log('\n=== COMPARISON ===')
  console.log('Henson:')
  console.log('  xlsx: $' + (byMerchantInvoice['Henson Shaving']?.total || 0).toFixed(2))
  console.log('  DB:   $1091.47')
  console.log('  Diff: $' + (1091.47 - (byMerchantInvoice['Henson Shaving']?.total || 0)).toFixed(2))
  console.log('\nEli Health:')
  console.log('  xlsx: $' + (byMerchantInvoice['Eli Health']?.total || 0).toFixed(2))
  console.log('  DB:   $40.68')
  console.log('  Diff: $' + (40.68 - (byMerchantInvoice['Eli Health']?.total || 0)).toFixed(2))
}

main().catch(console.error)
