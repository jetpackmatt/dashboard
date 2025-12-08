/**
 * Test Invoice Generation for Henson - Nov 24-30, 2025
 *
 * Uses transactions table as source of truth with markup engine
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ShipBob invoice IDs for Nov 24-30 (from invoices_sb)
const INVOICE_IDS = ['8633634', '8633641', '8633637', '8633612', '8633632', '8633618']

// Map transaction_fee to billing category (for markup engine)
const FEE_TO_CATEGORY = {
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

// Invoice display categories (for grouping in PDF/XLS)
const FEE_TO_DISPLAY_CATEGORY = {
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

async function main() {
  console.log('=' .repeat(70))
  console.log('HENSON INVOICE GENERATION TEST - Nov 24-30, 2025')
  console.log('=' .repeat(70))

  // Get Henson client
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number')
    .ilike('company_name', '%henson%')
    .single()

  console.log(`\nClient: ${henson.company_name}`)
  console.log(`Short Code: ${henson.short_code}`)
  console.log(`Next Invoice #: ${henson.next_invoice_number}`)

  // Get markup rules for Henson
  const { data: rules } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .or(`client_id.is.null,client_id.eq.${henson.id}`)

  console.log(`\nMarkup Rules Loaded: ${rules.length}`)
  for (const r of rules) {
    console.log(`  - ${r.name}: ${r.billing_category}/${r.fee_type} → ${r.markup_value}% (ship_option: ${r.ship_option_id || 'any'})`)
  }

  // Build shipment lookup for ship_option_id
  console.log('\nBuilding shipment lookup...')
  const shipmentLookup = new Map()
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('shipments')
      .select('shipment_id, ship_option_id')
      .range(offset, offset + 999)

    if (error) {
      console.error('Shipment lookup error:', error.message)
      break
    }
    if (!data || data.length === 0) break
    for (const s of data) {
      shipmentLookup.set(s.shipment_id, {
        ship_option_id: s.ship_option_id,
        order_category: null  // Not available in shipments table
      })
    }
    offset += data.length
    if (data.length < 1000) break
  }
  console.log(`Shipment lookup size: ${shipmentLookup.size}`)

  // Fetch all transactions for this invoice period (by invoice_id_sb)
  console.log('\nFetching transactions by invoice_id_sb...')
  let allTransactions = []
  offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', henson.id)
      .in('invoice_id_sb', INVOICE_IDS)
      .range(offset, offset + 999)

    if (error) {
      console.error('Error:', error)
      break
    }
    if (!data || data.length === 0) break
    allTransactions.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }
  console.log(`Transactions loaded: ${allTransactions.length}`)

  // Process transactions and apply markups
  const processedItems = []
  const byDisplayCategory = {}

  for (const tx of allTransactions) {
    const baseAmount = Number(tx.amount) || 0
    const transactionFee = tx.transaction_fee || 'Unknown'
    const billingCategory = FEE_TO_CATEGORY[transactionFee] || 'shipment_fees'
    const displayCategory = FEE_TO_DISPLAY_CATEGORY[transactionFee] || 'Additional Services'

    // For Shipping transactions, look up ship_option_id from shipments
    let shipOptionId = null
    let orderCategory = null
    if (billingCategory === 'shipments' && tx.reference_type === 'Shipment') {
      const shipInfo = shipmentLookup.get(tx.reference_id)
      if (shipInfo) {
        shipOptionId = shipInfo.ship_option_id
        orderCategory = shipInfo.order_category
      }
    }

    // Determine fee_type for markup matching
    // For shipments: Standard (null order_category), FBA, VAS
    const feeType = billingCategory === 'shipments'
      ? (orderCategory || 'Standard')
      : transactionFee

    // Find matching markup rule
    const matchingRule = findMatchingRule(rules, {
      clientId: henson.id,
      billingCategory,
      feeType,
      shipOptionId,
      orderCategory
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

    const billedAmount = baseAmount + markupAmount

    processedItems.push({
      id: tx.id,
      transactionFee,
      baseAmount,
      markupAmount,
      billedAmount,
      markupPercentage,
      ruleId: matchingRule?.id || null,
      ruleName: matchingRule?.name || null,
      billingCategory,
      displayCategory,
      shipOptionId,
      referenceId: tx.reference_id,
      chargeDate: tx.charge_date
    })

    // Aggregate by display category
    if (!byDisplayCategory[displayCategory]) {
      byDisplayCategory[displayCategory] = { count: 0, base: 0, markup: 0, billed: 0 }
    }
    byDisplayCategory[displayCategory].count++
    byDisplayCategory[displayCategory].base += baseAmount
    byDisplayCategory[displayCategory].markup += markupAmount
    byDisplayCategory[displayCategory].billed += billedAmount
  }

  // Calculate totals
  const totals = {
    base: processedItems.reduce((sum, i) => sum + i.baseAmount, 0),
    markup: processedItems.reduce((sum, i) => sum + i.markupAmount, 0),
    billed: processedItems.reduce((sum, i) => sum + i.billedAmount, 0)
  }

  // Print summary
  console.log('\n' + '=' .repeat(70))
  console.log('INVOICE SUMMARY')
  console.log('=' .repeat(70))
  console.log(`Invoice Number: JP${henson.short_code}-${String(henson.next_invoice_number).padStart(4, '0')}-120825`)
  console.log(`Period: Nov 24 - Nov 30, 2025`)
  console.log(`Transactions: ${processedItems.length}`)

  console.log('\nBy Category:')
  console.log('-' .repeat(70))
  console.log('Category'.padEnd(25) + 'Count'.padStart(8) + 'Base'.padStart(14) + 'Markup'.padStart(12) + 'Billed'.padStart(14))
  console.log('-' .repeat(70))

  const categoryOrder = ['Shipping', 'Pick Fees', 'B2B Fees', 'Additional Services', 'Storage', 'Returns', 'Receiving', 'Credits']
  for (const cat of categoryOrder) {
    const stats = byDisplayCategory[cat]
    if (stats) {
      console.log(
        cat.padEnd(25) +
        String(stats.count).padStart(8) +
        ('$' + stats.base.toFixed(2)).padStart(14) +
        ('$' + stats.markup.toFixed(2)).padStart(12) +
        ('$' + stats.billed.toFixed(2)).padStart(14)
      )
    }
  }

  console.log('-' .repeat(70))
  console.log(
    'TOTAL'.padEnd(25) +
    String(processedItems.length).padStart(8) +
    ('$' + totals.base.toFixed(2)).padStart(14) +
    ('$' + totals.markup.toFixed(2)).padStart(12) +
    ('$' + totals.billed.toFixed(2)).padStart(14)
  )

  const effectiveMarkup = totals.base !== 0 ? ((totals.markup / totals.base) * 100).toFixed(2) : '0.00'
  console.log(`\nEffective Markup: ${effectiveMarkup}%`)

  // Show ship_option breakdown for shipping transactions
  console.log('\n' + '=' .repeat(70))
  console.log('SHIPPING MARKUP ANALYSIS')
  console.log('=' .repeat(70))

  const shippingItems = processedItems.filter(i => i.displayCategory === 'Shipping')
  const byShipOption = {}
  for (const item of shippingItems) {
    const key = item.shipOptionId || 'Unknown'
    if (!byShipOption[key]) {
      byShipOption[key] = { count: 0, base: 0, markup: 0, billed: 0, rules: new Set() }
    }
    byShipOption[key].count++
    byShipOption[key].base += item.baseAmount
    byShipOption[key].markup += item.markupAmount
    byShipOption[key].billed += item.billedAmount
    if (item.ruleName) byShipOption[key].rules.add(`${item.ruleName} (${item.markupPercentage}%)`)
  }

  console.log('\nBy Ship Option:')
  for (const [opt, stats] of Object.entries(byShipOption)) {
    const effectivePct = stats.base !== 0 ? ((stats.markup / stats.base) * 100).toFixed(1) : '0.0'
    console.log(`  Ship Option ${opt}: ${stats.count} txns, $${stats.base.toFixed(2)} base, ${effectivePct}% markup → $${stats.billed.toFixed(2)}`)
    console.log(`    Rules: ${[...stats.rules].join(', ') || 'None'}`)
  }
}

/**
 * Find the best matching markup rule (most conditions wins)
 */
function findMatchingRule(rules, context) {
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

    // Ship option match (convert to string for comparison - DB stores as string, shipments as number)
    if (rule.ship_option_id && String(rule.ship_option_id) !== String(context.shipOptionId)) {
      return false
    }

    // Order category match
    if (rule.order_category !== null && rule.order_category !== context.orderCategory) {
      return false
    }

    return true
  })

  if (matching.length === 0) return null

  // Sort by specificity (count conditions) - most specific wins
  matching.sort((a, b) => {
    const countA = countConditions(a)
    const countB = countConditions(b)
    return countB - countA
  })

  return matching[0]
}

function countConditions(rule) {
  let count = 0
  if (rule.client_id !== null) count++
  if (rule.ship_option_id) count++
  if (rule.order_category !== null) count++
  if (rule.conditions?.weight_min_oz !== undefined || rule.conditions?.weight_max_oz !== undefined) count++
  return count
}

main().catch(console.error)
