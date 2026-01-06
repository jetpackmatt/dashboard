#!/usr/bin/env node
/**
 * Create a NEW draft invoice for Jetpack Demo with CC fee included
 * This tests the full auto-charge flow
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('Creating CC test invoice...\n')

  const clientId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  const invoiceId = 'c3d4e5f6-a7b8-9012-cdef-345678901234'
  const invoiceNumber = 'JPJD-0002-121725'

  // Check if already exists
  const { data: existingInvoice } = await supabase
    .from('invoices_jetpack')
    .select('id')
    .eq('id', invoiceId)
    .single()

  if (existingInvoice) {
    console.log('Test invoice already exists, deleting and recreating...')
    await supabase.from('invoices_jetpack').delete().eq('id', invoiceId)
  }

  // Base line items (simulated shipments)
  const baseLineItems = [
    {
      id: 'cc-test-001',
      feeType: 'Standard',
      surcharge: 0.15,
      baseAmount: 5.60,
      baseCharge: 6.61,
      description: 'Shipment 999100001 - Shipping',
      invoiceIdSb: 9999998,
      orderNumber: '999100001',
      totalCharge: 6.76,
      billedAmount: 6.76,
      billingTable: 'billing_shipments',
      lineCategory: 'Shipping',
      markupRuleId: null,
      insuranceCost: 0,
      markupApplied: 1.01,
      trackingNumber: 'CCTEST123456789',
      billingRecordId: 'cc-test-001',
      insuranceCharge: 0,
      transactionDate: '2025-12-17',
      markupPercentage: 0.18
    },
    {
      id: 'cc-test-002',
      feeType: 'Standard',
      surcharge: 0.15,
      baseAmount: 7.25,
      baseCharge: 8.56,
      description: 'Shipment 999100002 - Shipping',
      invoiceIdSb: 9999998,
      orderNumber: '999100002',
      totalCharge: 8.71,
      billedAmount: 8.71,
      billingTable: 'billing_shipments',
      lineCategory: 'Shipping',
      markupRuleId: null,
      insuranceCost: 0,
      markupApplied: 1.31,
      trackingNumber: 'CCTEST987654321',
      billingRecordId: 'cc-test-002',
      insuranceCharge: 0,
      transactionDate: '2025-12-17',
      markupPercentage: 0.18
    }
  ]

  // Calculate subtotal before CC fee
  const subtotalBeforeFee = baseLineItems.reduce((sum, item) => sum + item.totalCharge, 0)

  // Calculate 3% CC fee
  const ccFeeAmount = Math.round(subtotalBeforeFee * 0.03 * 100) / 100

  // Add CC fee line item
  const ccFeeLineItem = {
    id: `cc-fee-${clientId}-${Date.now()}`,
    billingTable: 'cc_processing_fee',
    billingRecordId: `cc-fee-${clientId}`,
    baseAmount: ccFeeAmount,
    markupApplied: 0,
    billedAmount: ccFeeAmount,
    markupRuleId: null,
    markupPercentage: 0,
    lineCategory: 'Additional Services',
    description: 'Credit Card Processing Fee (3%)',
    feeType: 'Credit Card Processing Fee (3%)',
    transactionDate: '2025-12-17',
    totalCharge: ccFeeAmount
  }

  const lineItems = [...baseLineItems, ccFeeLineItem]

  // Calculate totals
  const subtotal = baseLineItems.reduce((sum, item) => sum + item.baseAmount, 0)
  const totalMarkup = baseLineItems.reduce((sum, item) => sum + item.markupApplied, 0)
  const totalAmount = lineItems.reduce((sum, item) => sum + (item.totalCharge || item.billedAmount), 0)

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .insert({
      id: invoiceId,
      client_id: clientId,
      invoice_number: invoiceNumber,
      invoice_date: '2025-12-17',
      period_start: '2025-12-15',
      period_end: '2025-12-17',
      subtotal: subtotal.toFixed(2),
      total_markup: totalMarkup.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      status: 'draft',
      paid_status: 'unpaid',
      line_items_json: lineItems,
      shipbob_invoice_ids: [9999998],
      version: 1
    })
    .select()
    .single()

  if (invoiceError) {
    console.error('Error creating invoice:', invoiceError)
    process.exit(1)
  }

  console.log('Created CC test invoice:', invoice.invoice_number)
  console.log(`  Subtotal (before CC fee): $${subtotalBeforeFee.toFixed(2)}`)
  console.log(`  CC Fee (3%): $${ccFeeAmount.toFixed(2)}`)
  console.log(`  Total: $${totalAmount.toFixed(2)}`)
  console.log(`  Status: ${invoice.status}`)
  console.log(`  Has CC Fee Line Item: YES`)

  console.log('\n✅ Done! Now go to Admin > Invoicing and approve this invoice.')
  console.log('It should auto-charge the test card!')
}

main().catch(console.error)
