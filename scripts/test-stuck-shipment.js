require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // Pick shipment 322191747 which has outfordelivery but no delivered
  const shipmentId = '323249734'

  // Get client token for Henson (since these are their shipments)
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .ilike('company_name', '%Henson%')
    .single()

  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
  if (token === null || token === undefined) {
    console.log('No token found')
    return
  }

  console.log('Testing shipment', shipmentId, 'from', client.company_name)

  // Fetch timeline from API
  const res = await fetch('https://api.shipbob.com/1.0/shipment/' + shipmentId + '/timeline', {
    headers: { Authorization: 'Bearer ' + token }
  })

  if (res.status !== 200) {
    console.log('API error:', res.status, res.statusText)
    return
  }

  const timeline = await res.json()
  console.log('\nRaw API response (first event):')
  if (timeline.length > 0) {
    console.log(JSON.stringify(timeline[0], null, 2))
  }
  console.log('\nAll events:')
  for (const event of timeline) {
    console.log('  -', JSON.stringify(event))
  }

  // Check if there's a Delivered event
  const hasDelivered = timeline.some(e => (e.status || '').toLowerCase().includes('delivered') || (e.event_type || '').toLowerCase().includes('delivered'))
  console.log('\nHas Delivered event:', hasDelivered)
}
main()
