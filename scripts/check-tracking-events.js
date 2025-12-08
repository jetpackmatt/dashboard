require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get a client token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)
    .limit(1)

  const client = clients?.[0]
  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
  if (!token) { console.log('No token'); return }

  // Get a shipment with tracking to see what fields are available
  const res = await fetch('https://api.shipbob.com/2025-07/order?Limit=10&HasTracking=true&SortOrder=Newest', {
    headers: { Authorization: `Bearer ${token}` }
  })
  const orders = await res.json()
  console.log('Found', orders.length, 'orders')

  for (const order of orders) {
    for (const shipment of order.shipments || []) {
      if (shipment.tracking?.tracking_number) {
        console.log('='.repeat(60))
        console.log('Shipment ID:', shipment.id)
        console.log('Status:', shipment.status)
        console.log('Tracking #:', shipment.tracking?.tracking_number)
        console.log('\nFull tracking object:')
        console.log(JSON.stringify(shipment.tracking, null, 2))
        console.log('\nFull shipment object keys:', Object.keys(shipment))

        // Check if there's a tracking_events or history field
        if (shipment.tracking_events) console.log('tracking_events:', shipment.tracking_events)
        if (shipment.tracking_history) console.log('tracking_history:', shipment.tracking_history)
        if (shipment.events) console.log('events:', shipment.events)

        // Try fetching shipment directly for more details
        console.log('\nTrying direct shipment fetch...')
        const shipRes = await fetch(`https://api.shipbob.com/2025-07/shipment/${shipment.id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (shipRes.ok) {
          const shipData = await shipRes.json()
          console.log('Direct shipment keys:', Object.keys(shipData))
          if (shipData.tracking) console.log('Direct tracking:', JSON.stringify(shipData.tracking, null, 2))
        } else {
          console.log('Direct fetch status:', shipRes.status)
        }

        return // Just one example
      }
    }
  }
}
main().catch(console.error)
