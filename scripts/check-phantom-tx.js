#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function check() {
  const token = process.env.SHIPBOB_API_TOKEN
  const eliHealthId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Get all Eli Health Per Pick Fee transactions
  const { data: tx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, cost, charge_date')
    .eq('client_id', eliHealthId)
    .eq('fee_type', 'Per Pick Fee')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730397)

  // Find duplicate reference_ids
  const byRef = {}
  for (const t of tx || []) {
    if (byRef[t.reference_id] === undefined) byRef[t.reference_id] = []
    byRef[t.reference_id].push(t)
  }

  const duplicates = Object.entries(byRef).filter(([_, arr]) => arr.length > 1)
  console.log('Checking', duplicates.length, 'duplicate shipments against ShipBob API...\n')

  const phantomTxIds = []

  for (const [refId, txs] of duplicates) {
    // Query ShipBob for this shipment
    const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        reference_ids: [refId],
        transaction_types: ['Charge'],
        page_size: 50
      })
    })

    const data = await response.json()
    const shipbobTxIds = new Set((data.items || [])
      .filter(t => t.transaction_fee === 'Per Pick Fee')
      .map(t => t.transaction_id))

    console.log('Shipment', refId, ':')
    console.log('  DB has:', txs.length, 'Shipping tx')
    console.log('  ShipBob has:', shipbobTxIds.size, 'Shipping tx')

    for (const t of txs) {
      const inShipBob = shipbobTxIds.has(t.transaction_id)
      console.log('   ', t.transaction_id.substring(0, 16), t.charge_date?.split('T')[0], inShipBob ? '✓ in ShipBob' : '✗ PHANTOM')
      if (!inShipBob) {
        phantomTxIds.push(t.transaction_id)
      }
    }
    console.log('')
  }

  console.log('\n=== PHANTOM TRANSACTIONS ===')
  console.log('Total phantom tx to remove:', phantomTxIds.length)
  for (const id of phantomTxIds) {
    console.log(' ', id)
  }
}

check().catch(console.error)
