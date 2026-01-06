#!/usr/bin/env node
/**
 * Regenerate Draft Invoices
 *
 * Regenerates the line_items_json for draft invoices to fix the
 * incorrect billedAmount values caused by the removed reconciliation logic.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(80))
  console.log('REGENERATING DRAFT INVOICES')
  console.log('='.repeat(80))
  console.log('')

  // Get all draft invoices
  const { data: drafts, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, period_start, period_end, line_items_json, total_amount')
    .eq('status', 'draft')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching drafts:', error)
    return
  }

  console.log(`Found ${drafts.length} draft invoice(s)`)
  console.log('')

  for (const invoice of drafts) {
    console.log('-'.repeat(80))
    console.log(`Invoice: ${invoice.invoice_number}`)
    console.log('-'.repeat(80))

    const lineItems = invoice.line_items_json || []
    let fixedCount = 0
    let totalBilled = 0
    let totalTax = 0

    // Check and fix each line item
    for (const item of lineItems) {
      const baseAmount = item.baseAmount || 0
      const surcharge = item.surcharge || 0
      const insurance = item.insurance || 0
      const markupApplied = item.markupApplied || 0
      const markupPercentage = item.markupPercentage || 0

      // Recalculate correct markup: baseAmount * markupPercentage (not including surcharge)
      // Insurance may also be marked up
      const markupBase = insurance > 0 ? baseAmount + insurance : baseAmount
      const correctMarkup = Math.round(markupBase * markupPercentage * 100) / 100

      // Correct billed amount: base + surcharge + insurance + markup
      const correctBilled = Math.round((baseAmount + surcharge + insurance + correctMarkup) * 100) / 100

      // Check if values are wrong
      if (Math.abs(item.markupApplied - correctMarkup) > 0.01 ||
          Math.abs(item.billedAmount - correctBilled) > 0.01) {
        console.log(`  FIX: ${item.description || item.feeType}`)
        console.log(`       markupApplied: ${item.markupApplied} → ${correctMarkup}`)
        console.log(`       billedAmount:  ${item.billedAmount} → ${correctBilled}`)

        item.markupApplied = correctMarkup
        item.billedAmount = correctBilled
        fixedCount++
      }

      // Also ensure totalCharge matches billedAmount
      if (item.totalCharge !== undefined) {
        item.totalCharge = item.billedAmount
      }

      totalBilled += item.billedAmount || 0
      totalTax += item.taxAmount || 0
    }

    if (fixedCount === 0) {
      console.log('  No corrections needed - all line items are correct')
    } else {
      console.log(`  Fixed ${fixedCount} line item(s)`)

      // Calculate new total
      const newTotal = Math.round((totalBilled + totalTax) * 100) / 100

      console.log(`  New total: $${newTotal} (was $${invoice.total_amount})`)

      // Update the invoice
      const { error: updateError } = await supabase
        .from('invoices_jetpack')
        .update({
          line_items_json: lineItems,
          total_amount: newTotal,
        })
        .eq('id', invoice.id)

      if (updateError) {
        console.error(`  ERROR updating invoice:`, updateError)
      } else {
        console.log(`  ✅ Invoice updated successfully`)
      }
    }

    console.log('')
  }

  console.log('='.repeat(80))
  console.log('Done!')
  console.log('='.repeat(80))
}

main().catch(console.error)
