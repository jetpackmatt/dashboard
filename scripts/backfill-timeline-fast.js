/**
 * FAST Backfill timeline - Uses multiple workers per client token
 * Each client token may have separate rate limits
 *
 * Usage: node scripts/backfill-timeline-fast.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WORKERS_PER_CLIENT = 2  // 2 concurrent workers per client (conservative)
const BATCH_SIZE = 20  // Process 20 shipments per worker batch
const MIN_DELAY_MS = 150  // 150ms minimum delay between requests (~6/sec per worker)

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

// Stats per client
const stats = {}

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
  let hasTimeline = false

  if (timeline && timeline.length > 0) {
    hasTimeline = true
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
  return { hasTimeline }
}

const MIN_DATE = '2025-11-17'  // Only process Nov 17+ (recent 3 weeks)

async function workerLoop(clientId, clientName, token, workerId) {
  const key = `${clientName}-${workerId}`
  let processed = 0
  let rateLimitWaits = 0

  while (true) {
    // Get batch for this client - only Nov 17+ shipments
    const { data: batch } = await supabase
      .from('shipments')
      .select('id, shipment_id')
      .eq('client_id', clientId)
      .is('event_intransit', null)
      .is('event_logs', null)
      .gte('created_at', MIN_DATE)
      .limit(BATCH_SIZE)

    if (!batch || batch.length === 0) {
      console.log(`[${key}] Done - no more shipments`)
      break
    }

    for (const ship of batch) {
      const result = await processShipment(ship, token)

      if (result?.rateLimited) {
        rateLimitWaits++
        // Exponential backoff
        const waitTime = Math.min(1000 * Math.pow(2, rateLimitWaits), 30000)
        await new Promise(r => setTimeout(r, waitTime))
      } else {
        rateLimitWaits = Math.max(0, rateLimitWaits - 1)  // Decay
        processed++
        stats[clientName].processed++
        if (result?.hasTimeline) stats[clientName].withData++
      }

      await new Promise(r => setTimeout(r, MIN_DELAY_MS))
    }
  }

  return processed
}

async function main() {
  console.log('='.repeat(70))
  console.log('FAST BACKFILL - Multiple Workers Per Client')
  console.log('='.repeat(70))

  // Get all clients with their own tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')

  const clientsWithTokens = []
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientsWithTokens.push({ id: c.id, name: c.company_name, token })
      stats[c.company_name] = { processed: 0, withData: 0 }
    }
  }

  console.log('Clients:', clientsWithTokens.map(c => c.name).join(', '))
  console.log('Workers per client:', WORKERS_PER_CLIENT)
  console.log('Total workers:', clientsWithTokens.length * WORKERS_PER_CLIENT)

  // Count per client (only Nov 17+)
  console.log('Filter: Only Nov 17+ shipments')
  for (const client of clientsWithTokens) {
    const { count } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('event_intransit', null)
      .is('event_logs', null)
      .gte('created_at', MIN_DATE)
    console.log(`  ${client.name}: ${count} shipments need backfill`)
    stats[client.name].total = count
  }

  console.log('\nStarting workers...\n')

  // Start status reporter
  const startTime = Date.now()
  const statusInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000)
    let totalProcessed = 0
    let totalWithData = 0
    let totalRemaining = 0

    for (const [name, s] of Object.entries(stats)) {
      totalProcessed += s.processed
      totalWithData += s.withData
      totalRemaining += (s.total - s.processed)
    }

    const rate = totalProcessed / elapsed
    const eta = totalRemaining / rate / 60

    process.stdout.write(`\r[${elapsed}s] Processed: ${totalProcessed} | With data: ${totalWithData} | Rate: ${rate.toFixed(1)}/sec | ETA: ${eta.toFixed(0)}m`)
  }, 1000)

  // Launch all workers
  const workerPromises = []
  for (const client of clientsWithTokens) {
    for (let i = 0; i < WORKERS_PER_CLIENT; i++) {
      workerPromises.push(workerLoop(client.id, client.name, client.token, i + 1))
    }
  }

  // Wait for all workers
  await Promise.all(workerPromises)

  clearInterval(statusInterval)

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n${'='.repeat(70)}`)
  console.log('COMPLETE')
  console.log('='.repeat(70))
  console.log('Duration:', duration, 'seconds')

  for (const [name, s] of Object.entries(stats)) {
    console.log(`  ${name}: ${s.processed} processed, ${s.withData} with timeline data`)
  }
}

main().catch(console.error)
