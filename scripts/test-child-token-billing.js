#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function test() {
  // Get Henson's child token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token, client_id')
    .eq('provider', 'shipbob')
    .limit(1)
    .single()

  if (!creds) {
    console.log('No client credentials found')
    return
  }

  console.log('Testing child token for billing API...')
  console.log('Client ID:', creds.client_id)

  // Try billing API with child token
  const res = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + creds.api_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_size: 100 })
  })

  const status = res.status
  const data = await res.json()

  console.log('\nResponse status:', status)
  console.log('Items count:', data.items?.length || 0)

  if (data.items?.length > 0) {
    console.log('\nSAMPLE TRANSACTION:')
    console.log(JSON.stringify(data.items[0], null, 2))

    // Check if all belong to this client's shipments
    const shipmentIds = data.items
      .filter(t => t.reference_type === 'Shipment')
      .map(t => t.reference_id)
      .slice(0, 5)

    console.log('\nChecking if these shipments belong to client...')
    const { data: ships } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .in('shipment_id', shipmentIds)

    for (const s of ships || []) {
      const match = s.client_id === creds.client_id ? '✅' : '❌'
      console.log('  ' + s.shipment_id + ': ' + match + ' client_id=' + s.client_id)
    }
  } else if (data.error) {
    console.log('Error:', JSON.stringify(data, null, 2))
  }
}

test().catch(console.error)
