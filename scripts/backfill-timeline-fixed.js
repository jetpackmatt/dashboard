/**
 * FIXED Backfill timeline event columns
 *
 * BUG FIX: Previous script only selected shipments where BOTH event_intransit
 * AND event_logs were null. This meant shipments with event_logs but no
 * event_intransit were never re-processed!
 *
 * This version:
 * 1. Queries ALL shipments without event_intransit (regardless of event_logs)
 * 2. Has proper 429 retry with exponential backoff
 * 3. Limited parallelism (5 concurrent requests)
 * 4. Resumable via command line argument
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const CONCURRENCY = 5  // Limited parallelism
const BATCH_DELAY_MS = 1000  // 1 second between batches
const MAX_RETRIES = 3
const RATE_LIMIT_WAIT_MS = 30000  // 30 seconds on 429

const EVENT_MAP = {
  601: 'event_created',
  602: 'event_picked',
  603: 'event_packed',
  604: 'event_labeled',
  605: 'event_labelvalidated',
  // 606: 'event_pretransit',  // Skip - column doesn't exist
  607: 'event_intransit',
  608: 'event_outfordelivery',
  609: 'event_delivered',
  611: 'event_deliveryattemptfailed',
}

async function fetchWithRetry(url, token, retries = 0) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    })

    if (res.status === 429) {
      if (retries >= MAX_RETRIES) return null
      const wait = RATE_LIMIT_WAIT_MS * (retries + 1)
      console.log(`\n  429 on ${url} - waiting ${wait/1000}s (retry ${retries + 1})`)
      await new Promise(r => setTimeout(r, wait))
      return fetchWithRetry(url, token, retries + 1)
    }

    if (!res.ok) {
      // Don't log 404s - some shipments may not have logs
      if (res.status !== 404) {
        console.error(`\n  API error ${res.status} for ${url}`)
      }
      return null
    }
    return res.json()
  } catch (e) {
    console.error(`\n  Fetch error for ${url}:`, e.message)
    return null
  }
}

async function fetchTimeline(shipmentId, token) {
  return fetchWithRetry(`https://api.shipbob.com/2025-07/shipment/${shipmentId}/timeline`, token)
}

async function fetchLogs(orderId, shipmentId, token) {
  return fetchWithRetry(`https://api.shipbob.com/2025-07/order/${orderId}/shipment/${shipmentId}/logs`, token)
}

async function processShipment(ship, token) {
  try {
    const [timeline, logs] = await Promise.all([
      fetchTimeline(ship.shipment_id, token),
      ship.shipbob_order_id ? fetchLogs(ship.shipbob_order_id, ship.shipment_id, token) : null
    ])

    const update = {}
    let hasIntransit = false

    if (timeline && timeline.length > 0) {
      for (const event of timeline) {
        const col = EVENT_MAP[event.log_type_id]
        if (col && event.timestamp) {
          update[col] = event.timestamp
          if (event.log_type_id === 607) hasIntransit = true
        }
      }
    }

    // Only update event_logs if we don't already have it
    if (logs && logs.length > 0 && !ship.has_logs) {
      update.event_logs = logs
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update(update)
        .eq('id', ship.id)

      if (error) {
        console.error(`  DB update error for ${ship.shipment_id}:`, error.message)
        return { error: true, dbError: true }
      }
      return { updated: true, hasIntransit }
    }

    return { updated: false, noData: true }
  } catch (e) {
    console.error(`  Process error for ${ship.shipment_id}:`, e.message)
    return { error: true }
  }
}

async function main() {
  const startShipmentId = parseInt(process.argv[2]) || 0

  console.log('='.repeat(70))
  console.log('FIXED BACKFILL: TIMELINE EVENT COLUMNS')
  console.log('='.repeat(70))
  console.log('Concurrency:', CONCURRENCY)
  console.log('Rate limit handling: 30s wait + exponential backoff')
  if (startShipmentId > 0) {
    console.log('Resuming from shipment_id:', startShipmentId)
  }
  console.log('')

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

  // Count shipments WITHOUT event_intransit (regardless of event_logs)
  const { count: needsBackfill } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)
    .gt('shipment_id', startShipmentId)

  console.log('Shipments needing backfill:', needsBackfill)

  if (needsBackfill === 0) {
    console.log('\nAll shipments already have event_intransit!')
    return
  }

  const startTime = Date.now()
  let processed = 0
  let updated = 0
  let gotIntransit = 0
  let noData = 0
  let errors = 0
  let dbErrors = 0
  let lastShipmentId = startShipmentId

  while (processed < needsBackfill) {
    // Get batch - use cursor-based pagination to avoid re-processing
    const { data: batch, error: batchError } = await supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, client_id, event_logs')
      .is('event_intransit', null)
      .gt('shipment_id', lastShipmentId)
      .order('shipment_id', { ascending: true })
      .limit(CONCURRENCY)

    if (batchError) {
      console.error('\nBatch fetch error:', batchError.message)
      break
    }

    if (!batch || batch.length === 0) {
      console.log('\nNo more shipments to process')
      break
    }

    // Track last shipment for cursor
    lastShipmentId = batch[batch.length - 1].shipment_id

    // Add flag for whether shipment already has logs
    const batchWithFlags = batch.map(s => ({
      ...s,
      has_logs: s.event_logs !== null
    }))

    // Process batch in parallel
    const results = await Promise.all(
      batchWithFlags.map(ship => {
        const token = clientTokens[ship.client_id]
        if (!token) {
          console.error(`  No token for client ${ship.client_id}`)
          return { error: true }
        }
        return processShipment(ship, token)
      })
    )

    // Tally results
    for (const r of results) {
      if (r.error) {
        errors++
        if (r.dbError) dbErrors++
      } else if (r.updated) {
        updated++
        if (r.hasIntransit) gotIntransit++
      } else if (r.noData) {
        noData++
      }
    }

    processed += batch.length
    const elapsed = (Date.now() - startTime) / 1000
    const rate = Math.round(processed / elapsed)
    const eta = rate > 0 ? Math.round((needsBackfill - processed) / rate / 60) : '?'

    process.stdout.write(`\r[${Math.round(processed/needsBackfill*100)}%] ${processed}/${needsBackfill} | ${rate}/sec | ETA: ${eta}m | updated: ${updated} | gotInTransit: ${gotIntransit} | noData: ${noData} | err: ${errors} (db: ${dbErrors})`)

    // Rate limit delay
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n${'='.repeat(70)}`)
  console.log('COMPLETE')
  console.log('='.repeat(70))
  console.log('Duration:', duration, 'seconds')
  console.log('Processed:', processed)
  console.log('Updated:', updated)
  console.log('Got InTransit:', gotIntransit)
  console.log('No data from API:', noData)
  console.log('Errors:', errors, '(DB errors:', dbErrors + ')')
  console.log('Rate:', Math.round(processed / duration), 'shipments/sec')

  // Verify
  console.log('\n' + '='.repeat(70))
  console.log('VERIFICATION')
  console.log('='.repeat(70))

  const { count: stillNull } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)

  const { count: hasIntransit } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('event_intransit', 'is', null)

  console.log('Shipments with event_intransit:', hasIntransit)
  console.log('Shipments without event_intransit:', stillNull)
}

main().catch(console.error)
