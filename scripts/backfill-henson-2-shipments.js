/**
 * Backfill event_created for 2 specific Henson shipments
 * These have event_labeled but missing event_created
 *
 * Usage: node scripts/backfill-henson-2-shipments.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPMENT_IDS = ['323229819', '323235468']

const EVENT_MAP = {
  601: 'event_created',
  602: 'event_picked',
  603: 'event_packed',
  604: 'event_labeled',
  605: 'event_labelvalidated',
  607: 'event_intransit',
  608: 'event_outfordelivery',
  609: 'event_delivered',
  611: 'event_deliveryattemptfailed',
}

async function fetchTimeline(shipmentId, token) {
  const res = await fetch(`https://api.shipbob.com/2025-07/shipment/${shipmentId}/timeline`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 429) return { rateLimited: true }
  if (res.status === 404) return { notFound: true }
  if (!res.ok) {
    console.log(`   API error for ${shipmentId}: ${res.status} ${res.statusText}`)
    return null
  }
  return res.json()
}

async function main() {
  console.log('='.repeat(60))
  console.log('BACKFILL: 2 Henson shipments missing event_created')
  console.log('='.repeat(60))

  // Get Henson client with token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .ilike('company_name', '%henson%')

  const client = clients?.[0]
  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token

  if (!token) {
    console.error('No Henson API token found')
    process.exit(1)
  }

  console.log('Client:', client.company_name)
  console.log('Shipments to backfill:', SHIPMENT_IDS.join(', '))

  for (const shipmentId of SHIPMENT_IDS) {
    console.log(`\nFetching timeline for shipment ${shipmentId}...`)

    const timeline = await fetchTimeline(shipmentId, token)

    if (timeline?.rateLimited) {
      console.log('   Rate limited! Waiting 5s...')
      await new Promise(r => setTimeout(r, 5000))
      continue
    }

    if (timeline?.notFound) {
      console.log('   Not found in API (404)')
      continue
    }

    if (!timeline || timeline.length === 0) {
      console.log('   Empty timeline returned')
      continue
    }

    console.log(`   Got ${timeline.length} events`)

    const update = {}
    for (const event of timeline) {
      const col = EVENT_MAP[event.log_type_id]
      if (col && event.timestamp) {
        update[col] = event.timestamp
        console.log(`   ${col}: ${event.timestamp}`)
      }
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update(update)
        .eq('shipment_id', shipmentId)

      if (error) {
        console.log(`   ERROR updating: ${error.message}`)
      } else {
        console.log(`   Updated ${Object.keys(update).length} fields`)
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('COMPLETE')
  console.log('='.repeat(60))
}

main().catch(console.error)
