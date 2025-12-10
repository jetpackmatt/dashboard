require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // Get client token for one of these shipments
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_api_credentials(api_token, provider)')

  const tokenMap = {}
  for (const c of clients) {
    const token = c.client_api_credentials?.find(cr => cr.provider === 'shipbob')?.api_token
    if (token) tokenMap[c.id] = token
  }

  // Test old shipment that has Delivered in status_details but no event_delivered
  const shipmentId = 246417743  // From Nov 27
  const { data: shipment } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, status, status_details')
    .eq('shipment_id', shipmentId)
    .single()

  console.log('Shipment:', shipment.shipment_id, '| status:', shipment.status)
  console.log('status_details:', JSON.stringify(shipment.status_details))

  const token = tokenMap[shipment.client_id]
  if (!token) {
    console.log('No token')
    return
  }

  // Fetch timeline
  const res = await fetch('https://api.shipbob.com/1.0/shipment/' + shipmentId + '/timeline', {
    headers: { Authorization: 'Bearer ' + token }
  })

  const timeline = await res.json()
  console.log('\nTimeline API response:')

  if (timeline.statusCode === 429) {
    console.log('Rate limited, try again later')
    return
  }

  for (const event of timeline) {
    console.log('  ', event.log_type_name, '|', event.timestamp)
  }

  const delivered = timeline.find(e => e.log_type_name === 'Delivered')
  console.log('\nHas Delivered event?', delivered ? 'YES' : 'NO')
}
main()
