#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function verify() {
  // Use count queries (no row limit)
  const { count: txCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  // Count by fee type - paginate to get all
  const byFee = {}
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data: txData } = await supabase
      .from('transactions')
      .select('transaction_fee')
      .eq('client_id', HENSON_ID)
      .range(offset, offset + pageSize - 1)

    if (!txData || txData.length === 0) break

    for (const tx of txData) {
      if (!byFee[tx.transaction_fee]) byFee[tx.transaction_fee] = 0
      byFee[tx.transaction_fee]++
    }

    if (txData.length < pageSize) break
    offset += pageSize
  }

  console.log('=== ACTUAL DATABASE COUNTS ===')
  console.log(`Shipments: ${shipmentCount}`)
  console.log(`Transactions: ${txCount}`)
  console.log('')
  console.log('By fee type:')
  Object.entries(byFee).sort((a,b) => b[1] - a[1]).forEach(([fee, count]) => {
    console.log(`  ${fee.padEnd(25)}: ${count}`)
  })
}

verify().catch(console.error)
