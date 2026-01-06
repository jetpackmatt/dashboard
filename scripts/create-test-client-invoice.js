#!/usr/bin/env node
/**
 * Create a test client "Jetpack Demo" and a fake invoice for testing Stripe CC flow
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('Creating test client and invoice...\n')

  // 1. Create the test client
  const clientId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .single()

  if (existingClient) {
    console.log('Test client already exists, skipping creation')
  } else {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        id: clientId,
        company_name: 'Jetpack Demo',
        short_code: 'JD',
        next_invoice_number: 2,
        payment_method: 'ach',
        billing_email: 'demo@jetpack3pl.com',
        billing_address: {
          street: '123 Test Street',
          city: 'New York',
          state: 'NY',
          zip: '10001'
        },
        is_active: true,
        billing_period: 'weekly',
        billing_terms: 'due_on_receipt'
      })
      .select()
      .single()

    if (clientError) {
      console.error('Error creating client:', clientError)
      process.exit(1)
    }
    console.log('Created test client:', client.company_name)
  }

  // 2. Create a fake invoice with realistic line items
  const invoiceId = 'b2c3d4e5-f6a7-8901-bcde-f23456789012'
  const invoiceNumber = 'JPJD-0001-121725'

  const { data: existingInvoice } = await supabase
    .from('invoices_jetpack')
    .select('id')
    .eq('id', invoiceId)
    .single()

  if (existingInvoice) {
    console.log('Test invoice already exists, skipping creation')
    console.log('\nDone! Test invoice number:', invoiceNumber)
    return
  }

  // Create realistic line items (simplified from a real invoice)
  const lineItems = [
    {
      id: 'test-001',
      feeType: 'Standard',
      surcharge: 0.15,
      baseAmount: 5.60,
      baseCharge: 6.61,
      description: 'Shipment 999000001 - Shipping',
      invoiceIdSb: 9999999,
      orderNumber: '999000001',
      totalCharge: 6.76,
      billedAmount: 6.76,
      billingTable: 'billing_shipments',
      lineCategory: 'Shipping',
      markupRuleId: null,
      insuranceCost: 0,
      markupApplied: 1.01,
      trackingNumber: 'TEST123456789',
      billingRecordId: 'test-001',
      insuranceCharge: 0,
      transactionDate: '2025-12-15',
      markupPercentage: 0.18
    },
    {
      id: 'test-002',
      feeType: 'Standard',
      surcharge: 0.15,
      baseAmount: 7.25,
      baseCharge: 8.56,
      description: 'Shipment 999000002 - Shipping',
      invoiceIdSb: 9999999,
      orderNumber: '999000002',
      totalCharge: 8.71,
      billedAmount: 8.71,
      billingTable: 'billing_shipments',
      lineCategory: 'Shipping',
      markupRuleId: null,
      insuranceCost: 0,
      markupApplied: 1.31,
      trackingNumber: 'TEST987654321',
      billingRecordId: 'test-002',
      insuranceCharge: 0,
      transactionDate: '2025-12-15',
      markupPercentage: 0.18
    },
    {
      id: 'test-003',
      feeType: 'Standard',
      surcharge: 0,
      baseAmount: 3.95,
      baseCharge: 4.50,
      description: 'Shipment 999000003 - Shipping',
      invoiceIdSb: 9999999,
      orderNumber: '999000003',
      totalCharge: 4.50,
      billedAmount: 4.50,
      billingTable: 'billing_shipments',
      lineCategory: 'Shipping',
      markupRuleId: null,
      insuranceCost: 0,
      markupApplied: 0.55,
      trackingNumber: 'TEST111222333',
      billingRecordId: 'test-003',
      insuranceCharge: 0,
      transactionDate: '2025-12-15',
      markupPercentage: 0.14
    },
    {
      id: 'test-004',
      feeType: 'Pick and Pack',
      surcharge: 0,
      baseAmount: 2.50,
      baseCharge: 2.88,
      description: 'Pick and Pack - 3 orders',
      invoiceIdSb: 9999999,
      orderNumber: null,
      totalCharge: 2.88,
      billedAmount: 2.88,
      billingTable: 'billing_pickpack',
      lineCategory: 'Fulfillment',
      markupRuleId: null,
      insuranceCost: 0,
      markupApplied: 0.38,
      trackingNumber: null,
      billingRecordId: 'test-004',
      insuranceCharge: 0,
      transactionDate: '2025-12-15',
      markupPercentage: 0.15
    }
  ]

  // Calculate totals
  const subtotal = lineItems.reduce((sum, item) => sum + item.baseAmount, 0)
  const totalMarkup = lineItems.reduce((sum, item) => sum + item.markupApplied, 0)
  const totalAmount = lineItems.reduce((sum, item) => sum + item.totalCharge, 0)

  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .insert({
      id: invoiceId,
      client_id: clientId,
      invoice_number: invoiceNumber,
      invoice_date: '2025-12-17',
      period_start: '2025-12-08',
      period_end: '2025-12-14',
      subtotal: subtotal.toFixed(2),
      total_markup: totalMarkup.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      status: 'draft',
      paid_status: 'unpaid',
      line_items_json: lineItems,
      shipbob_invoice_ids: [9999999],
      version: 1
    })
    .select()
    .single()

  if (invoiceError) {
    console.error('Error creating invoice:', invoiceError)
    process.exit(1)
  }

  console.log('Created test invoice:', invoice.invoice_number)
  console.log(`  Subtotal: $${subtotal.toFixed(2)}`)
  console.log(`  Markup: $${totalMarkup.toFixed(2)}`)
  console.log(`  Total: $${totalAmount.toFixed(2)}`)
  console.log(`  Status: ${invoice.status}`)
  console.log(`  Paid Status: ${invoice.paid_status}`)

  console.log('\n✅ Done! You can now:')
  console.log('1. Go to the billing page and switch "Jetpack Demo" to Credit Card')
  console.log('2. Enter a test card (4242 4242 4242 4242)')
  console.log('3. Approve the invoice and watch it auto-charge')
}

main().catch(console.error)
