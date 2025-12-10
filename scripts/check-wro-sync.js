require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Checking WRO Sync Status ===\n')

  // The WRO IDs from our unattributed transactions
  const wroIds = [871028, 870085, 871098, 875259, 873893, 874413, 875181]

  console.log('Looking for WRO IDs:', wroIds.join(', '), '\n')

  // Check if they exist in receiving_orders
  const { data: wros, error: wroError } = await supabase
    .from('receiving_orders')
    .select('receiving_order_id, client_id, status, created_date, updated_date')
    .in('receiving_order_id', wroIds)

  if (wroError) {
    console.log('Error querying receiving_orders:', wroError.message)
  } else {
    console.log('Found in receiving_orders:', wros?.length || 0)
    if (wros?.length > 0) {
      for (const wro of wros) {
        console.log('  WRO', wro.receiving_order_id, '-> client_id:', wro.client_id, '| status:', wro.status)
      }
    }
  }

  // Check total receiving_orders count
  const { count: totalWros } = await supabase
    .from('receiving_orders')
    .select('*', { count: 'exact', head: true })

  console.log('\nTotal receiving_orders in DB:', totalWros)

  // Check date range of receiving_orders
  const { data: minMaxDates } = await supabase
    .from('receiving_orders')
    .select('created_date')
    .order('created_date', { ascending: true })
    .limit(1)

  const { data: maxDate } = await supabase
    .from('receiving_orders')
    .select('created_date')
    .order('created_date', { ascending: false })
    .limit(1)

  console.log('Date range of receiving_orders:')
  console.log('  Oldest:', minMaxDates?.[0]?.created_date)
  console.log('  Newest:', maxDate?.[0]?.created_date)

  // Now get the unattributed WRO transactions and check additional_details
  console.log('\n=== Checking Unattributed WRO Transactions ===\n')

  const { data: wroTxs } = await supabase
    .from('transactions')
    .select('*')
    .is('merchant_id', null)
    .eq('reference_type', 'WRO')

  console.log('WRO transactions with NULL merchant_id:', wroTxs?.length || 0)

  if (wroTxs && wroTxs.length > 0) {
    console.log('\nFull transaction details:')
    for (const tx of wroTxs) {
      console.log('\n  Transaction:', tx.transaction_id)
      console.log('    reference_id (WRO):', tx.reference_id)
      console.log('    fee_type:', tx.fee_type)
      console.log('    cost:', tx.cost)
      console.log('    charge_date:', tx.charge_date)
      console.log('    fulfillment_center:', tx.fulfillment_center)
      console.log('    additional_details:', JSON.stringify(tx.additional_details, null, 2))
    }
  }

  // Check for inventory placement transactions
  console.log('\n=== Checking Default transactions (Inventory Placement) ===\n')

  const { data: invTxs } = await supabase
    .from('transactions')
    .select('*')
    .is('merchant_id', null)
    .eq('reference_type', 'Default')
    .in('fee_type', ['Inventory Placement Fee', 'Credit'])

  console.log('Inventory Placement/Credit transactions with NULL merchant_id:', invTxs?.length || 0)

  if (invTxs && invTxs.length > 0) {
    for (const tx of invTxs) {
      console.log('\n  Transaction:', tx.transaction_id)
      console.log('    reference_id:', tx.reference_id)
      console.log('    fee_type:', tx.fee_type)
      console.log('    cost:', tx.cost)
      console.log('    charge_date:', tx.charge_date)
      console.log('    additional_details:', JSON.stringify(tx.additional_details, null, 2))
    }
  }
}

main().catch(console.error)
