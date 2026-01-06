import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchMarkupRules,
  findMatchingRule,
  ruleMatchesContext,
  countRuleConditions,
  type MarkupRule,
  type TransactionContext,
  type BillingCategory,
} from '@/lib/billing/markup-engine'

interface LineItem {
  id?: string
  description?: string
  feeType?: string
  billingTable?: string
  baseAmount?: number
  billedAmount?: number
  markupApplied?: number
  markupPercentage?: number
  markupRuleId?: string | null
  surcharge?: number
  insurance?: number
  insuranceCost?: number
  taxAmount?: number
  lineCategory?: string
  referenceId?: string
  transactionId?: string
  orderNumber?: string
  shipOptionId?: string | null
  orderCategory?: string | null
  weightOz?: number
}

interface VerificationIssue {
  type: 'markup_math_error' | 'billed_math_error' | 'wrong_markup_rule' | 'missing_markup' | 'total_mismatch'
  severity: 'error' | 'warning'
  message: string
  lineItem?: LineItem
  details?: Record<string, unknown>
}

interface CategoryTotals {
  category: string
  count: number
  baseCost: number
  surcharge: number
  markupApplied: number
  taxAmount: number
  billedAmount: number
  effectiveMarkupPct: number
}

interface InvoiceVerification {
  invoiceId: string
  invoiceNumber: string
  clientName: string
  clientId: string
  periodStart: string
  periodEnd: string
  invoiceTotal: number
  lineItemCount: number
  categoryTotals: CategoryTotals[]
  issues: VerificationIssue[]
  passed: boolean
  summary: {
    totalBaseCost: number
    totalMarkup: number
    totalTax: number
    totalBilled: number
    calculatedTotal: number
  }
}

/**
 * Map billingTable to BillingCategory for markup engine
 */
function billingTableToCategory(billingTable: string): BillingCategory {
  const mapping: Record<string, BillingCategory> = {
    'billing_shipments': 'shipments',
    'billing_shipment_fees': 'shipment_fees',
    'billing_storage': 'storage',
    'billing_returns': 'returns',
    'billing_receiving': 'receiving',
    'billing_credits': 'credits',
  }
  return mapping[billingTable] || 'shipments'
}

/**
 * Build a TransactionContext from a line item for markup engine matching
 */
function buildContext(lineItem: LineItem, clientId: string, transactionDate: Date): TransactionContext {
  return {
    clientId,
    transactionDate,
    feeType: lineItem.feeType || 'Standard',
    billingCategory: billingTableToCategory(lineItem.billingTable || ''),
    orderCategory: lineItem.orderCategory || null,
    shipOptionId: lineItem.shipOptionId || null,
    weightOz: lineItem.weightOz,
  }
}

/**
 * Verify markup calculations for a single line item using the ACTUAL markup engine logic
 */
