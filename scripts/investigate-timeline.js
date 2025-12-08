/**
 * Investigate why timeline API returns so little data
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('INVESTIGATING TIMELINE DATA COVERAGE')
  console.log('='.repeat(70))

  // Get a few completed shipments that DO have event_intransit
  console.log('\nSample completed shipments WITH event_intransit:')
  const { data: withData } = await supabase
    .from('shipments')
    .select('shipment_id, status, event_intransit, event_created, created_at, client_id')
    .eq('status', 'Completed')
    .not('event_intransit', 'is', null)
    .limit(5)

  for (const s of withData || []) {
    console.log('  ' + s.shipment_id + ' (client ' + s.client_id + '): created=' + s.created_at?.substring(0, 10) + ' intransit=' + s.event_intransit?.substring(0, 10))
  }

  // Get a few completed shipments that DON'T have event_intransit
  console.log('\nSample completed shipments WITHOUT event_intransit:')
  const { data: withoutData } = await supabase
    .from('shipments')
    .select('shipment_id, status, event_intransit, client_id, created_at')
    .eq('status', 'Completed')
    .is('event_intransit', null)
    .order('created_at', { ascending: false })
    .limit(10)

  for (const s of withoutData || []) {
    console.log('  ' + s.shipment_id + ' (client ' + s.client_id + '): created=' + s.created_at?.substring(0, 10))
  }

  // Get token for a client that has shipments WITH data vs one WITHOUT
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')

  const clientTokens = {}
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientTokens[c.id] = { token, name: c.company_name }
    }
  }
  console.log('\nClients with tokens:', Object.keys(clientTokens).length)

  // Test timeline API on a completed shipment that has no data
  if (withoutData && withoutData.length > 0) {
    const testShipment = withoutData[0]
    const clientInfo = clientTokens[testShipment.client_id]

    if (clientInfo) {
      console.log('\n' + '='.repeat(70))
      console.log('Testing Timeline API for shipment:', testShipment.shipment_id)
      console.log('Client:', clientInfo.name)

      const res = await fetch('https://api.shipbob.com/2025-07/shipment/' + testShipment.shipment_id + '/timeline', {
        headers: { Authorization: 'Bearer ' + clientInfo.token }
      })

      console.log('Status:', res.status)
      const data = await res.json()
      console.log('Response:', JSON.stringify(data, null, 2))
    }
  }

  // Also test one that DOES have data
  if (withData && withData.length > 0) {
    const testShipment = withData[0]
    const clientInfo = clientTokens[testShipment.client_id]

    if (clientInfo) {
      console.log('\n' + '='.repeat(70))
      console.log('Testing Timeline API for shipment WITH data:', testShipment.shipment_id)
      console.log('Client:', clientInfo.name)

      const res = await fetch('https://api.shipbob.com/2025-07/shipment/' + testShipment.shipment_id + '/timeline', {
        headers: { Authorization: 'Bearer ' + clientInfo.token }
      })

      console.log('Status:', res.status)
      const data = await res.json()
      console.log('Response:', JSON.stringify(data, null, 2))
    }
  }

  // Check distribution by client
  console.log('\n' + '='.repeat(70))
  console.log('TIMELINE DATA BY CLIENT')
  console.log('='.repeat(70))

  for (const [clientId, info] of Object.entries(clientTokens)) {
    const { count: total } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'Completed')

    const { count: withIntransit } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'Completed')
      .not('event_intransit', 'is', null)

    const pct = total > 0 ? Math.round(withIntransit / total * 100) : 0
    console.log(info.name + ': ' + withIntransit + '/' + total + ' (' + pct + '%) completed have event_intransit')
  }
}

main().catch(console.error)
