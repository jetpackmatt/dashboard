#!/usr/bin/env node
/**
 * Fix Inventory Placement Program Fee - move from WarehouseInboundFee to AdditionalFee invoice
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fix() {
  // Fix the specific transaction
  const { data, error } = await supabase
    .from('transactions')
    .update({ invoice_id_sb: 8730397 })
    .eq('transaction_id', '01KCH1N78PFVMNATXFE8Y6DAN2')
    .select('transaction_id, fee_type, reference_type, invoice_id_sb, cost')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('Updated:', data)

  // Verify totals now
  const { data: hensonAdditional } = await supabase
    .from('transactions')
    .select('fee_type, cost')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  // Also include the WRO Inventory Placement fees
  const { data: wroAdditional } = await supabase
    .from('transactions')
    .select('fee_type, cost')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .eq('reference_type', 'WRO')
    .ilike('fee_type', '%Inventory Placement%')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  const all = [...(hensonAdditional || []), ...(wroAdditional || [])]
  let total = 0
  const byFee = {}

  for (const t of all) {
    total += parseFloat(t.cost)
    if (!byFee[t.fee_type]) byFee[t.fee_type] = { count: 0, total: 0 }
    byFee[t.fee_type].count++
    byFee[t.fee_type].total += parseFloat(t.cost)
  }

  console.log('\nHenson Additional Services (including Inventory Placement):')
  for (const [ft, d] of Object.entries(byFee).sort((a, b) => b[1].total - a[1].total)) {
    console.log(' ', ft, ':', d.count, 'tx, $' + d.total.toFixed(2))
  }
  console.log('Total:', total.toFixed(2), '(expected $937.71)')
}

fix().catch(console.error)
