require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Finding WRO Owners ===\n')

  // WRO IDs from our unattributed transactions
  const wroIds = [871028, 870085, 871098, 869299, 869656, 868192, 860986, 861112, 856885]

  // Search using shipbob_receiving_id
  const { data: wros, error } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id, purchase_order_number, status')
    .in('shipbob_receiving_id', wroIds)

  if (error) {
    console.log('Error:', error.message)
    return
  }

  console.log('Found in receiving_orders:', wros?.length || 0, 'of', wroIds.length)

  const foundIds = new Set()
  if (wros && wros.length > 0) {
    console.log('\nMatched WROs:')
    for (const wro of wros) {
      foundIds.add(wro.shipbob_receiving_id)
      console.log('  WRO', wro.shipbob_receiving_id, '-> client_id:', wro.client_id, '| merchant_id:', wro.merchant_id, '| PO:', wro.purchase_order_number)
    }
  }

  // Check which WRO IDs are missing
  const missingIds = wroIds.filter(id => !foundIds.has(id))
  if (missingIds.length > 0) {
    console.log('\nMissing WRO IDs (not in our receiving_orders table):')
    console.log('  ', missingIds.join(', '))
  }

  // Get clients lookup for display
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')

  const clientLookup = {}
  for (const c of clients || []) {
    clientLookup[c.id] = c.company_name
  }

  // Now show the full attribution solution
  console.log('\n=== Attribution Solution ===\n')

  // Get the unattributed WRO transactions
  const { data: txs } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, cost')
    .is('merchant_id', null)
    .eq('reference_type', 'WRO')

  for (const tx of txs || []) {
    const wro = wros?.find(w => String(w.shipbob_receiving_id) === tx.reference_id)
    if (wro) {
      console.log('✅ CAN FIX:', tx.transaction_id, '(WRO', tx.reference_id, ') -> ', clientLookup[wro.client_id] || wro.client_id)
    } else {
      console.log('❌ MISSING:', tx.transaction_id, '(WRO', tx.reference_id, ') - not in our receiving_orders table')
    }
  }

  // Also get the Inventory Placement and Credit transactions
  console.log('\n=== Default Fee Type Transactions ===\n')

  const { data: defaultTxs } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, cost, reference_type')
    .is('merchant_id', null)
    .eq('reference_type', 'Default')
    .in('fee_type', ['Inventory Placement Fee', 'Inventory Placement Program Fee', 'Credit'])

  for (const tx of defaultTxs || []) {
    if (tx.fee_type === 'Credit') {
      // Check if reference_id is a shipment
      const { data: shipment } = await supabase
        .from('shipments')
        .select('shipment_id, client_id')
        .eq('shipment_id', tx.reference_id)
        .maybeSingle()

      if (shipment) {
        console.log('✅ CAN FIX:', tx.transaction_id, '(Credit, ref:', tx.reference_id, ') -> ', clientLookup[shipment.client_id] || shipment.client_id)
      } else {
        console.log('❌ MISSING:', tx.transaction_id, '(Credit, ref:', tx.reference_id, ') - shipment not in our shipments table')
      }
    } else {
      // Inventory Placement - check if reference_id is a WRO
      const wro = wros?.find(w => String(w.shipbob_receiving_id) === tx.reference_id)
      if (wro) {
        console.log('✅ CAN FIX:', tx.transaction_id, '(', tx.fee_type, ', WRO', tx.reference_id, ') -> ', clientLookup[wro.client_id] || wro.client_id)
      } else {
        console.log('❌ MISSING:', tx.transaction_id, '(', tx.fee_type, ', WRO', tx.reference_id, ') - not in our receiving_orders table')
      }
    }
  }
}

main().catch(console.error)
