#!/usr/bin/env npx tsx
/**
 * Test the markup engine using actual database rules
 * Tests rule fetching, matching, and calculation
 */
import 'dotenv/config'
import {
  fetchMarkupRules,
  findMatchingRule,
  calculateMarkup,
  calculateBatchMarkups,
  type TransactionContext,
  type BillingCategory
} from '../lib/billing/markup-engine'
import { createAdminClient } from '../lib/supabase/admin'

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  console.log('='.repeat(70))
  console.log('MARKUP ENGINE TESTS')
  console.log('='.repeat(70))

  // Test 1: Fetch rules from database
  console.log('\n## Test 1: Fetch Markup Rules')
  console.log('-'.repeat(70))

  const rules = await fetchMarkupRules(HENSON_ID)
  console.log(`Rules fetched for Henson: ${rules.length}`)

  for (const r of rules) {
    console.log(`  [${r.billing_category || '*'}] fee=${r.fee_type || '*'} ship_opt=${r.ship_option_id || '*'}: ${r.markup_type} ${r.markup_value}${r.markup_type === 'percentage' ? '%' : ''}`)
  }

  // Test 2: Rule matching - ship_option_id 146 (should get 18%)
  console.log('\n## Test 2: Rule Matching - Ship Option 146')
  console.log('-'.repeat(70))

  const context146: TransactionContext = {
    clientId: HENSON_ID,
    transactionDate: new Date(),
    feeType: 'Standard',
    billingCategory: 'shipments' as BillingCategory,
    shipOptionId: '146',
  }

  const rule146 = findMatchingRule(rules, context146)
  console.log(`Context: billingCategory=shipments, feeType=Standard, shipOptionId=146`)
  console.log(`Matched rule: ${rule146?.name || 'NONE'}`)
  console.log(`Markup: ${rule146?.markup_value}${rule146?.markup_type === 'percentage' ? '%' : ' fixed'}`)
  console.log(`Expected: 18% (ship_option_id 146 specific)`)
  console.log(`Result: ${rule146?.markup_value === 18 ? '✅ PASS' : '❌ FAIL'}`)

  // Test 3: Rule matching - generic ship option (should get 14%)
  console.log('\n## Test 3: Rule Matching - Generic Ship Option')
  console.log('-'.repeat(70))

  const contextStd: TransactionContext = {
    clientId: HENSON_ID,
    transactionDate: new Date(),
    feeType: 'Standard',
    billingCategory: 'shipments' as BillingCategory,
    shipOptionId: '999', // Non-specific option
  }

  const ruleStd = findMatchingRule(rules, contextStd)
  console.log(`Context: billingCategory=shipments, feeType=Standard, shipOptionId=999`)
  console.log(`Matched rule: ${ruleStd?.name || 'NONE'}`)
  console.log(`Markup: ${ruleStd?.markup_value}${ruleStd?.markup_type === 'percentage' ? '%' : ' fixed'}`)
  console.log(`Expected: 14% (Standard fallback)`)
  console.log(`Result: ${ruleStd?.markup_value === 14 ? '✅ PASS' : '❌ FAIL'}`)

  // Test 4: Per Pick Fee (should get $0.04 fixed)
  console.log('\n## Test 4: Rule Matching - Per Pick Fee')
  console.log('-'.repeat(70))

  const contextPick: TransactionContext = {
    clientId: HENSON_ID,
    transactionDate: new Date(),
    feeType: 'Per Pick Fee',
    billingCategory: 'shipment_fees' as BillingCategory,
  }

  const rulePick = findMatchingRule(rules, contextPick)
  console.log(`Context: billingCategory=shipment_fees, feeType=Per Pick Fee`)
  console.log(`Matched rule: ${rulePick?.name || 'NONE'}`)
  console.log(`Markup: ${rulePick?.markup_type === 'fixed' ? '$' : ''}${rulePick?.markup_value}${rulePick?.markup_type === 'percentage' ? '%' : ''}`)
  console.log(`Expected: $0.04 fixed`)
  console.log(`Result: ${rulePick?.markup_value === 0.04 && rulePick?.markup_type === 'fixed' ? '✅ PASS' : '❌ FAIL'}`)

  // Test 5: Calculate markup amounts
  console.log('\n## Test 5: Markup Calculation')
  console.log('-'.repeat(70))

  // 18% on $10
  const result18 = calculateMarkup(10.00, rule146)
  console.log(`$10.00 with 18% markup:`)
  console.log(`  Base: $${result18.baseAmount.toFixed(2)}`)
  console.log(`  Markup: $${result18.markupAmount.toFixed(2)}`)
  console.log(`  Billed: $${result18.billedAmount.toFixed(2)}`)
  console.log(`  Expected: $11.80`)
  console.log(`  Result: ${result18.billedAmount === 11.80 ? '✅ PASS' : '❌ FAIL'}`)

  // 14% on $10
  const result14 = calculateMarkup(10.00, ruleStd)
  console.log(`\n$10.00 with 14% markup:`)
  console.log(`  Base: $${result14.baseAmount.toFixed(2)}`)
  console.log(`  Markup: $${result14.markupAmount.toFixed(2)}`)
  console.log(`  Billed: $${result14.billedAmount.toFixed(2)}`)
  console.log(`  Expected: $11.40`)
  console.log(`  Result: ${result14.billedAmount === 11.40 ? '✅ PASS' : '❌ FAIL'}`)

  // $0.04 fixed on $0.20
  const resultPick = calculateMarkup(0.20, rulePick)
  console.log(`\n$0.20 with $0.04 fixed markup:`)
  console.log(`  Base: $${resultPick.baseAmount.toFixed(2)}`)
  console.log(`  Markup: $${resultPick.markupAmount.toFixed(2)}`)
  console.log(`  Billed: $${resultPick.billedAmount.toFixed(2)}`)
  console.log(`  Expected: $0.24`)
  console.log(`  Result: ${resultPick.billedAmount === 0.24 ? '✅ PASS' : '❌ FAIL'}`)

  // Test 6: Batch processing
  console.log('\n## Test 6: Batch Markup Calculation')
  console.log('-'.repeat(70))

  const batchTx = [
    { id: 'tx1', baseAmount: 5.00, context: { ...context146, shipOptionId: '146' } },
    { id: 'tx2', baseAmount: 7.50, context: { ...contextStd, shipOptionId: '999' } },
    { id: 'tx3', baseAmount: 0.20, context: contextPick },
  ]

  const batchResults = await calculateBatchMarkups(batchTx)

  console.log('Batch of 3 transactions:')
  for (const [id, result] of batchResults) {
    console.log(`  ${id}: $${result.baseAmount.toFixed(2)} -> $${result.billedAmount.toFixed(2)} (${result.markupPercentage}% effective)`)
  }

  const tx1 = batchResults.get('tx1')
  const tx2 = batchResults.get('tx2')
  const tx3 = batchResults.get('tx3')

  console.log(`\nExpected:`)
  console.log(`  tx1: $5.00 -> $5.90 (18%)`)
  console.log(`  tx2: $7.50 -> $8.55 (14%)`)
  console.log(`  tx3: $0.20 -> $0.24 ($0.04 fixed = 20% effective)`)

  const batchPass = tx1?.billedAmount === 5.90 && tx2?.billedAmount === 8.55 && tx3?.billedAmount === 0.24
  console.log(`Result: ${batchPass ? '✅ PASS' : '❌ FAIL'}`)

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('TEST SUMMARY')
  console.log('='.repeat(70))

  const tests = [
    { name: 'Rule Fetching', pass: rules.length >= 4 },
    { name: 'Ship Option 146 Match (18%)', pass: rule146?.markup_value === 18 },
    { name: 'Standard Fallback (14%)', pass: ruleStd?.markup_value === 14 },
    { name: 'Per Pick Fee ($0.04)', pass: rulePick?.markup_value === 0.04 },
    { name: '18% Calculation', pass: result18.billedAmount === 11.80 },
    { name: '14% Calculation', pass: result14.billedAmount === 11.40 },
    { name: 'Fixed Calculation', pass: resultPick.billedAmount === 0.24 },
    { name: 'Batch Processing', pass: batchPass },
  ]

  let passed = 0
  for (const t of tests) {
    console.log(`  ${t.pass ? '✅' : '❌'} ${t.name}`)
    if (t.pass) passed++
  }

  console.log(`\n${passed}/${tests.length} tests passed`)
}

main().catch(console.error)
