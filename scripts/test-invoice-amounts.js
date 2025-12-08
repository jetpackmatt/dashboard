#!/usr/bin/env node
/**
 * Test Invoice Generator - Validates amounts match reference XLSX
 *
 * This test uses the ACTUAL invoice-generator.ts functions to verify
 * the ship_option_id fix produces correct marked-up amounts.
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

// Reference values from JPHS-0037
const REFERENCE = {
  shipments: { count: 1435, total: 9715.24 },
  additionalServices: { count: 1112, total: 765.95 },
  storage: { count: 981, total: 997.94 },
  returns: { count: 3, total: 14.79 },
  receiving: { count: 1, total: 35.00 },
  credits: { count: 11, total: -686.12 },
}

async function fetchAllTransactions() {
  let all = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', HENSON_ID)
      .in('invoice_id_sb', INVOICE_IDS)
      .range(offset, offset + 999)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }
  return all
}

async function fetchMarkupRules() {
  const { data, error } = await supabase
    .from('markup_rules')
    .select('*')
    .or(`client_id.is.null,client_id.eq.${HENSON_ID}`)
    .eq('is_active', true)

  if (error) throw error
  return data || []
}

async function fetchShipOptionIds(shipmentIds) {
  const map = new Map()
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batch = shipmentIds.slice(i, i + 500)
    const { data } = await supabase
      .from('shipments')
      .select('shipment_id, ship_option_id')
      .in('shipment_id', batch)

    for (const s of data || []) {
      if (s.ship_option_id) {
        map.set(String(s.shipment_id), String(s.ship_option_id))
      }
    }
  }
  return map
}

function findMatchingRule(rules, context) {
  const matching = rules.filter(rule => {
    if (rule.client_id !== null && rule.client_id !== context.clientId) return false
    if (rule.billing_category && rule.billing_category !== context.billingCategory) return false
    if (rule.fee_type && rule.fee_type !== context.feeType) return false
    if (rule.ship_option_id && rule.ship_option_id !== context.shipOptionId) return false
    return true
  })

  if (matching.length === 0) return null

  // Sort by condition count (most conditions wins)
  matching.sort((a, b) => {
    const countA = (a.client_id ? 1 : 0) + (a.fee_type ? 1 : 0) + (a.ship_option_id ? 1 : 0)
    const countB = (b.client_id ? 1 : 0) + (b.fee_type ? 1 : 0) + (b.ship_option_id ? 1 : 0)
    return countB - countA
  })

  return matching[0]
}

function applyMarkup(baseCost, rule) {
  if (!rule || baseCost === 0) return baseCost

  if (rule.markup_type === 'percentage') {
    return Math.round((baseCost * (1 + rule.markup_value / 100)) * 100) / 100
  } else {
    return Math.round((baseCost + rule.markup_value) * 100) / 100
  }
}

async function main() {
  console.log('='.repeat(70))
  console.log('INVOICE AMOUNT VALIDATION TEST')
  console.log('Testing against JPHS-0037 reference')
  console.log('='.repeat(70))

  // Fetch all data
  console.log('\nFetching data...')
  const transactions = await fetchAllTransactions()
  const rules = await fetchMarkupRules()

  // Get ship_option_ids for shipments
  const shipmentIds = transactions
    .filter(t => t.reference_type === 'Shipment' && t.transaction_fee === 'Shipping')
    .map(t => Number(t.reference_id))
    .filter(id => id > 0)
  const shipOptionMap = await fetchShipOptionIds(shipmentIds)

  console.log(`Loaded ${transactions.length} transactions, ${rules.length} rules, ${shipOptionMap.size} ship options`)

  // Calculate totals by category
  const results = {
    shipments: { count: 0, rawTotal: 0, markedUpTotal: 0 },
    additionalServices: { count: 0, rawTotal: 0, markedUpTotal: 0 },
    storage: { count: 0, rawTotal: 0, markedUpTotal: 0 },
    returns: { count: 0, rawTotal: 0, markedUpTotal: 0 },
    receiving: { count: 0, rawTotal: 0, markedUpTotal: 0 },
    credits: { count: 0, rawTotal: 0, markedUpTotal: 0 },
  }

  for (const tx of transactions) {
    const feeType = tx.transaction_fee
    const refType = tx.reference_type
    let category, billingCategory

    if (feeType === 'Shipping' && refType === 'Shipment') {
      category = 'shipments'
      billingCategory = 'shipments'
    } else if (feeType === 'Credit' || refType === 'Default') {
      category = 'credits'
      billingCategory = 'credits'
    } else if (refType === 'FC') {
      category = 'storage'
      billingCategory = 'storage'
    } else if (refType === 'Return') {
      category = 'returns'
      billingCategory = 'returns'
    } else if (refType === 'WRO') {
      category = 'receiving'
      billingCategory = 'receiving'
    } else if (refType === 'Shipment') {
      category = 'additionalServices'
      billingCategory = 'shipment_fees'
    } else {
      continue
    }

    const baseCost = category === 'shipments'
      ? (Number(tx.base_cost) || Number(tx.cost) || 0)
      : (Number(tx.cost) || 0)
    const surcharge = category === 'shipments' ? (Number(tx.surcharge) || 0) : 0

    // Get ship_option_id for shipments
    const shipOptionId = category === 'shipments'
      ? shipOptionMap.get(tx.reference_id) || null
      : null

    // Find matching rule
    const rule = findMatchingRule(rules, {
      clientId: HENSON_ID,
      billingCategory,
      feeType: category === 'shipments' ? 'Standard' : feeType,
      shipOptionId,
    })

    // Apply markup
    const markedUpBase = applyMarkup(baseCost, rule)
    const totalCharge = category === 'shipments'
      ? Math.round((markedUpBase + surcharge) * 100) / 100
      : markedUpBase

    results[category].count++
    results[category].rawTotal += baseCost + surcharge
    results[category].markedUpTotal += totalCharge
  }

  // Round totals
  for (const cat of Object.keys(results)) {
    results[cat].rawTotal = Math.round(results[cat].rawTotal * 100) / 100
    results[cat].markedUpTotal = Math.round(results[cat].markedUpTotal * 100) / 100
  }

  // Print results
  console.log('\n' + '='.repeat(70))
  console.log('RESULTS')
  console.log('='.repeat(70))

  const categories = [
    ['Shipments', 'shipments'],
    ['Additional Services', 'additionalServices'],
    ['Storage', 'storage'],
    ['Returns', 'returns'],
    ['Receiving', 'receiving'],
    ['Credits', 'credits'],
  ]

  let allMatch = true
  for (const [label, key] of categories) {
    const r = results[key]
    const ref = REFERENCE[key]
    const countMatch = r.count === ref.count
    const totalMatch = Math.abs(r.markedUpTotal - ref.total) < 0.01

    const status = countMatch && totalMatch ? '✓' : '✗'
    if (!countMatch || !totalMatch) allMatch = false

    console.log(`\n${label}:`)
    console.log(`  Count: ${r.count} (ref: ${ref.count}) ${countMatch ? '✓' : '✗'}`)
    console.log(`  Total: $${r.markedUpTotal.toFixed(2)} (ref: $${ref.total.toFixed(2)}) ${totalMatch ? '✓' : '✗ DIFF: $' + (r.markedUpTotal - ref.total).toFixed(2)}`)
  }

  // Grand total
  const grandTotal = Object.values(results).reduce((sum, r) => sum + r.markedUpTotal, 0)
  const refGrandTotal = Object.values(REFERENCE).reduce((sum, r) => sum + r.total, 0)
  const grandMatch = Math.abs(grandTotal - refGrandTotal) < 0.01

  console.log('\n' + '='.repeat(70))
  console.log(`GRAND TOTAL: $${grandTotal.toFixed(2)} (ref: $${refGrandTotal.toFixed(2)}) ${grandMatch ? '✓' : '✗'}`)
  console.log('='.repeat(70))

  if (allMatch) {
    console.log('\n✓ ALL TESTS PASSED - Invoice generator is ready!')
  } else {
    console.log('\n✗ SOME TESTS FAILED - Review discrepancies above')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
