#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceIds = [8693044, 8693047, 8693051, 8693054, 8693056]
  const hensonClientId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Testing different query approaches...\n')

  // Query 1: Same as check-missing-products-sold.js (WORKS)
  const { data: q1, count: c1 } = await supabase
    .from('transactions')
    .select('reference_id, client_id', { count: 'exact' })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .range(0, 999)

  console.log(`Query 1 (check-missing style): ${q1?.length || 0} rows, count: ${c1}`)

  // Query 2: Same as identify-orphan-shipments.js
  const { data: q2, error: e2 } = await supabase
    .from('transactions')
    .select('reference_id, transaction_date, total_charge')
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .range(0, 999)

  console.log(`Query 2 (identify-orphan style): ${q2?.length || 0} rows, error: ${e2?.message || 'none'}`)

  // Query 3: Without fee_type filter
  const { data: q3 } = await supabase
    .from('transactions')
    .select('reference_id, fee_type')
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', invoiceIds)
    .limit(10)

  console.log(`Query 3 (no fee_type filter): ${q3?.length || 0} rows`)
  if (q3) {
    const feeTypes = [...new Set(q3.map(t => t.fee_type))]
    console.log(`  Fee types: ${feeTypes.join(', ')}`)
  }

  // Query 4: Check total count for these invoices
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .in('invoice_id_sb', invoiceIds)

  console.log(`Query 4 (all tx for these invoices): ${totalCount}`)

  // Query 5: Check if transactions exist for Henson at all
  const { count: hensonTotal } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)

  console.log(`Query 5 (all Henson transactions): ${hensonTotal}`)
}

main().catch(console.error)
