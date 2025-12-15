#!/usr/bin/env node
/**
 * Compare line item rounding: system vs Excel formula
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('line_items_json, total_amount')
    .eq('id', '99a2af43-2e10-4737-8119-43147b92d964')
    .single()

  const lineItems = invoice.line_items_json

  console.log('Current invoice total:', invoice.total_amount)
  console.log('Expected total: $17,751.94')
  console.log('Difference:', (invoice.total_amount - 17751.94).toFixed(2))

  // Group by category
  const byCategory = {}
  for (const item of lineItems) {
    const cat = item.lineCategory || 'Unknown'
    if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 }
    byCategory[cat].count++
    byCategory[cat].total += item.billedAmount || 0
  }

  console.log('\n=== TOTALS BY CATEGORY ===')
  for (const [cat, data] of Object.entries(byCategory)) {
    console.log(cat + ': ' + data.count + ' items, $' + data.total.toFixed(2))
  }
  console.log('\nExpected from manual invoice:')
  console.log('  Shipping: $17,323.82')
  console.log('  Total: $17,751.94')

  // Look for shipping difference specifically
  const shippingTotal = byCategory['Shipping']?.total || 0
  console.log('\n=== SHIPPING DIFFERENCE ===')
  console.log('System shipping total: $' + shippingTotal.toFixed(2))
  console.log('Expected shipping: $17,323.82')
  console.log('Difference: $' + (shippingTotal - 17323.82).toFixed(2))

  // Check markup percentages on shipping items
  const shippingItems = lineItems.filter(i => i.lineCategory === 'Shipping')
  const markupCounts = {}
  for (const item of shippingItems) {
    const pct = item.markupPercentage || 0
    markupCounts[pct] = (markupCounts[pct] || 0) + 1
  }
  console.log('\n=== MARKUP PERCENTAGES ON SHIPPING ===')
  for (const [pct, count] of Object.entries(markupCounts)) {
    console.log(pct + ': ' + count + ' items')
  }

  // Sample a few shipping items
  console.log('\n=== SAMPLE SHIPPING ITEMS ===')
  for (const item of shippingItems.slice(0, 3)) {
    console.log('  transactionId:', item.transactionId)
    console.log('  baseAmount:', item.baseAmount, ', surcharge:', item.surcharge, ', insurance:', item.insuranceCost || 0)
    console.log('  markupPercentage:', item.markupPercentage)
    console.log('  billedAmount:', item.billedAmount)

    // What SHOULD it be with 10% markup?
    const expected10 = Math.round(((item.baseAmount * 1.10) + (item.surcharge || 0) + ((item.insuranceCost || 0) * 1.10)) * 100) / 100
    console.log('  Expected with 10%:', expected10)
    console.log('')
  }
}

main().catch(console.error)
