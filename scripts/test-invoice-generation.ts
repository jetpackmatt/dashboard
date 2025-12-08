/**
 * Test Invoice Generation Script
 *
 * Generates a test invoice for Henson using the transactions table
 * and invoice_id_sb matching (not date ranges).
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Fee type to invoice category mapping
const FEE_TO_CATEGORY: Record<string, string> = {
  'Shipping': 'Shipping',
  'Address Correction': 'Shipping',
  'Per Pick Fee': 'Pick Fees',
  'B2B - Case Pick Fee': 'B2B Fees',
  'B2B - Each Pick Fee': 'B2B Fees',
  'B2B - Order Fee': 'B2B Fees',
  'B2B - Label Fee': 'B2B Fees',
  'B2B - Pallet Material Charge': 'B2B Fees',
  'B2B - Pallet Pack Fee': 'B2B Fees',
  'B2B - Supplies': 'B2B Fees',
  'B2B - ShipBob Freight Fee': 'B2B Fees',
  'VAS - Paid Requests': 'Additional Services',
  'Inventory Placement Program Fee': 'Additional Services',
  'WRO Label Fee': 'Additional Services',
  'Kitting Fee': 'Additional Services',
  'Credit Card Processing Fee': 'Additional Services',
  'Warehousing Fee': 'Storage',
  'URO Storage Fee': 'Storage',
  'WRO Receiving Fee': 'Receiving',
  'Return to sender - Processing Fees': 'Returns',
  'Return Processed by Operations Fee': 'Returns',
  'Return Label': 'Returns',
  'Credit': 'Credits',
  'Payment': 'Payment',
}

function getCategory(feeType: string | null): string {
  if (!feeType) return 'Other'
  return FEE_TO_CATEGORY[feeType] || 'Other'
}

interface MarkupRule {
  id: string
  client_id: string | null
  name: string
  fee_type: string | null
  markup_type: 'percentage' | 'fixed'
  markup_value: number
  is_active: boolean
}

interface Transaction {
  id: string
  transaction_fee: string | null
  amount: number
  reference_id: string | null
  charge_date: string | null
  invoice_id_sb: string | null
}

interface InvoiceLineItem {
  category: string
  feeType: string
  count: number
  baseAmount: number
  markupPct: number
  markupAmount: number
  billedAmount: number
}

async function main() {
  console.log('='.repeat(70))
  console.log('HENSON TEST INVOICE GENERATION')
  console.log('='.repeat(70))

  // 1. Get Henson client info
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number')
    .ilike('company_name', '%henson%')
    .single()

  if (!henson) {
    console.error('Could not find Henson client')
    process.exit(1)
  }

  console.log('\nClient:', henson.company_name)
  console.log('Next Invoice #:', henson.next_invoice_number)

  // 2. Get invoice IDs for Dec 1 (last week's invoices)
  // Exclude Payment type - those are just payment records
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, invoice_date, base_amount, period_start, period_end')
    .eq('invoice_date', '2025-12-01')
    .neq('invoice_type', 'Payment')
    .order('invoice_type')

  console.log('\n2. SHIPBOB INVOICES FOR DEC 1:')
  for (const inv of invoices || []) {
    console.log(`  ${inv.shipbob_invoice_id} | ${inv.invoice_type.padEnd(20)} | $${Number(inv.base_amount).toFixed(2)}`)
  }

  const invoiceIds = (invoices || []).map(i => i.shipbob_invoice_id)
  const periodStart = invoices?.[0]?.period_start || '2025-11-24'
  const periodEnd = invoices?.[0]?.period_end || '2025-11-30'

  // 3. Get markup rules for Henson
  const { data: rules } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .or(`client_id.is.null,client_id.eq.${henson.id}`)
    .order('client_id', { ascending: true })

  console.log('\n3. MARKUP RULES:')
  for (const r of rules || []) {
    const scope = r.client_id ? 'Henson' : 'Global'
    console.log(`  ${scope}: ${r.fee_type || 'ALL'} -> ${r.markup_type} ${r.markup_value}${r.markup_type === 'percentage' ? '%' : ''}`)
  }

  // Build a lookup: client-specific rules override global
  const markupLookup: Record<string, MarkupRule> = {}
  for (const r of rules || []) {
    const key = r.fee_type || '_default'
    // Client-specific rules override global
    if (r.client_id === henson.id || !markupLookup[key]) {
      markupLookup[key] = r
    }
  }

  // 4. Fetch all transactions for these invoices (paginated)
  console.log('\n4. FETCHING HENSON TRANSACTIONS...')

  let allTx: Transaction[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data } = await supabase
      .from('transactions')
      .select('id, transaction_fee, amount, reference_id, charge_date, invoice_id_sb')
      .eq('client_id', henson.id)
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + pageSize - 1)
      .order('id')

    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < pageSize) break
  }

  console.log(`  Fetched ${allTx.length} transactions`)

  // 5. Apply markups and group by category
  const lineItems: Record<string, InvoiceLineItem> = {}

  for (const tx of allTx) {
    const feeType = tx.transaction_fee || 'Other'
    const category = getCategory(tx.transaction_fee)
    const key = `${category}|${feeType}`

    if (!lineItems[key]) {
      lineItems[key] = {
        category,
        feeType,
        count: 0,
        baseAmount: 0,
        markupPct: 0,
        markupAmount: 0,
        billedAmount: 0,
      }
    }

    const item = lineItems[key]
    const baseAmount = Number(tx.amount)

    // Find matching markup rule
    const rule = markupLookup[feeType] || markupLookup['Standard'] || markupLookup['_default']
    let markupPct = 0
    let markupAmount = 0

    if (rule) {
      if (rule.markup_type === 'percentage') {
        markupPct = rule.markup_value
        markupAmount = baseAmount * (markupPct / 100)
      } else {
        markupAmount = rule.markup_value
        markupPct = baseAmount !== 0 ? (markupAmount / baseAmount) * 100 : 0
      }
    }

    item.count++
    item.baseAmount += baseAmount
    item.markupPct = markupPct // Same for all in category
    item.markupAmount += markupAmount
    item.billedAmount += baseAmount + markupAmount
  }

  // 6. Display invoice summary
  console.log('\n' + '='.repeat(70))
  console.log('INVOICE SUMMARY')
  console.log('='.repeat(70))
  console.log(`Invoice #: JP${henson.short_code}-${String(henson.next_invoice_number).padStart(4, '0')}-120125`)
  console.log(`Period: ${periodStart} to ${periodEnd}`)
  console.log(`Client: ${henson.company_name}`)
  console.log()

  // Group by category
  const byCategory: Record<string, InvoiceLineItem[]> = {}
  for (const item of Object.values(lineItems)) {
    if (!byCategory[item.category]) byCategory[item.category] = []
    byCategory[item.category].push(item)
  }

  let totalBase = 0
  let totalMarkup = 0
  let totalBilled = 0

  // Print by category
  const categoryOrder = ['Shipping', 'Pick Fees', 'B2B Fees', 'Storage', 'Receiving', 'Returns', 'Credits', 'Additional Services', 'Other']

  for (const cat of categoryOrder) {
    const items = byCategory[cat]
    if (!items || items.length === 0) continue

    console.log(`\n${cat.toUpperCase()}`)
    console.log('-'.repeat(70))
    console.log('Fee Type'.padEnd(35) + 'Count'.padStart(6) + 'Base Cost'.padStart(12) + 'Markup %'.padStart(10) + 'Billed'.padStart(12))
    console.log('-'.repeat(70))

    let catBase = 0
    let catMarkup = 0
    let catBilled = 0

    for (const item of items.sort((a, b) => b.baseAmount - a.baseAmount)) {
      console.log(
        item.feeType.substring(0, 34).padEnd(35) +
        String(item.count).padStart(6) +
        ('$' + item.baseAmount.toFixed(2)).padStart(12) +
        (item.markupPct.toFixed(0) + '%').padStart(10) +
        ('$' + item.billedAmount.toFixed(2)).padStart(12)
      )
      catBase += item.baseAmount
      catMarkup += item.markupAmount
      catBilled += item.billedAmount
    }

    console.log('-'.repeat(70))
    console.log(
      'Subtotal'.padEnd(35) +
      ''.padStart(6) +
      ('$' + catBase.toFixed(2)).padStart(12) +
      ''.padStart(10) +
      ('$' + catBilled.toFixed(2)).padStart(12)
    )

    totalBase += catBase
    totalMarkup += catMarkup
    totalBilled += catBilled
  }

  console.log('\n' + '='.repeat(70))
  console.log('TOTALS'.padEnd(35) + ''.padStart(6) + ('$' + totalBase.toFixed(2)).padStart(12) + ''.padStart(10) + ('$' + totalBilled.toFixed(2)).padStart(12))
  console.log('Markup Amount:'.padEnd(53) + ('$' + totalMarkup.toFixed(2)).padStart(12))
  console.log('='.repeat(70))

  // Compare to ShipBob invoice totals
  console.log('\n7. COMPARISON TO SHIPBOB INVOICES:')
  const sbTotal = (invoices || []).reduce((sum, inv) => sum + Number(inv.base_amount), 0)
  console.log(`  ShipBob invoice total: $${sbTotal.toFixed(2)}`)
  console.log(`  Our base amount total: $${totalBase.toFixed(2)}`)
  console.log(`  Difference: $${(totalBase - sbTotal).toFixed(2)}`)
  console.log(`  Match: ${Math.abs(totalBase - sbTotal) < 0.01 ? 'YES' : 'NO (see note)'}`)

  if (Math.abs(totalBase - sbTotal) >= 0.01) {
    console.log('\n  Note: Difference may be due to:')
    console.log('  - Transactions from other Jetpack clients on same invoice')
    console.log('  - Payment records excluded from invoice IDs')
  }
}

main().catch(console.error)
