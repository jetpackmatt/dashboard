/**
 * Analyze shipment markup distribution for Henson
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function analyze() {
  // Get Henson shipments with markup info
  const { data: shipments } = await supabase
    .from('transactions')
    .select('shipment_id, ship_option_id, cost, billed_amount, markup_applied, markup_percentage')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .eq('billing_table', 'billing_shipments')
    .not('markup_applied', 'is', null)
    .limit(2000)

  // Group by markup percentage
  const byMarkup = {}
  let total14 = { cost: 0, billed: 0, count: 0 }
  let total18 = { cost: 0, billed: 0, count: 0 }
  let totalOther = { cost: 0, billed: 0, count: 0 }

  for (const s of shipments || []) {
    const pct = Math.round(s.markup_percentage * 100)
    if (!byMarkup[pct]) byMarkup[pct] = { count: 0, cost: 0, billed: 0 }
    byMarkup[pct].count++
    byMarkup[pct].cost += s.cost
    byMarkup[pct].billed += s.billed_amount

    if (pct === 14) {
      total14.cost += s.cost
      total14.billed += s.billed_amount
      total14.count++
    } else if (pct === 18) {
      total18.cost += s.cost
      total18.billed += s.billed_amount
      total18.count++
    } else {
      totalOther.cost += s.cost
      totalOther.billed += s.billed_amount
      totalOther.count++
    }
  }

  console.log('=== Henson Shipments Markup Analysis ===')
  console.log('By Markup Percentage:')
  for (const [pct, data] of Object.entries(byMarkup).sort((a,b) => a[0] - b[0])) {
    console.log(`  ${pct}%: ${data.count} shipments, cost $${data.cost.toFixed(2)}, billed $${data.billed.toFixed(2)}, markup $${(data.billed - data.cost).toFixed(2)}`)
  }

  const totalCost = total14.cost + total18.cost + totalOther.cost
  const totalBilled = total14.billed + total18.billed + totalOther.billed
  console.log(`\nTotal: ${shipments?.length} shipments`)
  console.log(`  Cost: $${totalCost.toFixed(2)}`)
  console.log(`  Billed: $${totalBilled.toFixed(2)}`)
  console.log(`  Markup: $${(totalBilled - totalCost).toFixed(2)}`)

  // Check ship_option_id 146 specifically
  const with146 = shipments?.filter(s => s.ship_option_id === 146)
  const without146 = shipments?.filter(s => s.ship_option_id !== 146)

  console.log(`\nship_option_id 146: ${with146?.length} shipments`)
  if (with146?.length > 0) {
    const pcts146 = {}
    for (const s of with146) {
      const pct = Math.round(s.markup_percentage * 100)
      pcts146[pct] = (pcts146[pct] || 0) + 1
    }
    console.log('  Markup distribution:', pcts146)
    const cost146 = with146.reduce((sum, s) => sum + s.cost, 0)
    const billed146 = with146.reduce((sum, s) => sum + s.billed_amount, 0)
    console.log(`  Cost: $${cost146.toFixed(2)}, Billed: $${billed146.toFixed(2)}`)
  }

  console.log(`\nOther ship_options: ${without146?.length} shipments`)
  if (without146?.length > 0) {
    const pctsOther = {}
    for (const s of without146) {
      const pct = Math.round(s.markup_percentage * 100)
      pctsOther[pct] = (pctsOther[pct] || 0) + 1
    }
    console.log('  Markup distribution:', pctsOther)
    const costOther = without146.reduce((sum, s) => sum + s.cost, 0)
    const billedOther = without146.reduce((sum, s) => sum + s.billed_amount, 0)
    console.log(`  Cost: $${costOther.toFixed(2)}, Billed: $${billedOther.toFixed(2)}`)
  }

  // Reference comparison
  console.log('\n=== Reference Comparison ===')
  console.log('Reference Shipments total: $9,715.24')
  console.log(`Generated Shipments total: $${totalBilled.toFixed(2)}`)
  console.log(`Difference: $${(totalBilled - 9715.24).toFixed(2)}`)
}

analyze().catch(console.error)
