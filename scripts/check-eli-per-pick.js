#!/usr/bin/env node
/**
 * Check Eli Health Per Pick Fee transactions against ShipBob API
 * to find phantom transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  const token = process.env.SHIPBOB_API_TOKEN
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Get all Eli Health Per Pick Fee transactions on invoice 8730397
  const { data: tx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, cost, charge_date')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('invoice_id_sb', 8730397)
    .is('dispute_status', null)

  console.log('Eli Health Per Pick Fee transactions:', tx?.length)
  console.log('Total cost:', tx?.reduce((s, t) => s + parseFloat(t.cost), 0).toFixed(2))
  console.log('Expected: $394.56')
  console.log('Difference: $' + (tx?.reduce((s, t) => s + parseFloat(t.cost), 0) - 394.56).toFixed(2))

  // Query ShipBob API for Per Pick Fee on this invoice
  // Get transactions from the invoice period (Dec 15-21)
  console.log('\nQuerying ShipBob API for Per Pick Fee transactions...')

  let allTx = []
  let cursor = null

  do {
    const body = {
      start_date: '2025-12-15',
      end_date: '2025-12-21',
      transaction_types: ['Charge'],
      page_size: 1000
    }
    if (cursor) body.cursor = cursor

    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const data = await response.json()
    allTx = allTx.concat(data.items || [])
    cursor = data.next || null
  } while (cursor)

  // Filter to Per Pick Fee for Eli Health's merchant_id
  // Get Eli Health merchant_id
  const { data: eli } = await supabase
    .from('clients')
    .select('merchant_id')
    .eq('id', eliHealthId)
    .single()

  console.log('Eli Health merchant_id:', eli?.merchant_id)

  // Get Eli Health shipment IDs for reference
  const { data: eliShipments } = await supabase
    .from('shipments')
    .select('shipment_id')
    .eq('client_id', eliHealthId)

  const eliShipmentIds = new Set((eliShipments || []).map(s => s.shipment_id))
  console.log('Eli Health shipments in DB:', eliShipmentIds.size)

  // Filter ShipBob Per Pick Fee to those referencing Eli Health shipments
  const perPickFees = allTx.filter(t =>
    t.transaction_fee === 'Per Pick Fee' &&
    t.reference_type === 'Shipment' &&
    eliShipmentIds.has(t.reference_id)
  )

  console.log('ShipBob Per Pick Fee for Eli Health:', perPickFees.length)
  console.log('ShipBob total:', perPickFees.reduce((s, t) => s + parseFloat(t.amount), 0).toFixed(2))

  // Find transactions in our DB that are NOT in ShipBob
  const shipbobTxIds = new Set(perPickFees.map(t => t.transaction_id))
  const phantomTx = (tx || []).filter(t => !shipbobTxIds.has(t.transaction_id))

  if (phantomTx.length > 0) {
    console.log('\n=== PHANTOM TRANSACTIONS (in DB but not in ShipBob) ===')
    console.log('Count:', phantomTx.length)
    console.log('Total cost:', phantomTx.reduce((s, t) => s + parseFloat(t.cost), 0).toFixed(2))
    for (const t of phantomTx.slice(0, 10)) {
      console.log('  tx:', t.transaction_id, 'ref:', t.reference_id, 'cost:', t.cost, 'date:', t.charge_date?.split('T')[0])
    }
  } else {
    console.log('\nNo phantom transactions found - all DB transactions exist in ShipBob')
  }
}

check().catch(console.error)
