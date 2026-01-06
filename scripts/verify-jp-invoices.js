#!/usr/bin/env node
/**
 * Jetpack Invoice Verification Script
 *
 * Verifies that generated Jetpack invoices have correct markup calculations
 * by cross-checking line items against markup rules.
 *
 * Usage:
 *   node scripts/verify-jp-invoices.js                    # Verify latest draft invoices
 *   node scripts/verify-jp-invoices.js --invoice JPHS-0041-122925  # Verify specific invoice
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

/**
 * Get markup rules for a client
 */
async function getMarkupRules(clientId) {
  const { data: rules } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)

  return rules || []
}

/**
 * Find the expected markup for a line item
 */
function findExpectedMarkup(lineItem, rules) {
  // Filter rules by fee_type and billing_category
  const matchingRules = rules.filter(rule => {
    // Match by fee_type
    if (rule.fee_type && rule.fee_type !== lineItem.feeType) return false
    // Match by billing_category (maps to billingTable in line items)
    if (rule.billing_category) {
      const categoryMap = {
        'shipments': 'billing_shipments',
        'shipment_fees': 'billing_shipment_fees',
        'storage': 'billing_storage',
        'returns': 'billing_returns',
        'receiving': 'billing_receiving',
        'credits': 'billing_credits',
      }
      if (categoryMap[rule.billing_category] !== lineItem.billingTable) return false
    }
    return true
  })

  if (matchingRules.length === 0) return null

  // Return the most specific match (highest priority or most conditions)
  return matchingRules.sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
}

/**
 * Verify markup calculation for a line item
 *
 * For Shipping items, the formula is:
 *   billedAmount = baseAmount + surcharge + markupApplied
 *   markupApplied = baseAmount × markupPercentage
 *   (surcharges are pass-through, not marked up)
 *
 * For other items:
 *   billedAmount = baseAmount + markupApplied
 *   markupApplied = baseAmount × markupPercentage
 */
function verifyLineItem(lineItem, rules) {
  const issues = []

  // Skip credits - they often pass through without markup
  if (lineItem.billingTable === 'billing_credits' || lineItem.baseAmount < 0) {
    return { passed: true, issues }
  }

  const baseAmount = lineItem.baseAmount || 0
  const billedAmount = lineItem.billedAmount || 0
  const markupApplied = lineItem.markupApplied || 0
  const markupPercentage = lineItem.markupPercentage || 0
  const surcharge = lineItem.surcharge || 0  // Shipping surcharges (pass-through)
  const insurance = lineItem.insurance || 0  // Insurance (may be marked up)

  // Calculate expected billed amount
  // For shipping: base + surcharge + markup (surcharge is pass-through)
  // For other: base + markup
  const expectedBilled = Math.round((baseAmount + surcharge + insurance + markupApplied) * 100) / 100
  if (Math.abs(expectedBilled - billedAmount) > 0.02) {
    const formula = surcharge > 0 || insurance > 0
      ? `${baseAmount} + ${surcharge} + ${insurance} + ${markupApplied}`
      : `${baseAmount} + ${markupApplied}`
    issues.push({
      type: 'math_error',
      message: `Math mismatch: ${formula} = ${expectedBilled}, but billedAmount = ${billedAmount}`,
      lineItem
    })
  }

  // Verify markup percentage: markupApplied should equal baseAmount * markupPercentage
  // Note: For shipping, only base_cost is marked up (not surcharge)
  // NOTE: Small discrepancies (up to ~$1) are expected due to Excel-style rounding reconciliation
  // The invoice generator adjusts the largest item in each markup group to ensure category totals
  // match what Excel's "formula on totals" approach would produce.
  if (baseAmount > 0 && markupPercentage > 0) {
    // Insurance may also be marked up - account for that
    const markupBase = insurance > 0 ? baseAmount + insurance : baseAmount
    const expectedMarkup = Math.round(markupBase * markupPercentage * 100) / 100
    // Use $1.50 tolerance to account for Excel-style rounding reconciliation on largest items
    // (larger groups may have bigger cumulative rounding differences)
    if (Math.abs(expectedMarkup - markupApplied) > 1.50) {
      issues.push({
        type: 'percentage_error',
        message: `Markup mismatch: ${markupBase} × ${(markupPercentage * 100).toFixed(2)}% = ${expectedMarkup}, but markupApplied = ${markupApplied}`,
        lineItem
      })
    }
  }

  // Check if markup rule was applied
  if (baseAmount > 0 && !lineItem.markupRuleId && markupPercentage === 0) {
    const expectedRule = findExpectedMarkup(lineItem, rules)
    if (expectedRule) {
      issues.push({
        type: 'missing_markup',
        message: `No markup applied, but rule "${expectedRule.name}" (${expectedRule.markup_value}%) should apply`,
        lineItem,
        expectedRule
      })
    }
  }

  return {
    passed: issues.length === 0,
    issues
  }
}

