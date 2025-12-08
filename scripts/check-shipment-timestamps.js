/**
 * Check shipment timestamps: compare our DB vs ShipBob API
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const parentToken = process.env.SHIPBOB_API_TOKEN

  // Get a random shipment ID from our DB
  const { data: sample } = await supabase
    .from('shipments')
    .select('shipment_id, created_at')
    .limit(1)

  if (!sample || sample.length === 0) {
    console.log('No shipments in DB')
    return
  }

  const shipmentId = sample[0].shipment_id
  console.log('=== Our DB shipment ===')
  console.log(`ID: ${shipmentId}, created_at: ${sample[0].created_at}`)

  // Fetch from ShipBob API
  const response = await fetch(`https://api.shipbob.com/2025-07/shipment/${shipmentId}`, {
    headers: { 'Authorization': 'Bearer ' + parentToken }
  })

  if (response.ok) {
    const ship = await response.json()
    console.log('')
    console.log('=== ShipBob API raw data ===')
    console.log(JSON.stringify({
      id: ship.id,
      created_date: ship.created_date,
      actual_fulfillment_date: ship.actual_fulfillment_date,
      last_update_at: ship.last_update_at,
      estimated_fulfillment_date: ship.estimated_fulfillment_date
    }, null, 2))
  } else {
    console.log(`API error: ${response.status} ${response.statusText}`)
  }
}
main().catch(console.error)
