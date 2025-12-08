/**
 * Invoice-based Reconciliation
 *
 * Reconciles transactions against invoices using invoice_id matching,
 * NOT date ranges. This is the correct approach per user requirements.
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fee to invoice type mapping (must match fee-invoice-mapping.ts)
const FEE_TO_INVOICE_TYPE = {
  'Shipping': 'Shipping',
  'Address Correction': 'Shipping',
  'Per Pick Fee': 'AdditionalFee',
  'B2B - Case Pick Fee': 'AdditionalFee',
  'B2B - Each Pick Fee': 'AdditionalFee',
  'B2B - Order Fee': 'AdditionalFee',
  'B2B - Label Fee': 'AdditionalFee',
  'B2B - Pallet Material Charge': 'AdditionalFee',
  'B2B - Pallet Pack Fee': 'AdditionalFee',
  'B2B - Supplies': 'AdditionalFee',
  'B2B - ShipBob Freight Fee': 'AdditionalFee',
  'VAS - Paid Requests': 'AdditionalFee',
  'Inventory Placement Program Fee': 'AdditionalFee',
  'WRO Label Fee': 'AdditionalFee',
  'Kitting Fee': 'AdditionalFee',
  'Credit Card Processing Fee': 'AdditionalFee',
  'Warehousing Fee': 'WarehouseStorage',
  'URO Storage Fee': 'WarehouseStorage',
  'WRO Receiving Fee': 'WarehouseInboundFee',
  'Return to sender - Processing Fees': 'ReturnsFee',
  'Return Processed by Operations Fee': 'ReturnsFee',
  'Return Label': 'ReturnsFee',
  'Credit': 'Credits',
  'Payment': 'Payment',
}

function getInvoiceType(fee) {
  if (!fee) return 'AdditionalFee'
  return FEE_TO_INVOICE_TYPE[fee] || 'AdditionalFee'
}

async function main() {
  console.log('='.repeat(70))
  console.log('INVOICE-BASED RECONCILIATION')
  console.log('='.repeat(70))

  // Check actual invoice_id_sb population
  const { count: total } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  const { count: withInvoiceId } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('invoice_id_sb', 'is', null)

  const { count: invoicedTrue } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('invoiced_status_sb', true)

  console.log('\nTransaction invoice status:')
  console.log('  Total transactions:', total)
  console.log('  With invoice_id_sb:', withInvoiceId)
  console.log('  invoiced_status_sb = true:', invoicedTrue)

  // Get distinct invoice IDs from transactions
  const { data: invoiceIdRows } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .not('invoice_id_sb', 'is', null)

  const uniqueInvoiceIds = [...new Set(invoiceIdRows?.map(r => r.invoice_id_sb) || [])]
  console.log('  Unique invoice IDs in transactions:', uniqueInvoiceIds.length)
  console.log('  Sample:', uniqueInvoiceIds.slice(0, 10).join(', '))

  // Get all invoices from invoices_sb
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('*')
    .order('invoice_date', { ascending: false })

  console.log('\n' + '='.repeat(70))
  console.log('INVOICE RECONCILIATION RESULTS')
  console.log('='.repeat(70))

  let perfectMatches = 0
  let totalDiscrepancy = 0
  const discrepancies = []

  for (const invoice of (invoices || [])) {
    const invoiceId = invoice.shipbob_invoice_id

    // Get all transactions for this invoice
    const { data: txForInvoice } = await supabase
      .from('transactions')
      .select('*')
      .eq('invoice_id_sb', invoiceId)

    const txCount = txForInvoice?.length || 0
    const txTotal = (txForInvoice || []).reduce((sum, tx) => sum + Number(tx.amount), 0)
    const invoiceAmount = Number(invoice.base_amount)
    const diff = txTotal - invoiceAmount

    if (Math.abs(diff) < 0.01) {
      perfectMatches++
    } else {
      discrepancies.push({
        invoiceId,
        type: invoice.invoice_type,
        date: invoice.invoice_date,
        period: `${invoice.period_start} to ${invoice.period_end}`,
        invoiceAmount,
        txTotal,
        txCount,
        diff
      })
      totalDiscrepancy += diff
    }
  }

  console.log(`\nTotal invoices: ${invoices?.length || 0}`)
  console.log(`Perfect matches: ${perfectMatches}`)
  console.log(`With discrepancies: ${discrepancies.length}`)
  console.log(`Total discrepancy: $${totalDiscrepancy.toFixed(2)}`)

  if (discrepancies.length > 0) {
    console.log('\n' + '='.repeat(70))
    console.log('INVOICES WITH DISCREPANCIES')
    console.log('='.repeat(70))

    // Sort by absolute discrepancy
    discrepancies.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))

    for (const d of discrepancies.slice(0, 20)) {
      const diffStr = d.diff > 0 ? `+$${d.diff.toFixed(2)}` : `-$${Math.abs(d.diff).toFixed(2)}`
      console.log(`\nInvoice ${d.invoiceId} (${d.type}) - ${d.date}`)
      console.log(`  Period: ${d.period}`)
      console.log(`  Invoice amount: $${d.invoiceAmount.toFixed(2)}`)
      console.log(`  Transaction sum: $${d.txTotal.toFixed(2)} (${d.txCount} tx)`)
      console.log(`  Difference: ${diffStr}`)

      // If tx count is 0, that's the problem
      if (d.txCount === 0) {
        console.log('  ⚠️  NO TRANSACTIONS LINKED TO THIS INVOICE')
      }
    }
  }

  // Detailed analysis of one discrepancy
  if (discrepancies.length > 0) {
    const sample = discrepancies.find(d => d.txCount > 0) || discrepancies[0]

    console.log('\n' + '='.repeat(70))
    console.log(`DETAILED ANALYSIS: Invoice ${sample.invoiceId}`)
    console.log('='.repeat(70))

    const { data: sampleTx } = await supabase
      .from('transactions')
      .select('*')
      .eq('invoice_id_sb', sample.invoiceId)

    if (sampleTx && sampleTx.length > 0) {
      // Group by fee type
      const byFee = {}
      for (const tx of sampleTx) {
        const fee = tx.transaction_fee || 'NULL'
        if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
        byFee[fee].count++
        byFee[fee].total += Number(tx.amount)
      }

      console.log('\nTransaction breakdown by fee type:')
      for (const [fee, data] of Object.entries(byFee).sort((a, b) => b[1].total - a[1].total)) {
        const invType = getInvoiceType(fee === 'NULL' ? null : fee)
        console.log(`  ${fee.padEnd(35)} -> ${invType.padEnd(20)} ${String(data.count).padStart(4)} tx  $${data.total.toFixed(2)}`)
      }
    }
  }

  // Check for invoices with NO transactions
  const invoicesWithNoTx = []
  for (const invoice of (invoices || [])) {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id_sb', invoice.shipbob_invoice_id)

    if (count === 0) {
      invoicesWithNoTx.push(invoice)
    }
  }

  if (invoicesWithNoTx.length > 0) {
    console.log('\n' + '='.repeat(70))
    console.log('INVOICES WITH NO LINKED TRANSACTIONS')
    console.log('='.repeat(70))
    console.log(`Count: ${invoicesWithNoTx.length}`)

    for (const inv of invoicesWithNoTx.slice(0, 10)) {
      console.log(`  ${inv.shipbob_invoice_id} | ${inv.invoice_type} | ${inv.invoice_date} | $${Number(inv.base_amount).toFixed(2)}`)
    }
  }
}

main().catch(console.error)