/**
 * Verify an invoice
 */
async function verifyInvoice(invoice, rules) {
  const lineItems = invoice.line_items_json || []
  const allIssues = []

  // Category totals for summary
  const categoryTotals = {}

  for (const item of lineItems) {
    const result = verifyLineItem(item, rules)
    if (!result.passed) {
      allIssues.push(...result.issues)
    }

    // Aggregate by lineCategory
    const cat = item.lineCategory || 'Unknown'
    if (!categoryTotals[cat]) {
      categoryTotals[cat] = { count: 0, base: 0, surcharge: 0, insurance: 0, markup: 0, tax: 0, billed: 0 }
    }
    categoryTotals[cat].count++
    categoryTotals[cat].base += item.baseAmount || 0
    categoryTotals[cat].surcharge += item.surcharge || 0
    categoryTotals[cat].insurance += item.insurance || 0
    categoryTotals[cat].markup += item.markupApplied || 0
    categoryTotals[cat].tax += item.taxAmount || 0
    categoryTotals[cat].billed += item.billedAmount || 0
  }

  return {
    invoiceNumber: invoice.invoice_number,
    clientId: invoice.client_id,
    totalAmount: invoice.total_amount,
    lineItemCount: lineItems.length,
    categoryTotals,
    issues: allIssues,
    passed: allIssues.length === 0
  }
}

