#!/usr/bin/env node
/**
 * Find ShipBob invoice numbers for the JPHS-0037 week
 *
 * Key insight: Each invoice type has its own invoice_id_sb, but they share
 * the same first 3 digits for a given week.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Finding ALL ShipBob invoice IDs for Henson (wider range)...\n')

  // Get ALL distinct ShipBob invoice IDs for Henson over a wider range
  // to understand the invoice ID patterns
  const { data: invoices } = await supabase
    .from('transactions')
    .select('invoice_id_sb, transaction_fee, reference_type, charge_date')
    .eq('client_id', hensonId)
    .gte('charge_date', '2025-11-01')
    .lte('charge_date', '2025-12-05')
    .not('invoice_id_sb', 'is', null)

  // Group by invoice_id with date ranges
  const byInvoice = {}
  for (const t of invoices || []) {
    const inv = t.invoice_id_sb
    if (!byInvoice[inv]) {
      byInvoice[inv] = {
        total: 0,
        feeTypes: {},
        refTypes: {},
        dates: [],
        prefix: String(inv).substring(0, 3)
      }
    }
    byInvoice[inv].total++
    byInvoice[inv].feeTypes[t.transaction_fee] = (byInvoice[inv].feeTypes[t.transaction_fee] || 0) + 1
    byInvoice[inv].refTypes[t.reference_type] = (byInvoice[inv].refTypes[t.reference_type] || 0) + 1
    byInvoice[inv].dates.push(t.charge_date)
  }

  // Calculate min/max dates for each invoice
  for (const inv of Object.keys(byInvoice)) {
    const dates = byInvoice[inv].dates.sort()
    byInvoice[inv].minDate = dates[0]
    byInvoice[inv].maxDate = dates[dates.length - 1]
    delete byInvoice[inv].dates // Clean up
  }

  // Group invoices by prefix
  const byPrefix = {}
  for (const [inv, data] of Object.entries(byInvoice)) {
    const prefix = data.prefix
    if (!byPrefix[prefix]) {
      byPrefix[prefix] = []
    }
    byPrefix[prefix].push({ id: inv, ...data })
  }

  console.log('='.repeat(70))
  console.log('INVOICE IDs GROUPED BY PREFIX (first 3 digits)')
  console.log('='.repeat(70))

  // Sort prefixes and show grouped
  const sortedPrefixes = Object.keys(byPrefix).sort((a, b) => Number(b) - Number(a))

  for (const prefix of sortedPrefixes) {
    const invoices = byPrefix[prefix]
    const totalTx = invoices.reduce((sum, inv) => sum + inv.total, 0)
    const allDates = invoices.map(inv => [inv.minDate, inv.maxDate]).flat()
    allDates.sort()
    const weekStart = allDates[0]
    const weekEnd = allDates[allDates.length - 1]

    console.log(`\n${'='.repeat(70)}`)
    console.log(`PREFIX ${prefix}xxx: ${totalTx} total transactions`)
    console.log(`Date range: ${weekStart} to ${weekEnd}`)
    console.log('='.repeat(70))

    // Sort invoices in this prefix group
    invoices.sort((a, b) => Number(b.id) - Number(a.id))

    for (const inv of invoices) {
      const primaryFee = Object.entries(inv.feeTypes).sort((a, b) => b[1] - a[1])[0]
      const primaryRef = Object.entries(inv.refTypes).sort((a, b) => b[1] - a[1])[0]
      console.log(`\n  Invoice ${inv.id}: ${inv.total} transactions (${inv.minDate} to ${inv.maxDate})`)
      console.log(`    Primary fee type: ${primaryFee[0]} (${primaryFee[1]})`)
      console.log(`    Primary ref type: ${primaryRef[0]} (${primaryRef[1]})`)

      // Show all fee types
      console.log('    All fee types:')
      for (const [fee, count] of Object.entries(inv.feeTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`      ${fee}: ${count}`)
      }
    }

    // Summary totals for this week by category
    console.log(`\n  WEEK TOTALS (prefix ${prefix}):`)
    const weekTotals = { Shipping: 0, AdditionalServices: 0, Returns: 0, Receiving: 0, Storage: 0, Credits: 0 }

    for (const inv of invoices) {
      for (const [fee, count] of Object.entries(inv.feeTypes)) {
        if (fee === 'Shipping') weekTotals.Shipping += count
        else if (fee === 'Credit') weekTotals.Credits += count
        else if (fee === 'Storage') weekTotals.Storage += count
        else if (fee === 'WRO Receiving Fee') weekTotals.Receiving += count
        else if (['Return Processed by Operations Fee', 'Return Label', 'Return to sender - Processing Fees'].includes(fee)) weekTotals.Returns += count
        else weekTotals.AdditionalServices += count
      }
    }

    console.log(`    Shipping: ${weekTotals.Shipping}`)
    console.log(`    Additional Services: ${weekTotals.AdditionalServices}`)
    console.log(`    Returns: ${weekTotals.Returns}`)
    console.log(`    Receiving: ${weekTotals.Receiving}`)
    console.log(`    Storage: ${weekTotals.Storage}`)
    console.log(`    Credits: ${weekTotals.Credits}`)
  }

  // Reference counts for JPHS-0037:
  console.log('\n' + '='.repeat(70))
  console.log('REFERENCE TOTALS FOR JPHS-0037 (target to match):')
  console.log('='.repeat(70))
  console.log('  Shipments (Shipping): 1,436')
  console.log('  Additional Services: 1,113')
  console.log('  Returns: 4')
  console.log('  Receiving: 1')
  console.log('  Storage: 982')
  console.log('  Credits: 12')
  console.log('\nLook for the prefix whose week totals match these!')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
