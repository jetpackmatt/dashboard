#!/usr/bin/env node
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
    .select('line_items_json')
    .eq('id', '5acf2117-c34a-45a7-afa1-dcd1bd7c8931')
    .single()

  const lineItems = invoice.line_items_json

  // Count by lineCategory
  const byCat = {}
  for (const item of lineItems) {
    const cat = item.lineCategory || 'Unknown'
    if (!byCat[cat]) byCat[cat] = { count: 0, billedAmount: 0 }
    byCat[cat].count++
    byCat[cat].billedAmount += item.billedAmount || 0
  }

  console.log('Line items by category:')
  for (const [cat, data] of Object.entries(byCat)) {
    console.log('  ', cat, ':', data.count, 'items, $' + data.billedAmount.toFixed(2))
  }

  console.log('\nTotal line items:', lineItems.length)
  console.log('Total billedAmount:', lineItems.reduce((s, i) => s + (i.billedAmount || 0), 0).toFixed(2))

  // Also show what the expected shipping total should be
  console.log('\nExpected totals from manual invoice:')
  console.log('  Shipping: $17,323.82')
  console.log('  Total: $17,751.94')
}

main().catch(console.error)
