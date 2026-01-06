#!/usr/bin/env node
/**
 * Query transactions via ShipBob API to find invoice for NULL tx
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const token = process.env.SHIPBOB_API_TOKEN

  // Get the 220 NULL invoice transactions
  const { data: nullTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('NULL tx count:', nullTx?.length)

  // Use the correct API endpoint: POST /transactions:query
  console.log('\n=== Querying via /transactions:query ===\n')

  const sampleShipmentIds = (nullTx || []).slice(0, 10).map(t => t.reference_id)

  const url = 'https://api.shipbob.com/2025-07/transactions:query'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: sampleShipmentIds,
      page_size: 50
    })
  })

  console.log('Status:', response.status)

  if (response.status === 200) {
    const data = await response.json()
    const items = data.items || data || []
    console.log('Transactions found:', items.length)

    for (const tx of items) {
      console.log('  ref:', tx.reference_id, 'tx:', tx.transaction_id?.substring(0, 12),
        'invoice:', tx.invoice_id, 'type:', tx.invoice_type, 'date:', tx.invoice_date)
    }

    // Check if any of our TX IDs are NOT in the response
    const foundRefs = new Set(items.map(t => t.reference_id))
    const notFound = sampleShipmentIds.filter(id => !foundRefs.has(id))
    console.log('\nNot found in API:', notFound.length)
    if (notFound.length > 0) {
      console.log('Missing:', notFound)
    }
  } else {
    console.log('Error:', await response.text())
  }

  // Now try querying by transaction_id instead of reference_id
  console.log('\n=== Querying by transaction_id ===\n')

  const sampleTxIds = (nullTx || []).slice(0, 5).map(t => t.transaction_id)

  const response2 = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      transaction_ids: sampleTxIds,
      page_size: 50
    })
  })

  console.log('Status:', response2.status)

  if (response2.status === 200) {
    const data = await response2.json()
    const items = data.items || data || []
    console.log('Transactions found:', items.length)

    for (const tx of items) {
      console.log('  tx:', tx.transaction_id?.substring(0, 12), 'invoice:', tx.invoice_id, 'date:', tx.invoice_date)
    }
  } else {
    console.log('Error:', await response2.text())
  }
}

main().catch(console.error)
