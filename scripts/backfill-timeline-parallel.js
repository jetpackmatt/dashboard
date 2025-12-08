/**
 * PARALLEL Backfill timeline event columns AND event_logs
 * Processes batches with rate limit handling
 *
 * Usage:
 *   node scripts/backfill-timeline-parallel.js              # All shipments (newest first)
 *   node scripts/backfill-timeline-parallel.js --recent     # Last 3 weeks only (Nov 17+)
 *   node scripts/backfill-timeline-parallel.js 12345        # Resume from shipment_id
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CONCURRENCY = 10  // Process 10 shipments at once (safe)
const BATCH_DELAY_MS = 500  // 500ms delay between batches
const RATE_LIMIT_WAIT_MS = 10000  // 10 second wait on rate limit

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

let rateLimitHit = false

async function fetchTimeline(shipmentId, token, retries = 0) {
  const res = await fetch(`https://api.shipbob.com/2025-07/shipment/${shipmentId}/timeline`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 429) {
    rateLimitHit = true
    if (retries < 3) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_WAIT_MS))
      return fetchTimeline(shipmentId, token, retries + 1)
    }
    return null
  }
  if (!res.ok) return null
  return res.json()
}

async function fetchLogs(orderId, shipmentId, token, retries = 0) {
  const res = await fetch(`https://api.shipbob.com/2025-07/order/${orderId}/shipment/${shipmentId}/logs`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 429) {
    rateLimitHit = true
    if (retries < 3) {
      await new Promise(r => setTimeout(r, RATE_LIMIT_WAIT_MS))
      return fetchLogs(orderId, shipmentId, token, retries + 1)
    }
    return null
  }
  if (!res.ok) return null
  return res.json()
}

async function processShipment(ship, token) {
  try {
    const [timeline, logs] = await Promise.all([
      fetchTimeline(ship.shipment_id, token),
      ship.shipbob_order_id ? fetchLogs(ship.shipbob_order_id, ship.shipment_id, token) : null
    ])

    const update = {}
    let hasTimeline = false
    let hasLogs = false

    if (timeline && timeline.length > 0) {
      hasTimeline = true
      for (const event of timeline) {
        const col = EVENT_MAP[event.log_type_id]
        if (col && event.timestamp) {
          update[col] = event.timestamp
        }
      }
    }

    if (logs && logs.length > 0) {
      hasLogs = true
      update.event_logs = logs
    }

    // Always update to mark as checked - use empty object {} if no data found
    // This prevents infinite loop re-fetching same shipments
    if (Object.keys(update).length === 0) {
      // No data found - mark as checked with empty event_logs
      update.event_logs = {}
    }

    await supabase.from('shipments').update(update).eq('id', ship.id)
    return { updated: Object.keys(update).length > 1 || update.event_logs !== {}, hasTimeline, hasLogs }
  } catch (e) {
    return { error: true }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const recentOnly = args.includes('--recent')
  const minDate = recentOnly ? '2025-11-17' : null

  console.log('='.repeat(70))
  console.log('PARALLEL BACKFILL SHIPMENT TIMELINE & LOGS')
  console.log('='.repeat(70))
  console.log('Concurrency:', CONCURRENCY)
  if (minDate) console.log('Filter: Shipments from', minDate, 'onwards')

  // Get all clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')

  const clientTokens = {}
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) clientTokens[c.id] = token
  }
  console.log('Clients with tokens:', Object.keys(clientTokens).length)

  // Count remaining (with date filter if --recent)
  let countQuery = supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)
    .is('event_logs', null)

  if (minDate) countQuery = countQuery.gte('created_at', minDate)

  const { count: needsBackfill } = await countQuery

  console.log('Shipments needing backfill:', needsBackfill)

  if (needsBackfill === 0) {
    console.log('\nAll shipments already have data!')
    return
  }

  const startTime = Date.now()
  let processed = 0
  let updated = 0
  let noTimeline = 0
  let noLogs = 0
  let errors = 0

  while (processed < needsBackfill) {
    // Get batch (with date filter if --recent)
    let batchQuery = supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, client_id')
      .is('event_intransit', null)
      .is('event_logs', null)
      .order('created_at', { ascending: false })
      .limit(CONCURRENCY)

    if (minDate) batchQuery = batchQuery.gte('created_at', minDate)

    const { data: batch } = await batchQuery

    if (!batch || batch.length === 0) break

    // Process batch in parallel
    const results = await Promise.all(
      batch.map(ship => {
        const token = clientTokens[ship.client_id]
        if (!token) return { error: true }
        return processShipment(ship, token)
      })
    )

    // Tally results
    for (const r of results) {
      if (r.error) errors++
      else if (r.updated) updated++
      if (!r.hasTimeline) noTimeline++
      if (!r.hasLogs) noLogs++
    }

    processed += batch.length
    const elapsed = (Date.now() - startTime) / 1000
    const rate = Math.round(processed / elapsed)
    const eta = Math.round((needsBackfill - processed) / rate / 60)

    process.stdout.write(`\r[${Math.round(processed/needsBackfill*100)}%] ${processed}/${needsBackfill} | ${rate}/sec | ETA: ${eta}m | updated: ${updated} | noTL: ${noTimeline} | noLogs: ${noLogs} | err: ${errors}`)

    // Delay between batches to respect rate limits
    if (rateLimitHit) {
      console.log('\n⚠️  Rate limit was hit, waiting 30s...')
      await new Promise(r => setTimeout(r, RATE_LIMIT_WAIT_MS))
      rateLimitHit = false
    } else {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n${'='.repeat(70)}`)
  console.log('COMPLETE')
  console.log('='.repeat(70))
  console.log('Duration:', duration, 'seconds')
  console.log('Processed:', processed)
  console.log('Updated:', updated)
  console.log('Rate:', Math.round(processed / duration), 'shipments/sec')
}

main().catch(console.error)