function verifyLineItemMarkup(
  lineItem: LineItem,
  rules: MarkupRule[],
  clientId: string,
  transactionDate: Date
): VerificationIssue[] {
  const issues: VerificationIssue[] = []

  // Skip credits - they pass through without markup
  if (lineItem.billingTable === 'billing_credits' || (lineItem.baseAmount || 0) < 0) {
    return issues
  }

  const baseAmount = lineItem.baseAmount || 0
  const billedAmount = lineItem.billedAmount || 0
  const markupApplied = lineItem.markupApplied || 0
  const markupPercentage = lineItem.markupPercentage || 0
  const surcharge = lineItem.surcharge || 0
  const insurance = lineItem.insurance || lineItem.insuranceCost || 0

  // Skip zero-cost items
  if (baseAmount === 0) return issues

  // 1. Verify markup math: markupApplied should equal baseAmount × markupPercentage
  if (markupPercentage > 0) {
    // Insurance may also be marked up
    const markupBase = insurance > 0 ? baseAmount + insurance : baseAmount
    const expectedMarkup = Math.round(markupBase * markupPercentage * 100) / 100

    // Allow 2 cents tolerance for floating point rounding
    if (Math.abs(expectedMarkup - markupApplied) > 0.02) {
      issues.push({
        type: 'markup_math_error',
        severity: 'error',
        message: `Markup calculation wrong: ${markupBase.toFixed(2)} × ${(markupPercentage * 100).toFixed(1)}% = ${expectedMarkup.toFixed(2)}, but got ${markupApplied.toFixed(2)}`,
        lineItem,
        details: { markupBase, markupPercentage, expectedMarkup, actualMarkup: markupApplied }
      })
    }
  }

  // 2. Verify billed amount math: billedAmount = baseAmount + surcharge + insurance + markupApplied
  const expectedBilled = Math.round((baseAmount + surcharge + insurance + markupApplied) * 100) / 100
  if (Math.abs(expectedBilled - billedAmount) > 0.02) {
    issues.push({
      type: 'billed_math_error',
      severity: 'error',
      message: `Billed amount wrong: ${baseAmount.toFixed(2)} + ${surcharge.toFixed(2)} + ${insurance.toFixed(2)} + ${markupApplied.toFixed(2)} = ${expectedBilled.toFixed(2)}, but got ${billedAmount.toFixed(2)}`,
      lineItem,
      details: { baseAmount, surcharge, insurance, markupApplied, expectedBilled, actualBilled: billedAmount }
    })
  }

  // 3. Verify correct markup rule was applied - using the ACTUAL markup engine logic
  // NOTE: We can only do this check if we have the full context (shipOptionId, etc.)
  // If shipOptionId is missing from line_items_json, we can't determine which rule should apply
  // because some rules are ship_option-specific (e.g., Ship 146 = 18%, others = 14%)
  const context = buildContext(lineItem, clientId, transactionDate)
  const expectedRule = findMatchingRule(rules, context)

  // Only check rule matching if we have shipOptionId context OR if the billing category
  // doesn't use ship_option_id rules (like storage, returns, receiving, etc.)
  const canVerifyRule = lineItem.shipOptionId != null ||
    (lineItem.billingTable && !['billing_shipments'].includes(lineItem.billingTable))

  if (expectedRule && canVerifyRule) {
    const expectedPct = expectedRule.markup_value / 100 // Convert from percentage to decimal

    // Check if the applied markup percentage matches the expected rule
    if (markupPercentage > 0 && Math.abs(markupPercentage - expectedPct) > 0.001) {
      // This is a real mismatch - the invoice was generated with a different rule
      issues.push({
        type: 'wrong_markup_rule',
        severity: 'warning',
        message: `Markup rule mismatch: Applied ${(markupPercentage * 100).toFixed(1)}% but rule "${expectedRule.name}" (${countRuleConditions(expectedRule)} conditions) says ${expectedRule.markup_value}%`,
        lineItem,
        details: {
          appliedPct: markupPercentage * 100,
          expectedPct: expectedRule.markup_value,
          ruleName: expectedRule.name,
          ruleId: expectedRule.id,
          shipOptionId: lineItem.shipOptionId,
          ruleShipOptionId: expectedRule.ship_option_id,
          conditionCount: countRuleConditions(expectedRule)
        }
      })
    }

    // Check if markup was supposed to be applied but wasn't
    if (markupPercentage === 0 && expectedRule.markup_value > 0) {
      issues.push({
        type: 'missing_markup',
        severity: 'error',
        message: `No markup applied but rule "${expectedRule.name}" (${expectedRule.markup_value}%) should apply`,
        lineItem,
        details: { expectedRule: expectedRule.name, expectedPct: expectedRule.markup_value }
      })
    }
  }

  return issues
}

/**
 * Verify an entire invoice's markup calculations
 */
