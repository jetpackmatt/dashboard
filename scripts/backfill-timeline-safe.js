/**
 * SAFE Backfill timeline event columns with aggressive rate limit handling
 *
 * Features:
 * 1. Sequential processing (no parallelism)
 * 2. Respects rate limits with exponential backoff
 * 3. 1 second delay between requests
 * 4. Starts from a cursor to allow resuming
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BASE_DELAY_MS = 1000  // 1 second between requests
const RATE_LIMIT_WAIT_MS = 60000  // 60 seconds on 429
const MAX_RETRIES = 5

const EVENT_MAP = {
  601: 'event_created',
  602: 'event_picked',
  603: 'event_packed',
  604: 'event_labeled',
  605: 'event_labelvalidated',
  // 606 (PreTransit) - column doesn't exist in DB
  607: 'event_intransit',
  608: 'event_outfordelivery',
  609: 'event_delivered',
  611: 'event_deliveryattemptfailed',
}

async function fetchWithRetry(url, token, retries = 0) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (res.status === 429) {
    if (retries >= MAX_RETRIES) {
      console.log(`\n  MAX RETRIES reached for ${url}`)
      return null
    }
    const waitTime = RATE_LIMIT_WAIT_MS * (retries + 1)
    console.log(`\n  429 Rate limited - waiting ${waitTime/1000}s (retry ${retries + 1}/${MAX_RETRIES})...`)
    await new Promise(r => setTimeout(r, waitTime))
    return fetchWithRetry(url, token, retries + 1)
  }

  if (!res.ok) {
    // Don't log 404s for logs API - some shipments don't have logs
    if (res.status !== 404) {
      console.log(`\n  API error ${res.status} for ${url}`)
    }
    return null
  }

  return res.json()
}

async function processShipment(ship, token) {
  const [timeline, logs] = await Promise.all([
    fetchWithRetry(`https://api.shipbob.com/2025-07/shipment/${ship.shipment_id}/timeline`, token),
    ship.shipbob_order_id
      ? fetchWithRetry(`https://api.shipbob.com/2025-07/order/${ship.shipbob_order_id}/shipment/${ship.shipment_id}/logs`, token)
      : null
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

  // Only update event_logs if we got data and don't already have it
  if (logs && logs.length > 0 && !ship.event_logs) {
    update.event_logs = logs
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase
      .from('shipments')
      .update(update)
      .eq('id', ship.id)

    if (error) {
      console.log(`\n  DB error for ${ship.shipment_id}: ${error.message}`)
      return { error: true }
    }
    return { updated: true, hasIntransit, fields: Object.keys(update).length }
  }

  return { updated: false, noData: true }
}

async function main() {
  const startShipmentId = parseInt(process.argv[2]) || 0

  console.log('='.repeat(70))
  console.log('SAFE BACKFILL: TIMELINE EVENT COLUMNS')
  console.log('='.repeat(70))
  console.log('Mode: Sequential (1 at a time)')
  console.log('Delay: 1 second between API calls')
  console.log('Rate limit handling: 60s wait + exponential backoff')
  if (startShipmentId > 0) {
    console.log('Starting from shipment_id:', startShipmentId)
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

  // Count total needing backfill
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
  let lastShipmentId = startShipmentId

  while (true) {
    // Get ONE shipment at a time
    const { data: batch, error: batchError } = await supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, client_id, event_logs')
      .is('event_intransit', null)
      .gt('shipment_id', lastShipmentId)
      .order('shipment_id', { ascending: true })
      .limit(1)

    if (batchError) {
      console.error('\nBatch fetch error:', batchError.message)
      break
    }

    if (!batch || batch.length === 0) {
      console.log('\nNo more shipments to process')
      break
    }

    const ship = batch[0]
    lastShipmentId = ship.shipment_id

    const token = clientTokens[ship.client_id]
    if (!token) {
      console.log(`\n  No token for client ${ship.client_id}`)
      errors++
      processed++
      continue
    }

    const result = await processShipment(ship, token)

    if (result.error) {
      errors++
    } else if (result.updated) {
      updated++
      if (result.hasIntransit) gotIntransit++
    } else if (result.noData) {
      noData++
    }

    processed++

    const elapsed = (Date.now() - startTime) / 1000
    const rate = processed / elapsed
    const eta = rate > 0 ? Math.round((needsBackfill - processed) / rate / 60) : '?'

    // Progress update every shipment
    process.stdout.write(`\r[${Math.round(processed/needsBackfill*100)}%] ${processed}/${needsBackfill} | ${rate.toFixed(1)}/sec | ETA: ${eta}m | updated: ${updated} | intransit: ${gotIntransit} | noData: ${noData} | err: ${errors} | last: ${lastShipmentId}`)

    // Wait between requests
    await new Promise(r => setTimeout(r, BASE_DELAY_MS))
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
  console.log('Errors:', errors)
  console.log('Last shipment_id:', lastShipmentId)
  console.log('')
  console.log('To resume from this point:')
  console.log(`  node scripts/backfill-timeline-safe.js ${lastShipmentId}`)

  // Verify
  const { count: stillNull } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)

  const { count: hasIntransit } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('event_intransit', 'is', null)

  console.log('\nVERIFICATION:')
  console.log('Shipments with event_intransit:', hasIntransit)
  console.log('Shipments without event_intransit:', stillNull)
}

main().catch(console.error)
