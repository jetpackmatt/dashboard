/**
 * Check which clients have shipments from Twin Lakes (WI) FC
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  const fcName = 'Twin Lakes (WI)'

  console.log(`=== CLIENTS USING FC: ${fcName} ===\n`)

  // Check shipments by FC
  const { data: shipments } = await supabase
    .from('shipments')
    .select('client_id')
    .eq('fc_name', fcName)
    .limit(1000)

  // Count by client
  const clientCounts = {}
  for (const s of shipments || []) {
    if (s.client_id) {
      clientCounts[s.client_id] = (clientCounts[s.client_id] || 0) + 1
    }
  }

  // Get client names
  const clientIds = Object.keys(clientCounts)
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name')
      .in('id', clientIds)

    const clientNames = {}
    for (const c of clients || []) {
      clientNames[c.id] = c.company_name
    }

    console.log('Clients with shipments from Twin Lakes (WI):')
    for (const [clientId, count] of Object.entries(clientCounts)) {
      console.log(`  ${clientNames[clientId] || clientId}: ${count} shipments`)
    }
  } else {
    console.log('No shipments found from this FC')
  }

  // Also check what FCs we have
  console.log('\n=== ALL FCs IN SHIPMENTS ===\n')

  const { data: allShipments } = await supabase
    .from('shipments')
    .select('fc_name, client_id')

  const fcCounts = {}
  for (const s of allShipments || []) {
    const fc = s.fc_name || '(null)'
    fcCounts[fc] = (fcCounts[fc] || 0) + 1
  }

  for (const [fc, count] of Object.entries(fcCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fc}: ${count}`)
  }
}

check().catch(console.error)
