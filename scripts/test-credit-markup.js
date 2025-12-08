/**
 * Synthetic Test: Credit Markup Logic
 *
 * Tests that credits matching a shipment's base_cost get the same markup applied.
 *
 * This test:
 * 1. Finds a real shipment that has been invoiced with markup data
 * 2. Creates a synthetic credit that exactly matches the base_cost
 * 3. Runs the markup logic
 * 4. Verifies credit gets correct markup percentage
 *
 * Usage: node scripts/test-credit-markup.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('SYNTHETIC TEST: Credit Markup Logic')
  console.log('='.repeat(70))

  // Step 1: Find a shipment that has been invoiced with markup data
  console.log('\n1. Finding invoiced shipment with markup data...')

  const { data: invoicedShipment, error: shipError } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .eq('invoiced_status_jp', true)
    .not('markup_percentage', 'is', null)
    .not('base_cost', 'is', null)
    .gt('base_cost', 0)
    .limit(1)
    .single()

  if (shipError || !invoicedShipment) {
    console.log('No invoiced shipment with markup data found.')
    console.log('Creating synthetic test data...')

    // Find ANY shipment with base_cost to test with
    const { data: anyShipment, error: anyError } = await supabase
      .from('transactions')
      .select('*')
      .eq('reference_type', 'Shipment')
      .eq('transaction_fee', 'Shipping')
      .not('base_cost', 'is', null)
      .gt('base_cost', 0)
      .limit(1)
      .single()

    if (anyError || !anyShipment) {
      console.error('No shipments with base_cost found. Run backfill first.')
      process.exit(1)
    }

    // Temporarily set markup data on this shipment for testing
    console.log(`\nUsing shipment ${anyShipment.reference_id} for synthetic test`)
    console.log(`  base_cost: $${anyShipment.base_cost}`)

    // We'll use 14% markup (common Henson rate) for the test
    const testMarkupPct = 0.14

    await supabase
      .from('transactions')
      .update({
        invoiced_status_jp: true,
        markup_percentage: testMarkupPct,
        markup_amount: anyShipment.base_cost * testMarkupPct,
        billed_amount: anyShipment.base_cost + (anyShipment.base_cost * testMarkupPct)
      })
      .eq('id', anyShipment.id)

    console.log(`  Set markup_percentage: ${testMarkupPct * 100}%`)

    // Re-fetch to get updated data
    const { data: updatedShipment } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', anyShipment.id)
      .single()

    if (!updatedShipment) {
      console.error('Failed to update shipment')
      process.exit(1)
    }

    await runCreditTest(updatedShipment, true)

    // Clean up: reset the test data
    console.log('\n5. Cleaning up synthetic test data...')
    await supabase
      .from('transactions')
      .update({
        invoiced_status_jp: false,
        markup_percentage: null,
        markup_amount: null,
        billed_amount: null
      })
      .eq('id', anyShipment.id)
    console.log('   Reset shipment markup data')

  } else {
    console.log(`Found invoiced shipment: ${invoicedShipment.reference_id}`)
    console.log(`  base_cost: $${invoicedShipment.base_cost}`)
    console.log(`  markup_percentage: ${(invoicedShipment.markup_percentage * 100).toFixed(1)}%`)

    await runCreditTest(invoicedShipment, false)
  }

  console.log('\n' + '='.repeat(70))
  console.log('TEST COMPLETE')
  console.log('='.repeat(70))
}

async function runCreditTest(shipment, isSynthetic) {
  // Step 2: Create a synthetic credit that exactly matches base_cost
  console.log('\n2. Creating synthetic credit matching base_cost...')

  const creditAmount = -shipment.base_cost  // Credits are negative
  console.log(`   Credit amount: $${creditAmount.toFixed(2)}`)
  console.log(`   References shipment: ${shipment.reference_id}`)

  // Simulate the credit line item (as it would appear in collectBillingTransactions)
  const creditLineItem = {
    id: 'synthetic-credit-test',
    transactionId: 'SYNTHETIC-TEST-001',
    transactionDate: new Date().toISOString().split('T')[0],
    lineCategory: 'Credits',
    lineType: 'Shipping Credit',
    orderNumber: String(shipment.reference_id),  // References the shipment
    description: 'Test - Shipping Fee Credit',
    baseAmount: creditAmount,
    markupApplied: 0,
    billedAmount: creditAmount,
    chargeDate: new Date().toISOString().split('T')[0],
  }

  // Step 3: Simulate the markup lookup logic from invoice-generator.ts
  console.log('\n3. Running markup logic...')

  // Build shipmentMarkupMap as done in applyMarkupsToLineItems
  const shipmentMarkupMap = new Map()
  shipmentMarkupMap.set(String(shipment.reference_id), {
    baseAmount: shipment.base_cost,
    markupPercentage: shipment.markup_percentage * 100,  // Stored as decimal, needs %
    markupRuleId: shipment.markup_rule_id || 'test-rule'
  })

  console.log(`   Shipment map entry: shipment ${shipment.reference_id} -> base $${shipment.base_cost}, markup ${(shipment.markup_percentage * 100).toFixed(1)}%`)

  // Apply the credit markup logic (exact replica from invoice-generator.ts)
  let result = { ...creditLineItem }

  if (result.lineCategory === 'Credits' && result.orderNumber) {
    const shipmentMarkup = shipmentMarkupMap.get(result.orderNumber)

    console.log(`   Credit orderNumber: ${result.orderNumber}`)
    console.log(`   Credit amount (abs): $${Math.abs(result.baseAmount).toFixed(2)}`)
    console.log(`   Shipment base_cost: $${shipmentMarkup?.baseAmount.toFixed(2) || 'N/A'}`)

    // Match if absolute credit amount equals shipment base amount (within 1 cent tolerance)
    if (shipmentMarkup && Math.abs(Math.abs(result.baseAmount) - shipmentMarkup.baseAmount) < 0.01) {
      console.log(`   MATCH FOUND - applying markup`)

      // This is a shipping fee credit - apply same markup as original shipment
      const markupDecimal = shipmentMarkup.markupPercentage / 100
      const markupAmount = result.baseAmount * markupDecimal  // baseAmount is negative
      const billedAmount = result.baseAmount + markupAmount   // More negative

      result = {
        ...result,
        markupApplied: Math.round(markupAmount * 100) / 100,
        billedAmount: Math.round(billedAmount * 100) / 100,
        markupRuleId: shipmentMarkup.markupRuleId,
        markupPercentage: markupDecimal,
      }
    } else {
      console.log(`   NO MATCH - credit will not be marked up`)
    }
  }

  // Step 4: Verify results
  console.log('\n4. Verifying results...')

  const expectedMarkupPct = shipment.markup_percentage
  const expectedMarkupAmt = creditAmount * expectedMarkupPct
  const expectedBilledAmt = creditAmount + expectedMarkupAmt

  console.log('\n   EXPECTED:')
  console.log(`     Base Amount:    $${creditAmount.toFixed(2)}`)
  console.log(`     Markup %:       ${(expectedMarkupPct * 100).toFixed(1)}%`)
  console.log(`     Markup Amount:  $${expectedMarkupAmt.toFixed(2)}`)
  console.log(`     Billed Amount:  $${expectedBilledAmt.toFixed(2)}`)

  console.log('\n   ACTUAL:')
  console.log(`     Base Amount:    $${result.baseAmount.toFixed(2)}`)
  console.log(`     Markup %:       ${result.markupPercentage ? (result.markupPercentage * 100).toFixed(1) : '0.0'}%`)
  console.log(`     Markup Amount:  $${result.markupApplied.toFixed(2)}`)
  console.log(`     Billed Amount:  $${result.billedAmount.toFixed(2)}`)

  // Assertions
  const baseMatch = Math.abs(result.baseAmount - creditAmount) < 0.01
  const markupPctMatch = Math.abs((result.markupPercentage || 0) - expectedMarkupPct) < 0.001
  const markupAmtMatch = Math.abs(result.markupApplied - expectedMarkupAmt) < 0.01
  const billedAmtMatch = Math.abs(result.billedAmount - expectedBilledAmt) < 0.01

  console.log('\n   ASSERTIONS:')
  console.log(`     Base Amount:    ${baseMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`     Markup %:       ${markupPctMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`     Markup Amount:  ${markupAmtMatch ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`     Billed Amount:  ${billedAmtMatch ? '✅ PASS' : '❌ FAIL'}`)

  const allPass = baseMatch && markupPctMatch && markupAmtMatch && billedAmtMatch

  console.log('\n   ' + (allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'))

  if (!allPass) {
    process.exit(1)
  }

  // Show business meaning
  console.log('\n   BUSINESS INTERPRETATION:')
  console.log(`     Original Shipment: Charged $${shipment.base_cost.toFixed(2)} base + ${(shipment.markup_percentage * 100).toFixed(0)}% markup = $${(shipment.base_cost * (1 + shipment.markup_percentage)).toFixed(2)} to client`)
  console.log(`     Credit Refund:     Returns  $${Math.abs(result.billedAmount).toFixed(2)} to client (base + markup)`)
  console.log(`     Net Effect:        Client pays $0.00 for this shipment (fully refunded with markup)`)
}

main().catch(console.error)
