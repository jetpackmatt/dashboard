/**
 * Compare our marked-up invoice total vs ShipBob's invoice total
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Fee to billing category mapping
const FEE_TO_CATEGORY = {
  'Shipping': 'shipments',
  'Delivery Area Surcharge': 'shipments',
  'Residential Surcharge': 'shipments',
  'Fuel Surcharge': 'shipments',
  'Oversized Surcharge': 'shipments',
  'Extended Area Surcharge': 'shipments',
  'Additional Handling Surcharge': 'shipments',

  'Per Pick Fee': 'shipment_fees',
  'B2B - Each Pick Fee': 'shipment_fees',
  'B2B - Case Pick Fee': 'shipment_fees',
  'B2B - Label Fee': 'shipment_fees',
  'Inventory Placement Program Fee': 'shipment_fees',

  'Warehousing Fee': 'storage',

  'Credit': 'credits',

  'Return to sender - Processing Fees': 'returns',
  'Return Processed by Operations Fee': 'returns',

  'WRO Receiving Fee': 'receiving',
}

async function main() {
  // Get Henson
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name')
    .ilike('company_name', '%henson%')
    .single()

  console.log('Client:', henson.company_name)

  // Get invoice IDs for Dec 1 (as numbers - that's how they're stored in transactions)
  const invoiceIds = [8633641, 8633637, 8633634, 8633632, 8633618, 8633612]

  // Fetch ALL Henson transactions for these invoices
  let allTx = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('transaction_fee, amount, reference_id, reference_type')
      .eq('client_id', henson.id)
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (error) {
      console.log('Query error:', error)
      break
    }
    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }
  console.log('Total transactions:', allTx.length)

  // Get shipment -> ship_option_id mapping (for Shipment reference type)
  const shipmentIds = [...new Set(allTx
    .filter(t => t.reference_type === 'Shipment' && t.reference_id)
    .map(t => Number(t.reference_id)))]
  const shipOptions = {}

  for (let i = 0; i < shipmentIds.length; i += 100) {
    const batch = shipmentIds.slice(i, i + 100)
    const { data } = await supabase
      .from('shipments')
      .select('shipbob_shipment_id, ship_option_id')
      .in('shipbob_shipment_id', batch)

    for (const s of data || []) {
      shipOptions[s.shipbob_shipment_id] = s.ship_option_id
    }
  }
  console.log('Ship options loaded for', Object.keys(shipOptions).length, 'shipments')

  // Get markup rules for Henson
  const { data: rules } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('client_id', henson.id)
    .eq('is_active', true)

  console.log('\nMarkup Rules:')
  for (const r of rules) {
    console.log(`  ${r.billing_category || '*'}/${r.fee_type || '*'}/${r.ship_option_id || '*'}: ${r.markup_type} ${r.markup_value}`)
  }

  // Calculate totals with markups
  let baseTotal = 0
  let markupTotal = 0
  const byCategory = {}
  const byFee = {}

  for (const tx of allTx) {
    const amt = Number(tx.amount)
    const fee = tx.transaction_fee || 'Unknown'
    const category = FEE_TO_CATEGORY[fee] || 'other'
    // For Shipment transactions, look up the ship_option_id
    const shipOptId = (tx.reference_type === 'Shipment' && tx.reference_id)
      ? shipOptions[Number(tx.reference_id)]
      : null

    baseTotal += amt

    // Find best matching rule (most specific wins)
    // Note: For shipments, fee_type in rules is "Standard" meaning standard service,
    // but transaction_fee is "Shipping". We match on billing_category + ship_option_id for shipments.
    const applicableRules = rules.filter(r => {
      if (r.billing_category && r.billing_category !== category) return false
      // For shipments category, skip fee_type matching (fee_type refers to service tier, not transaction type)
      if (category !== 'shipments' && r.fee_type && r.fee_type !== fee) return false
      if (r.ship_option_id && String(r.ship_option_id) !== String(shipOptId)) return false
      return true
    })

    const bestRule = applicableRules.sort((a, b) => {
      const aScore = (a.billing_category ? 1 : 0) + (a.fee_type ? 1 : 0) + (a.ship_option_id ? 1 : 0)
      const bScore = (b.billing_category ? 1 : 0) + (b.fee_type ? 1 : 0) + (b.ship_option_id ? 1 : 0)
      return bScore - aScore
    })[0]

    let markup = 0
    if (bestRule) {
      if (bestRule.markup_type === 'percentage') {
        markup = amt * (bestRule.markup_value / 100)
      } else {
        markup = bestRule.markup_value
      }
    }
    markupTotal += markup

    if (!byCategory[category]) byCategory[category] = { base: 0, markup: 0, count: 0 }
    byCategory[category].base += amt
    byCategory[category].markup += markup
    byCategory[category].count++

    if (!byFee[fee]) byFee[fee] = { base: 0, markup: 0, count: 0 }
    byFee[fee].base += amt
    byFee[fee].markup += markup
    byFee[fee].count++
  }

  console.log('\n' + '='.repeat(80))
  console.log('BY BILLING CATEGORY:')
  console.log('-'.repeat(80))
  for (const [cat, stats] of Object.entries(byCategory).sort((a, b) => b[1].base - a[1].base)) {
    console.log(
      cat.padEnd(15),
      ('$' + stats.base.toFixed(2)).padStart(12),
      '+ $' + stats.markup.toFixed(2).padStart(8),
      '= $' + (stats.base + stats.markup).toFixed(2).padStart(12),
      `(${stats.count} tx)`
    )
  }

  console.log('\n' + '='.repeat(80))
  console.log('BY FEE TYPE:')
  console.log('-'.repeat(80))
  for (const [fee, stats] of Object.entries(byFee).sort((a, b) => b[1].base - a[1].base)) {
    const effectiveRate = stats.base !== 0 ? ((stats.markup / stats.base) * 100).toFixed(1) : 'N/A'
    console.log(
      fee.substring(0, 35).padEnd(36),
      ('$' + stats.base.toFixed(2)).padStart(12),
      '+ $' + stats.markup.toFixed(2).padStart(8),
      `(${effectiveRate}%)`
    )
  }

  console.log('\n' + '='.repeat(80))
  console.log('SUMMARY:')
  console.log('='.repeat(80))
  console.log('Our Base Total:      $' + baseTotal.toFixed(2))
  console.log('Our Markup Total:    $' + markupTotal.toFixed(2))
  console.log('Our Grand Total:     $' + (baseTotal + markupTotal).toFixed(2))
  console.log('')
  console.log('ShipBob Invoice:     $10,842.80')
  console.log('')
  console.log('DIFFERENCE:          $' + (10842.80 - (baseTotal + markupTotal)).toFixed(2))
}

main().catch(console.error)
