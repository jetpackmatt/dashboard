#!/usr/bin/env node
/**
 * Backfill missing timeline data for shipments with proper rate limit handling.
 *
 * IMPORTANT: Uses each client's own API token from client_api_credentials,
 * NOT the SHIPBOB_API_TOKEN from .env.local.
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BASE_URL = 'https://api.shipbob.com/2025-07'

// Rate limit settings
const DELAY_BETWEEN_REQUESTS = 200 // 200ms between requests
const RATE_LIMIT_WAIT = 65000 // Wait 65 seconds on rate limit
const MAX_RETRIES = 3

// Map ShipBob timeline log_type_id to database column names
const TIMELINE_EVENT_MAP = {
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchTimelineWithRetry(shipmentId, token, retries = 0) {
  try {
    const res = await fetch(`${BASE_URL}/shipment/${shipmentId}/timeline`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
    })

    if (res.status === 429) {
      if (retries < MAX_RETRIES) {
        console.log(`    Rate limited on ${shipmentId}, waiting ${RATE_LIMIT_WAIT/1000}s (retry ${retries + 1}/${MAX_RETRIES})...`)
        await sleep(RATE_LIMIT_WAIT)
        return fetchTimelineWithRetry(shipmentId, token, retries + 1)
      }
      console.log(`    Rate limited on ${shipmentId}, max retries exceeded`)
      return null
    }

    if (res.status === 404) {
      return []
    }

    if (!res.ok) {
      console.log(`    API error ${res.status} on ${shipmentId}`)
      return null
    }

    const timeline = await res.json()
    return Array.isArray(timeline) ? timeline : []
  } catch (err) {
    console.log(`    Fetch error on ${shipmentId}: ${err.message}`)
    return null
  }
}

function extractTimelineEvents(timeline) {
  if (!timeline || timeline.length === 0) return {}

  const events = {}
  for (const event of timeline) {
    const col = TIMELINE_EVENT_MAP[event.log_type_id]
    if (col && event.timestamp) {
      events[col] = event.timestamp
    }
  }
  return events
}

async function main() {
  console.log('Backfilling timeline data for shipments...\n')

  // Get clients with their ShipBob tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  const clientTokens = {}
  for (const client of clients || []) {
    const creds = client.client_api_credentials
    const shipbobCred = creds?.find(c => c.provider === 'shipbob')
    if (shipbobCred?.api_token) {
      clientTokens[client.id] = { token: shipbobCred.api_token, name: client.company_name }
    }
  }

  console.log(`Found API tokens for ${Object.keys(clientTokens).length} clients\n`)

  // Get shipments missing timeline data (Dec 1-7 period)
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, shipment_id, client_id')
    .or('event_labeled.is.null,event_created.is.null')
    .gte('created_at', '2025-12-01')
    .lt('created_at', '2025-12-08')
    .order('client_id', { ascending: true })
    .order('shipment_id', { ascending: true })

  if (error) {
    console.error('Error fetching shipments:', error)
    return
  }

  console.log(`Found ${shipments.length} shipments needing timeline data\n`)

  const stats = {
    total: shipments.length,
    updated: 0,
    skipped: 0,
    errors: 0,
    noToken: 0
  }

  let currentClient = null

  for (let i = 0; i < shipments.length; i++) {
    const shipment = shipments[i]
    const progress = `[${i + 1}/${shipments.length}]`

    // Get token for this client
    const clientInfo = clientTokens[shipment.client_id]
    if (!clientInfo) {
      if (currentClient !== shipment.client_id) {
        console.log(`${progress} Skipping shipments for client ${shipment.client_id} - no API token`)
        currentClient = shipment.client_id
      }
      stats.noToken++
      continue
    }

    // Log when switching clients
    if (currentClient !== shipment.client_id) {
      currentClient = shipment.client_id
      console.log(`\n--- Processing ${clientInfo.name} ---\n`)
    }

    // Add delay between requests
    if (i > 0) {
      await sleep(DELAY_BETWEEN_REQUESTS)
    }

    const timeline = await fetchTimelineWithRetry(shipment.shipment_id, clientInfo.token)

    if (timeline === null) {
      stats.errors++
      continue
    }

    const events = extractTimelineEvents(timeline)

    if (Object.keys(events).length === 0) {
      console.log(`${progress} Shipment ${shipment.shipment_id}: no timeline events`)
      stats.skipped++
      continue
    }

    // Update shipment with timeline events
    const { error: updateError } = await supabase
      .from('shipments')
      .update(events)
      .eq('id', shipment.id)

    if (updateError) {
      console.error(`${progress} Error updating ${shipment.shipment_id}:`, updateError.message)
      stats.errors++
    } else {
      const eventTypes = Object.keys(events).map(k => k.replace('event_', '')).join(', ')
      console.log(`${progress} Shipment ${shipment.shipment_id}: ${eventTypes}`)
      stats.updated++
    }

    // Progress update every 100 shipments
    if ((i + 1) % 100 === 0) {
      console.log(`\n--- Progress: ${i + 1}/${shipments.length} (${stats.updated} updated, ${stats.skipped} skipped, ${stats.errors} errors) ---\n`)
    }
  }

  console.log('\n========================================')
  console.log('BACKFILL COMPLETE')
  console.log('========================================')
  console.log(`Total shipments: ${stats.total}`)
  console.log(`Updated: ${stats.updated}`)
  console.log(`Skipped (no events): ${stats.skipped}`)
  console.log(`No token: ${stats.noToken}`)
  console.log(`Errors: ${stats.errors}`)
}

main().catch(console.error)