async function main() {
  const args = process.argv.slice(2)
  let invoiceNumber = null

  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--invoice' && args[i + 1]) {
      invoiceNumber = args[i + 1]
      i++
    }
  }

  console.log('='.repeat(80))
  console.log('JETPACK INVOICE VERIFICATION REPORT')
  console.log('='.repeat(80))
  console.log('')

  // Get invoices
  let query = supabase
    .from('invoices_jetpack')
    .select('*, clients(company_name)')
    .order('created_at', { ascending: false })

  if (invoiceNumber) {
    query = query.eq('invoice_number', invoiceNumber)
  } else {
    // Default: get latest draft invoices
    query = query.eq('status', 'draft').limit(10)
  }

  const { data: invoices, error } = await query

  if (error) {
    console.error('Error fetching invoices:', error)
    return
  }

  if (!invoices || invoices.length === 0) {
    console.log('No invoices found')
    return
  }

  console.log(`Found ${invoices.length} invoice(s) to verify`)
  console.log('')

  let allPassed = true

  for (const invoice of invoices) {
    const clientName = invoice.clients?.company_name || 'Unknown'

    // Get markup rules for this client
    const rules = await getMarkupRules(invoice.client_id)

    // Verify the invoice
    const result = await verifyInvoice(invoice, rules)

    console.log('-'.repeat(80))
    console.log(`Invoice: ${invoice.invoice_number} (${clientName})`)
    console.log(`Status: ${invoice.status} | Total: $${parseFloat(invoice.total_amount).toFixed(2)}`)
    console.log('-'.repeat(80))
    console.log('')

    // Category breakdown
    console.log('CATEGORY BREAKDOWN:')
    console.log('  ' + 'Category'.padEnd(25) + 'Count'.padStart(8) + 'Base Cost'.padStart(14) + 'Surcharge'.padStart(12) + 'Markup'.padStart(12) + 'Tax'.padStart(10) + 'Billed'.padStart(14) + 'Markup %'.padStart(10))
    console.log('  ' + '-'.repeat(105))

    let totalBase = 0
    let totalSurcharge = 0
    let totalMarkup = 0
    let totalTax = 0
    let totalBilled = 0

    for (const [cat, totals] of Object.entries(result.categoryTotals)) {
      const markupPct = totals.base > 0 ? ((totals.markup / totals.base) * 100).toFixed(1) : '-'
      console.log('  ' +
        cat.padEnd(25) +
        String(totals.count).padStart(8) +
        ('$' + totals.base.toFixed(2)).padStart(14) +
        ('$' + totals.surcharge.toFixed(2)).padStart(12) +
        ('$' + totals.markup.toFixed(2)).padStart(12) +
        ('$' + totals.tax.toFixed(2)).padStart(10) +
        ('$' + totals.billed.toFixed(2)).padStart(14) +
        (markupPct + '%').padStart(10)
      )
      totalBase += totals.base
      totalSurcharge += totals.surcharge
      totalMarkup += totals.markup
      totalTax += totals.tax
      totalBilled += totals.billed
    }

    console.log('  ' + '-'.repeat(105))
    const overallPct = totalBase > 0 ? ((totalMarkup / totalBase) * 100).toFixed(1) : '-'
    console.log('  ' +
      'TOTAL'.padEnd(25) +
      String(result.lineItemCount).padStart(8) +
      ('$' + totalBase.toFixed(2)).padStart(14) +
      ('$' + totalSurcharge.toFixed(2)).padStart(12) +
      ('$' + totalMarkup.toFixed(2)).padStart(12) +
      ('$' + totalTax.toFixed(2)).padStart(10) +
      ('$' + totalBilled.toFixed(2)).padStart(14) +
      (overallPct + '%').padStart(10)
    )

    // Show invoice total with tax
    const grandTotal = totalBilled + totalTax
    console.log('')
    console.log(`  Grand Total (incl. tax): $${grandTotal.toFixed(2)}`)
    console.log('')

    // Verify total matches (invoice total includes tax)
    const invoiceTotal = parseFloat(invoice.total_amount)
    if (Math.abs(grandTotal - invoiceTotal) > 0.02) {
      console.log(`  ⚠️  Invoice total ($${invoiceTotal.toFixed(2)}) doesn't match calculated grand total ($${grandTotal.toFixed(2)})`)
      allPassed = false
    } else {
      console.log(`  ✅ Invoice total matches: $${invoiceTotal.toFixed(2)}`)
    }

    // Show issues
    if (result.issues.length > 0) {
      allPassed = false
      console.log('ISSUES FOUND:')
      for (const issue of result.issues.slice(0, 10)) {
        console.log(`  ⚠️  ${issue.type}: ${issue.message}`)
      }
      if (result.issues.length > 10) {
        console.log(`  ... and ${result.issues.length - 10} more issues`)
      }
      console.log('')
    } else {
      console.log('  ✅ All markup calculations verified!')
    }

    // Show markup rules used
    console.log('')
    console.log('MARKUP RULES AVAILABLE:')
    for (const rule of rules.slice(0, 8)) {
      console.log(`  - ${rule.name || rule.fee_type}: ${rule.markup_value}% (${rule.billing_category || 'all'})`)
    }
    if (rules.length > 8) {
      console.log(`  ... and ${rules.length - 8} more rules`)
    }

    console.log('')
  }

  // Final summary
  console.log('='.repeat(80))
  console.log('VERIFICATION SUMMARY')
  console.log('='.repeat(80))
  console.log('')

  if (allPassed) {
    console.log('✅ All invoices verified successfully!')
  } else {
    console.log('⚠️  Some issues found - review above before approving')
  }
}

main().catch(console.error)
