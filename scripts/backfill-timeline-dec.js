/**
 * Backfill timeline ONLY for Dec 1-7 period (tomorrow's invoice)
 * Target: ~635 Henson shipments
 *
 * Usage: node scripts/backfill-timeline-dec.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BATCH_SIZE = 5  // Conservative to avoid rate limits
const DELAY_MS = 200  // 5 req/sec

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
  if (!res.ok) return null
  return res.json()
}

async function processShipment(ship, token) {
  const timeline = await fetchTimeline(ship.shipment_id, token)

  if (timeline?.rateLimited) return { rateLimited: true }

  const update = {}
  if (timeline && timeline.length > 0) {
    for (const event of timeline) {
      const col = EVENT_MAP[event.log_type_id]
      if (col && event.timestamp) {
        update[col] = event.timestamp
      }
    }
  }

  // Mark as checked even if no data
  if (Object.keys(update).length === 0) {
    update.event_logs = {}
  }

  await supabase.from('shipments').update(update).eq('id', ship.id)
  return { success: true, hasData: Object.keys(update).length > 0 }
}

async function main() {
  console.log('='.repeat(60))
  console.log('BACKFILL: Dec 1-7 period (tomorrow\'s invoice)')
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

  // Count shipments needing backfill in Dec 1-7
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .gte('created_at', '2025-12-01')
    .lt('created_at', '2025-12-08')
    .is('event_created', null)

  console.log('Shipments needing backfill:', count)

  if (count === 0) {
    console.log('All Dec 1-7 shipments already have event_created!')
    return
  }

  const startTime = Date.now()
  let processed = 0
  let withData = 0
  let rateLimitWaits = 0

  while (processed < count) {
    // Get next batch
    const { data: batch } = await supabase
      .from('shipments')
      .select('id, shipment_id')
      .eq('client_id', client.id)
      .gte('created_at', '2025-12-01')
      .lt('created_at', '2025-12-08')
      .is('event_created', null)
      .limit(BATCH_SIZE)

    if (!batch || batch.length === 0) break

    for (const ship of batch) {
      const result = await processShipment(ship, token)

      if (result?.rateLimited) {
        rateLimitWaits++
        const wait = Math.min(5000 * rateLimitWaits, 30000)
        console.log(`\nRate limited, waiting ${wait/1000}s...`)
        await new Promise(r => setTimeout(r, wait))
      } else {
        rateLimitWaits = Math.max(0, rateLimitWaits - 1)
        processed++
        if (result?.hasData) withData++
      }

      await new Promise(r => setTimeout(r, DELAY_MS))
    }

    const elapsed = (Date.now() - startTime) / 1000
    const rate = processed / elapsed
    const eta = (count - processed) / rate

    process.stdout.write(`\r[${Math.round(processed/count*100)}%] ${processed}/${count} | ${rate.toFixed(1)}/sec | ETA: ${Math.round(eta)}s | with data: ${withData}`)
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n${'='.repeat(60)}`)
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log('Duration:', duration, 'seconds')
  console.log('Processed:', processed)
  console.log('With timeline data:', withData)
}

main().catch(console.error)