async function verifyInvoiceMarkups(
  invoice: {
    id: string
    invoice_number: string
    client_id: string
    period_start: string
    period_end: string
    total_amount: number
    line_items_json: LineItem[]
  },
  clientName: string
): Promise<InvoiceVerification> {
  const issues: VerificationIssue[] = []
  const lineItems = invoice.line_items_json || []

  // Use the invoice period start as the transaction date for rule matching
  const transactionDate = new Date(invoice.period_start)

  // Fetch markup rules using the ACTUAL markup engine function
  let markupRules: MarkupRule[] = []
  try {
    markupRules = await fetchMarkupRules(invoice.client_id, transactionDate)
  } catch (error) {
    issues.push({
      type: 'missing_markup',
      severity: 'error',
      message: `Failed to fetch markup rules: ${error instanceof Error ? error.message : 'Unknown error'}`
    })
  }

  // Aggregate by category
  const categoryMap: Record<string, CategoryTotals> = {}
  let totalBaseCost = 0
  let totalMarkup = 0
  let totalTax = 0
  let totalBilled = 0

  // Verify each line item
  for (const item of lineItems) {
    const itemIssues = verifyLineItemMarkup(item, markupRules, invoice.client_id, transactionDate)
    issues.push(...itemIssues)

    // Aggregate by category
    const category = item.lineCategory || 'Unknown'
    if (!categoryMap[category]) {
      categoryMap[category] = {
        category,
        count: 0,
        baseCost: 0,
        surcharge: 0,
        markupApplied: 0,
        taxAmount: 0,
        billedAmount: 0,
        effectiveMarkupPct: 0
      }
    }

    const cat = categoryMap[category]
    cat.count++
    cat.baseCost += item.baseAmount || 0
    cat.surcharge += item.surcharge || 0
    cat.markupApplied += item.markupApplied || 0
    cat.taxAmount += item.taxAmount || 0
    cat.billedAmount += item.billedAmount || 0

    totalBaseCost += item.baseAmount || 0
    totalMarkup += item.markupApplied || 0
    totalTax += item.taxAmount || 0
    totalBilled += item.billedAmount || 0
  }

  // Calculate effective markup percentages
  const categoryTotals = Object.values(categoryMap).map(cat => ({
    ...cat,
    baseCost: Math.round(cat.baseCost * 100) / 100,
    surcharge: Math.round(cat.surcharge * 100) / 100,
    markupApplied: Math.round(cat.markupApplied * 100) / 100,
    taxAmount: Math.round(cat.taxAmount * 100) / 100,
    billedAmount: Math.round(cat.billedAmount * 100) / 100,
    effectiveMarkupPct: cat.baseCost > 0 ? Math.round((cat.markupApplied / cat.baseCost) * 1000) / 10 : 0
  }))

  // Sort by category name
  categoryTotals.sort((a, b) => a.category.localeCompare(b.category))

  // Verify invoice total matches calculated total
  const calculatedTotal = Math.round((totalBilled + totalTax) * 100) / 100
  const invoiceTotal = invoice.total_amount

  if (Math.abs(calculatedTotal - invoiceTotal) > 0.02) {
    issues.push({
      type: 'total_mismatch',
      severity: 'error',
      message: `Invoice total ($${invoiceTotal.toFixed(2)}) doesn't match calculated ($${calculatedTotal.toFixed(2)})`,
      details: { invoiceTotal, calculatedTotal, difference: invoiceTotal - calculatedTotal }
    })
  }

  // Only errors count as failed (warnings are ok)
  const hasErrors = issues.some(i => i.severity === 'error')

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    clientName,
    clientId: invoice.client_id,
    periodStart: invoice.period_start,
    periodEnd: invoice.period_end,
    invoiceTotal: invoice.total_amount,
    lineItemCount: lineItems.length,
    categoryTotals,
    issues,
    passed: !hasErrors,
    summary: {
      totalBaseCost: Math.round(totalBaseCost * 100) / 100,
      totalMarkup: Math.round(totalMarkup * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      totalBilled: Math.round(totalBilled * 100) / 100,
      calculatedTotal
    }
  }
}

// GET /api/admin/invoices/verify - Verify markup calculations for draft invoices
export async function GET(request: NextRequest) {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Get invoice ID from query params (optional - if not provided, verify all drafts)
    const searchParams = request.nextUrl.searchParams
    const invoiceId = searchParams.get('invoiceId')

    // Build query
    let query = adminClient
      .from('invoices_jetpack')
      .select('id, invoice_number, client_id, period_start, period_end, total_amount, line_items_json, clients(company_name)')
      .order('created_at', { ascending: false })

    if (invoiceId) {
      query = query.eq('id', invoiceId)
    } else {
      query = query.eq('status', 'draft')
    }

    const { data: invoices, error } = await query

    if (error) {
      console.error('Error fetching invoices:', error)
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: 500 })
    }

    if (!invoices || invoices.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No invoices to verify',
        results: [],
        allPassed: true
      })
    }

    // Verify each invoice
    const results: InvoiceVerification[] = []
    for (const invoice of invoices) {
      const clientName = (invoice.clients as { company_name?: string })?.company_name || 'Unknown'
      const verification = await verifyInvoiceMarkups(
        {
          id: invoice.id,
          invoice_number: invoice.invoice_number,
          client_id: invoice.client_id,
          period_start: invoice.period_start,
          period_end: invoice.period_end,
          total_amount: invoice.total_amount,
          line_items_json: invoice.line_items_json as LineItem[]
        },
        clientName
      )
      results.push(verification)
    }

    const allPassed = results.every(r => r.passed)
    const errorCount = results.filter(r => !r.passed).length
    const warningCount = results.filter(r => r.issues.some(i => i.severity === 'warning')).length
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0)

    return NextResponse.json({
      success: true,
      message: allPassed
        ? `All ${results.length} invoice(s) verified - markup calculations correct`
        : `Found ${totalIssues} issue(s) in ${errorCount} invoice(s)`,
      results,
      allPassed,
      summary: {
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: errorCount,
        withWarnings: warningCount,
        totalIssues
      }
    })
  } catch (error) {
    console.error('Error in invoice verification:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
