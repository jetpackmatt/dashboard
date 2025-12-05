#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function analyze() {
  // Get all orders
  const { data: orders } = await supabase.from('orders').select('*').eq('client_id', HENSON_ID)
  const { data: shipments } = await supabase.from('shipments').select('*').eq('client_id', HENSON_ID)

  console.log('=== ORDERS TABLE FIELD ANALYSIS ===')
  console.log('Total orders:', orders.length)
  const orderFields = Object.keys(orders[0] || {})
  for (const field of orderFields.sort()) {
    const populated = orders.filter(o => o[field] !== null && o[field] !== '').length
    const pct = (100 * populated / orders.length).toFixed(1)
    const status = pct === '100.0' ? '✓' : pct === '0.0' ? '✗' : '~'
    console.log(`  ${status} ${field}: ${populated}/${orders.length} (${pct}%)`)
  }

  console.log('\n=== SHIPMENTS TABLE FIELD ANALYSIS ===')
  console.log('Total shipments:', shipments.length)
  const shipFields = Object.keys(shipments[0] || {})
  for (const field of shipFields.sort()) {
    const populated = shipments.filter(s => s[field] !== null && s[field] !== '').length
    const pct = (100 * populated / shipments.length).toFixed(1)
    const status = pct === '100.0' ? '✓' : pct === '0.0' ? '✗' : '~'
    console.log(`  ${status} ${field}: ${populated}/${shipments.length} (${pct}%)`)
  }
}
analyze()
