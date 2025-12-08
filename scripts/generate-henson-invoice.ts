/**
 * Generate Henson Invoice for Nov 24-30, 2025
 *
 * Uses transactions table as source of truth with markup engine
 * Generates both PDF and XLSX outputs
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { generatePDFInvoice } from '../lib/billing/pdf-generator'
import type { InvoiceData, InvoiceLineItem } from '../lib/billing/invoice-generator'
import type { JetpackInvoice, LineCategory } from '../lib/billing/types'
import * as fs from 'fs'
import * as path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ShipBob invoice IDs for Nov 24-30 (from invoices_sb)
const INVOICE_IDS = ['8633634', '8633641', '8633637', '8633612', '8633632', '8633618']

// Map transaction_fee to billing category (for markup engine)
const FEE_TO_CATEGORY: Record<string, string> = {
  'Shipping': 'shipments',
  'Address Correction': 'shipments',
  'Per Pick Fee': 'shipment_fees',
  'B2B - Label Fee': 'shipment_fees',
  'B2B - Each Pick Fee': 'shipment_fees',
  'B2B - Case Pick Fee': 'shipment_fees',
  'B2B - Order Fee': 'shipment_fees',
  'B2B - Supplies': 'shipment_fees',
  'B2B - Pallet Pack Fee': 'shipment_fees',
  'B2B - Pallet Material Charge': 'shipment_fees',
  'B2B - ShipBob Freight Fee': 'shipment_fees',
  'VAS - Paid Requests': 'shipment_fees',
  'Kitting Fee': 'shipment_fees',
  'Inventory Placement Program Fee': 'shipment_fees',
  'Warehousing Fee': 'storage',
  'URO Storage Fee': 'storage',
  'Credit': 'credits',
  'Return to sender - Processing Fees': 'returns',
  'Return Processed by Operations Fee': 'returns',
  'Return Label': 'returns',
  'WRO Receiving Fee': 'receiving',
  'WRO Label Fee': 'receiving',
}

// Invoice display categories (for PDF grouping)
const FEE_TO_LINE_CATEGORY: Record<string, LineCategory> = {
  'Shipping': 'Shipping',
  'Address Correction': 'Shipping',
  'Per Pick Fee': 'Pick Fees',
  'B2B - Label Fee': 'B2B Fees',
  'B2B - Each Pick Fee': 'B2B Fees',
  'B2B - Case Pick Fee': 'B2B Fees',
  'B2B - Order Fee': 'B2B Fees',
  'B2B - Supplies': 'B2B Fees',
  'B2B - Pallet Pack Fee': 'B2B Fees',
  'B2B - Pallet Material Charge': 'B2B Fees',
  'B2B - ShipBob Freight Fee': 'B2B Fees',
  'VAS - Paid Requests': 'Additional Services',
  'Kitting Fee': 'Additional Services',
  'Inventory Placement Program Fee': 'Additional Services',
  'Warehousing Fee': 'Storage',
  'URO Storage Fee': 'Storage',
  'Credit': 'Credits',
  'Return to sender - Processing Fees': 'Returns',
  'Return Processed by Operations Fee': 'Returns',
  'Return Label': 'Returns',
  'WRO Receiving Fee': 'Receiving',
  'WRO Label Fee': 'Receiving',
}

interface MarkupRule {
  id: string
  client_id: string | null
  name: string
  fee_type: string | null
  ship_option_id: string | null
  billing_category: string | null
  order_category: string | null
  conditions: { weight_min_oz?: number; weight_max_oz?: number } | null
  markup_type: 'percentage' | 'fixed'
  markup_value: number
  is_active: boolean
}

async function main() {
  console.log('=' .repeat(70))
  console.log('GENERATING HENSON INVOICE - Nov 24-30, 2025')
  console.log('=' .repeat(70))

  // Get Henson client
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_email')
    .ilike('company_name', '%henson%')
    .single()

  if (!henson) {
    console.error('Henson client not found')
    return
  }

  console.log(`\nClient: ${henson.company_name}`)
  console.log(`Short Code: ${henson.short_code}`)
  console.log(`Next Invoice #: ${henson.next_invoice_number}`)

  // Get markup rules for Henson
  const { data: rules } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .or(`client_id.is.null,client_id.eq.${henson.id}`)

  console.log(`\nMarkup Rules Loaded: ${rules?.length || 0}`)
  for (const r of rules || []) {
    console.log(`  - ${r.name}: ${r.billing_category}/${r.fee_type} → ${r.markup_value}% (ship_option: ${r.ship_option_id || 'any'})`)
  }

  // Build shipment lookup for ship_option_id
  console.log('\nBuilding shipment lookup...')
  const shipmentLookup = new Map<string, { ship_option_id: number | null }>()
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('shipments')
      .select('shipment_id, ship_option_id')
      .range(offset, offset + 999)

    if (error || !data || data.length === 0) break
    for (const s of data) {
      shipmentLookup.set(s.shipment_id, { ship_option_id: s.ship_option_id })
    }
    offset += data.length
    if (data.length < 1000) break
  }
  console.log(`Shipment lookup size: ${shipmentLookup.size}`)

  // Fetch all transactions for this invoice period
  console.log('\nFetching transactions by invoice_id_sb...')
  const allTransactions: Array<{
    id: string
    transaction_fee: string | null
    amount: number | null
    reference_type: string | null
    reference_id: string | null
    charge_date: string | null
  }> = []
  offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, transaction_fee, amount, reference_type, reference_id, charge_date')
      .eq('client_id', henson.id)
      .in('invoice_id_sb', INVOICE_IDS)
      .range(offset, offset + 999)

    if (error || !data || data.length === 0) break
    allTransactions.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }
  console.log(`Transactions loaded: ${allTransactions.length}`)

  // Process transactions and apply markups
  const lineItems: InvoiceLineItem[] = []
  const byCategory: Record<LineCategory, { count: number; subtotal: number; markup: number; total: number }> = {
    'Fulfillment': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Shipping': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Pick Fees': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'B2B Fees': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Storage': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Returns': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Receiving': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Credits': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Additional Services': { count: 0, subtotal: 0, markup: 0, total: 0 },
  }

  for (const tx of allTransactions) {
    const baseAmount = Number(tx.amount) || 0
    const transactionFee = tx.transaction_fee || 'Unknown'
    const billingCategory = FEE_TO_CATEGORY[transactionFee] || 'shipment_fees'
    const lineCategory = FEE_TO_LINE_CATEGORY[transactionFee] || 'Additional Services'

    // For Shipping transactions, look up ship_option_id from shipments
    let shipOptionId: number | null = null
    if (billingCategory === 'shipments' && tx.reference_type === 'Shipment' && tx.reference_id) {
      const shipInfo = shipmentLookup.get(tx.reference_id)
      if (shipInfo) {
        shipOptionId = shipInfo.ship_option_id
      }
    }

    // Determine fee_type for markup matching
    const feeType = billingCategory === 'shipments' ? 'Standard' : transactionFee

    // Find matching markup rule
    const matchingRule = findMatchingRule(rules || [], {
      clientId: henson.id,
      billingCategory,
      feeType,
      shipOptionId,
    })

    // Calculate markup
    let markupAmount = 0
    let markupPercentage = 0
    if (matchingRule && matchingRule.markup_type === 'percentage') {
      markupAmount = baseAmount * (matchingRule.markup_value / 100)
      markupPercentage = matchingRule.markup_value
    } else if (matchingRule && matchingRule.markup_type === 'fixed') {
      markupAmount = matchingRule.markup_value
      markupPercentage = baseAmount !== 0 ? (markupAmount / baseAmount) * 100 : 0
    }

    const billedAmount = Math.round((baseAmount + markupAmount) * 100) / 100

    lineItems.push({
      id: tx.id,
      billingTable: 'transactions',
      billingRecordId: tx.id,
      baseAmount,
      markupApplied: Math.round(markupAmount * 100) / 100,
      billedAmount,
      markupRuleId: matchingRule?.id || null,
      markupPercentage: Math.round(markupPercentage * 100) / 100,
      lineCategory,
      description: transactionFee,
      transactionDate: tx.charge_date || new Date().toISOString(),
      feeType,
    })

    // Aggregate by category
    const cat = byCategory[lineCategory]
    if (cat) {
      cat.count++
      cat.subtotal += baseAmount
      cat.markup += markupAmount
      cat.total += billedAmount
    }
  }

  // Calculate totals
  const subtotal = lineItems.reduce((sum, i) => sum + i.baseAmount, 0)
  const totalMarkup = lineItems.reduce((sum, i) => sum + i.markupApplied, 0)
  const totalAmount = lineItems.reduce((sum, i) => sum + i.billedAmount, 0)

  // Round all category values
  for (const cat of Object.values(byCategory)) {
    cat.subtotal = Math.round(cat.subtotal * 100) / 100
    cat.markup = Math.round(cat.markup * 100) / 100
    cat.total = Math.round(cat.total * 100) / 100
  }

  // Build invoice number: JP{SHORT_CODE}-{NNNN}-{MMDDYY}
  const invoiceNumber = `JP${henson.short_code}-${String(henson.next_invoice_number).padStart(4, '0')}-120825`

  console.log('\n' + '=' .repeat(70))
  console.log('INVOICE SUMMARY')
  console.log('=' .repeat(70))
  console.log(`Invoice Number: ${invoiceNumber}`)
  console.log(`Period: Nov 24 - Nov 30, 2025`)
  console.log(`Transactions: ${lineItems.length}`)
  console.log(`\nSubtotal (Base): $${subtotal.toFixed(2)}`)
  console.log(`Total Markup: $${totalMarkup.toFixed(2)}`)
  console.log(`Total Amount: $${totalAmount.toFixed(2)}`)
  console.log(`\nEffective Markup: ${(totalMarkup / subtotal * 100).toFixed(2)}%`)

  // Build InvoiceData for PDF
  const invoice: JetpackInvoice = {
    id: 'preview-' + Date.now(),
    client_id: henson.id,
    invoice_number: invoiceNumber,
    period_start: '2025-11-24',
    period_end: '2025-11-30',
    invoice_date: '2025-12-08',
    due_date: '2025-12-08',
    base_amount: subtotal,
    markup_amount: totalMarkup,
    total_amount: totalAmount,
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    xlsx_path: null,
    pdf_path: null,
    approved_by: null,
    approved_at: null,
    notes: null,
    shipbob_invoice_ids: INVOICE_IDS,
    invoice_type: 'weekly',
    generated_at: new Date().toISOString(),
  }

  const invoiceData: InvoiceData = {
    invoice,
    client: {
      id: henson.id,
      company_name: henson.company_name,
      short_code: henson.short_code,
      billing_email: henson.billing_email,
      billing_terms: 'upon_receipt',
    },
    lineItems,
    summary: {
      subtotal: Math.round(subtotal * 100) / 100,
      totalMarkup: Math.round(totalMarkup * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
      byCategory,
    },
  }

  // Generate PDF
  console.log('\nGenerating PDF...')
  try {
    const pdfBuffer = await generatePDFInvoice(invoiceData, {
      currency: 'USD',
    })

    // Save to output directory
    const outputDir = path.join(process.cwd(), 'scripts', 'output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    const pdfPath = path.join(outputDir, `${invoiceNumber}.pdf`)
    fs.writeFileSync(pdfPath, pdfBuffer)
    console.log(`PDF saved to: ${pdfPath}`)
  } catch (error) {
    console.error('PDF generation failed:', error)
  }

  console.log('\nDone!')
}

/**
 * Find the best matching markup rule (most conditions wins)
 */
function findMatchingRule(
  rules: MarkupRule[],
  context: {
    clientId: string
    billingCategory: string
    feeType: string
    shipOptionId: number | null
  }
): MarkupRule | null {
  const matching = rules.filter(rule => {
    // Client match
    if (rule.client_id !== null && rule.client_id !== context.clientId) {
      return false
    }

    // Billing category match
    if (rule.billing_category && rule.billing_category !== context.billingCategory) {
      return false
    }

    // Fee type match
    if (rule.fee_type && rule.fee_type !== context.feeType) {
      return false
    }

    // Ship option match (convert to string for comparison)
    if (rule.ship_option_id && String(rule.ship_option_id) !== String(context.shipOptionId)) {
      return false
    }

    return true
  })

  if (matching.length === 0) return null

  // Sort by specificity (count conditions) - most specific wins
  matching.sort((a, b) => countConditions(b) - countConditions(a))

  return matching[0]
}

function countConditions(rule: MarkupRule): number {
  let count = 0
  if (rule.client_id !== null) count++
  if (rule.ship_option_id) count++
  if (rule.conditions?.weight_min_oz !== undefined || rule.conditions?.weight_max_oz !== undefined) count++
  return count
}

main().catch(console.error)
