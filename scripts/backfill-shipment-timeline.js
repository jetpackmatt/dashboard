/**
 * Backfill timeline event columns AND event_logs for existing shipments
 *
 * Fetches from TWO ShipBob APIs per shipment:
 *
 * 1. Timeline API: GET /shipment/{id}/timeline
 *    Populates timestamp columns:
 *    - event_created (601)
 *    - event_picked (602)
 *    - event_packed (603)
 *    - event_labeled (604)
 *    - event_labelvalidated (605)
 *    - event_intransit (607) - TRUE shipped date
 *    - event_outfordelivery (608)
 *    - event_delivered (609)
 *    - event_deliveryattemptfailed (611)
 *
 * 2. Logs API: GET /order/{orderId}/shipment/{shipmentId}/logs
 *    Populates event_logs JSONB column with full activity history
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Map log_type_id to column name for Timeline API
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
  if (!res.ok) return null
  return res.json()
}

async function fetchLogs(orderId, shipmentId, token) {
  const res = await fetch(`https://api.shipbob.com/2025-07/order/${orderId}/shipment/${shipmentId}/logs`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return null
  return res.json()
}

async function main() {
  console.log('='.repeat(70))
  console.log('BACKFILL SHIPMENT TIMELINE & LOGS')
  console.log('='.repeat(70))

  // Get all clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')

  const clientTokens = {}
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientTokens[c.id] = { token, name: c.company_name }
    }
  }
  console.log('Clients with tokens:', Object.keys(clientTokens).length)

  // Count shipments needing backfill (no event_intransit yet = not processed)
  // We use event_intransit as a marker since it's the key field we want
  const { count: needsBackfill } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)

  console.log('Shipments without event_intransit:', needsBackfill)

  if (needsBackfill === 0) {
    console.log('\nAll shipments already have timeline data!')
    return
  }

  // Process in batches
  const batchSize = 100
  let processed = 0
  let updated = 0
  let errors = 0
  let noTimeline = 0
  let noLogs = 0

  while (processed < needsBackfill) {
    // Get batch of shipments - need shipbob_order_id for logs API
    const { data: batch } = await supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, client_id, status')
      .is('event_intransit', null)
      .order('created_at', { ascending: false })
      .limit(batchSize)

    if (!batch || batch.length === 0) break

    for (const ship of batch) {
      const clientInfo = clientTokens[ship.client_id]
      if (!clientInfo) {
        errors++
        processed++
        continue
      }

      try {
        // Fetch BOTH timeline and logs in parallel
        const [timeline, logs] = await Promise.all([
          fetchTimeline(ship.shipment_id, clientInfo.token),
          ship.shipbob_order_id ? fetchLogs(ship.shipbob_order_id, ship.shipment_id, clientInfo.token) : null
        ])

        // Build update object
        const update = {}

        // Process timeline events -> individual columns
        if (timeline && timeline.length > 0) {
          for (const event of timeline) {
            const col = EVENT_MAP[event.log_type_id]
            if (col && event.timestamp) {
              update[col] = event.timestamp
            }
          }
        } else {
          noTimeline++
        }

        // Store logs as JSONB array
        if (logs && logs.length > 0) {
          update.event_logs = logs
        } else {
          noLogs++
        }

        // Apply update if we have anything
        if (Object.keys(update).length > 0) {
          const { error } = await supabase
            .from('shipments')
            .update(update)
            .eq('id', ship.id)

          if (error) {
            errors++
          } else {
            updated++
          }
        } else {
          // No data but mark as "processed" by setting event_created to null explicitly
          // Actually, skip - we'll get timeline later when shipment progresses
        }

        processed++

        // Rate limit: ~10 requests/sec (we make 2 per shipment, so ~5 shipments/sec)
        await new Promise(r => setTimeout(r, 200))

      } catch (e) {
        errors++
        processed++
      }

      if (processed % 50 === 0) {
        const pct = Math.round(processed / needsBackfill * 100)
        process.stdout.write(`\r[${pct}%] Processed ${processed}/${needsBackfill} | updated: ${updated} | noTimeline: ${noTimeline} | noLogs: ${noLogs} | errors: ${errors}`)
      }
    }
  }

  console.log(`\n\n${'='.repeat(70)}`)
  console.log('BACKFILL COMPLETE')
  console.log('='.repeat(70))
  console.log('Processed:', processed)
  console.log('Updated:', updated)
  console.log('No timeline data:', noTimeline)
  console.log('No logs data:', noLogs)
  console.log('Errors:', errors)

  // Verify
  const { count: stillNull } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('event_intransit', null)

  const { count: withLogs } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('event_logs', 'is', null)

  console.log('\nRemaining without event_intransit:', stillNull)
  console.log('Shipments with event_logs populated:', withLogs)
}

main().catch(console.error)
