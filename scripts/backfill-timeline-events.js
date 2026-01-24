// Script to backfill missing event_labeled from Timeline API
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// Shipments missing event_labeled
const SHIPMENTS_TO_CHECK = ['329113958', '329328123']

async function getHensonToken() {
  const { data, error } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_CLIENT_ID)
    .single()

  if (error) throw error
  return data.api_token
}

async function fetchTimeline(token, shipmentId) {
  const url = `https://api.shipbob.com/2.0/shipment/${shipmentId}/timeline`
  console.log(`Fetching timeline for shipment ${shipmentId}...`)

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    console.error(`Failed to fetch timeline for ${shipmentId}: ${response.status}`)
    return null
  }

  return response.json()
}

async function fetchShipment(token, shipmentId) {
  const url = `https://api.shipbob.com/2.0/shipment/${shipmentId}`
  console.log(`Fetching shipment ${shipmentId}...`)

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    console.error(`Failed to fetch shipment ${shipmentId}: ${response.status}`)
    return null
  }

  return response.json()
}

async function main() {
  console.log('=== Backfill Timeline Events ===\n')

  const token = await getHensonToken()
  console.log('Got Henson API token\n')

  for (const shipmentId of SHIPMENTS_TO_CHECK) {
    console.log(`\n--- Shipment ${shipmentId} ---`)

    // First check current DB state
    const { data: dbShipment } = await supabase
      .from('shipments')
      .select('shipment_id, status, event_created, event_labeled, event_intransit, event_delivered, tracking_id')
      .eq('shipment_id', shipmentId)
      .single()

    console.log('\nCurrent DB state:')
    console.log(`  Status: ${dbShipment?.status}`)
    console.log(`  event_created: ${dbShipment?.event_created}`)
    console.log(`  event_labeled: ${dbShipment?.event_labeled}`)
    console.log(`  event_intransit: ${dbShipment?.event_intransit}`)
    console.log(`  event_delivered: ${dbShipment?.event_delivered}`)
    console.log(`  tracking_id: ${dbShipment?.tracking_id}`)

    // Fetch from API
    const shipment = await fetchShipment(token, shipmentId)
    if (shipment) {
      console.log('\nAPI Shipment data:')
      console.log(`  Status: ${shipment.status}`)
      console.log(`  Tracking: ${shipment.tracking?.tracking_number}`)
      console.log(`  Actual Delivery: ${shipment.actual_delivery_date}`)
      console.log(`  Estimated Delivery: ${shipment.estimated_delivery_date}`)
    }

    // Fetch timeline
    const timeline = await fetchTimeline(token, shipmentId)
    if (timeline) {
      console.log('\nRaw timeline response:')
      console.log(JSON.stringify(timeline[0], null, 2)) // Log first event to see structure

      console.log('\nTimeline events from API:')
      if (Array.isArray(timeline) && timeline.length > 0) {
        for (const event of timeline) {
          // Try different possible field names
          const status = event.status || event.Status || event.event_type || event.EventType || event.type || event.Type || Object.keys(event).find(k => k !== 'timestamp' && k !== 'Timestamp')
          console.log(`  ${event.timestamp || event.Timestamp}: ${status} (keys: ${Object.keys(event).join(', ')})`)
        }

        // Extract events - use log_type_text field
        const events = {}
        for (const e of timeline) {
          const eventText = (e.log_type_text || e.log_type_name || '').toLowerCase()
          console.log(`    Checking: "${eventText}"`)
          if (eventText.includes('created')) events.event_created = e.timestamp
          if (eventText.includes('label') && !events.event_labeled) events.event_labeled = e.timestamp
          if (eventText.includes('transit') || eventText.includes('picked up') || eventText.includes('scanned')) events.event_intransit = e.timestamp
          if (eventText.includes('delivered')) events.event_delivered = e.timestamp
        }

        console.log('\nParsed events:', events)

        // Build update object
        const updateData = {}
        if (events.event_labeled) updateData.event_labeled = events.event_labeled
        if (events.event_intransit) updateData.event_intransit = events.event_intransit
        if (events.event_delivered) updateData.event_delivered = events.event_delivered

        // Also update status from shipment API
        if (shipment?.status) updateData.status = shipment.status

        if (Object.keys(updateData).length > 0) {
          console.log('\n>>> UPDATING shipment with:', updateData)
          const { error } = await supabase
            .from('shipments')
            .update(updateData)
            .eq('shipment_id', shipmentId)

          if (error) {
            console.error('Error updating:', error.message)
          } else {
            console.log('Updated successfully!')
          }
        } else {
          console.log('\nNo updates needed - shipment may not have been labeled yet')
        }
      } else {
        console.log('  No timeline events found')
      }
    }
  }

  console.log('\n\n=== Done ===')
}

main().catch(console.error)
