#!/usr/bin/env node
/**
 * Timeline Events Backfill Script
 *
 * Backfills timeline event data (event_created, event_picked, event_packed,
 * event_labeled, event_labelvalidated, event_intransit, event_outfordelivery,
 * event_delivered, event_deliveryattemptfailed, event_logs) for historical shipments.
 *
 * Usage:
 *   node scripts/backfill-timeline-events.js [options]
 *
 * Options:
 *   --batch-size=N    Number of shipments per batch (default: 1000, max Supabase allows)
 *   --delay=N         Delay between API calls in ms (default: 30)
 *   --client=ID       Only process shipments for this client ID
 *   --dry-run         Don't write to database, just log what would be done
 *   --only-missing    Only process shipments where event_created IS NULL (default)
 *   --all             Process all shipments, even those with existing timeline data
 *   --no-loop         Process single batch only (default: loop until all done)
 *
 * Examples:
 *   node scripts/backfill-timeline-events.js --client=6b94c274-0446-4167-9d02-b998f8be59ad
 *   node scripts/backfill-timeline-events.js --dry-run --no-loop
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const BATCH_SIZE = 1000 // Supabase max limit

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

// Parse command line arguments
function parseArgs() {
  const args = {
    delay: 30,
    clientId: null,
    dryRun: false,
    onlyMissing: true,
    loop: true,
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--delay=')) {
      args.delay = parseInt(arg.split('=')[1]) || 30
    } else if (arg.startsWith('--client=')) {
      args.clientId = arg.split('=')[1]
    } else if (arg === '--dry-run') {
      args.dryRun = true
    } else if (arg === '--only-missing') {
      args.onlyMissing = true
    } else if (arg === '--all') {
      args.onlyMissing = false
    } else if (arg === '--no-loop') {
      args.loop = false
    }
  }

  return args
}

async function fetchShipmentTimeline(shipmentId, token) {
  try {
    const res = await fetch(`${SHIPBOB_API_BASE}/shipment/${shipmentId}/timeline`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 429) {
      console.log(`  [Rate limited] Waiting 60s...`)
      await new Promise(r => setTimeout(r, 60000))
      return fetchShipmentTimeline(shipmentId, token) // Retry
    }

    if (res.status === 404) {
      return { eventColumns: {}, eventLogs: [] }
    }

    if (!res.ok) {
      console.error(`  [Error] Shipment ${shipmentId}: ${res.status} ${res.statusText}`)
      return null
    }

    const timeline = await res.json()
    if (!timeline || timeline.length === 0) {
      return { eventColumns: {}, eventLogs: [] }
    }

    // Map timeline events to database columns
    const eventColumns = {}
    for (const event of timeline) {
      const col = TIMELINE_EVENT_MAP[event.log_type_id]
      if (col && event.timestamp) {
        eventColumns[col] = event.timestamp
      }
    }

    return { eventColumns, eventLogs: timeline }
  } catch (e) {
    console.error(`  [Error] Shipment ${shipmentId}:`, e.message)
    return null
  }
}

async function main() {
  const args = parseArgs()
  const startTime = Date.now()

  console.log('=== Timeline Events Backfill ===')
  console.log(`Delay: ${args.delay}ms`)
  console.log(`Client filter: ${args.clientId || 'all'}`)
  console.log(`Mode: ${args.onlyMissing ? 'only-missing' : 'all'}`)
  console.log(`Loop: ${args.loop ? 'yes (until all done)' : 'no (single batch)'}`)
  console.log(`Dry run: ${args.dryRun}`)
  console.log('')

  // Initialize Supabase client
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Get all clients with their tokens
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  if (clientsError) {
    console.error('Error fetching clients:', clientsError.message)
    process.exit(1)
  }

  const clientTokens = {}
  const clientNames = {}
  for (const c of clients || []) {
    const creds = c.client_api_credentials
    const token = creds?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientTokens[c.id] = token
      clientNames[c.id] = c.company_name
    }
  }

  console.log(`Found ${Object.keys(clientTokens).length} clients with ShipBob tokens`)
  console.log('')

  // Total counters across all batches
  let totalUpdated = 0
  let totalSkipped = 0
  let totalErrors = 0
  let totalProcessed = 0
  let batchNumber = 0

  // Loop until no more shipments to process
  while (true) {
    batchNumber++

    // Build query for shipments needing backfill
    let query = supabase
      .from('shipments')
      .select('id, shipment_id, client_id, status')
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    if (args.onlyMissing) {
      query = query.is('event_created', null)
    }

    if (args.clientId) {
      query = query.eq('client_id', args.clientId)
    }

    const { data: shipments, error: shipmentsError } = await query

    if (shipmentsError) {
      console.error('Error fetching shipments:', shipmentsError.message)
      process.exit(1)
    }

    if (!shipments || shipments.length === 0) {
      console.log('')
      console.log('No more shipments to process!')
      break
    }

    console.log(`\n=== Batch ${batchNumber}: ${shipments.length} shipments ===`)

    // Process shipments
    let batchUpdated = 0
    let batchSkipped = 0
    let batchErrors = 0

    for (let i = 0; i < shipments.length; i++) {
      const ship = shipments[i]
      totalProcessed++
      const token = clientTokens[ship.client_id]
      const clientName = clientNames[ship.client_id] || 'Unknown'

      if (!token) {
        console.log(`[${i + 1}/${shipments.length}] Skipping ${ship.shipment_id} - no token for client ${ship.client_id}`)
        batchSkipped++
        totalSkipped++
        continue
      }

      console.log(`[${i + 1}/${shipments.length}] Processing ${ship.shipment_id} (${clientName})...`)

      const timelineResult = await fetchShipmentTimeline(ship.shipment_id, token)

      if (timelineResult === null) {
        batchErrors++
        totalErrors++
        continue
      }

      if (Object.keys(timelineResult.eventColumns).length === 0 && timelineResult.eventLogs.length === 0) {
        console.log(`  No timeline data (Processing/Exception status)`)
        batchSkipped++
        totalSkipped++
        continue
      }

      // Build update object
      const updateData = {
        ...timelineResult.eventColumns,
      }

      if (timelineResult.eventLogs.length > 0) {
        updateData.event_logs = timelineResult.eventLogs
      }

      // Calculate transit_time_days when we have both intransit and delivered timestamps
      const intransitDate = timelineResult.eventColumns.event_intransit
      const deliveredDate = timelineResult.eventColumns.event_delivered
      if (intransitDate && deliveredDate) {
        const intransit = new Date(intransitDate).getTime()
        const delivered = new Date(deliveredDate).getTime()
        const transitMs = delivered - intransit
        const transitDays = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10 // Round to 1 decimal
        if (transitDays >= 0) {
          updateData.transit_time_days = transitDays
        }
      }

      const eventCount = Object.keys(timelineResult.eventColumns).length
      console.log(`  Found ${eventCount} events: ${Object.keys(timelineResult.eventColumns).join(', ')}`)

      if (args.dryRun) {
        console.log(`  [DRY RUN] Would update`)
        batchUpdated++
        totalUpdated++
      } else {
        const { error } = await supabase
          .from('shipments')
          .update(updateData)
          .eq('id', ship.id)

        if (error) {
          console.error(`  [Error] Update failed: ${error.message}`)
          batchErrors++
          totalErrors++
        } else {
          console.log(`  Updated successfully`)
          batchUpdated++
          totalUpdated++
        }
      }

      // Delay between API calls
      await new Promise(r => setTimeout(r, args.delay))
    }

    console.log(`\nBatch ${batchNumber} complete: ${batchUpdated} updated, ${batchSkipped} skipped, ${batchErrors} errors`)
    console.log(`Running total: ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`)

    // If not looping, break after first batch
    if (!args.loop) {
      break
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log('')
  console.log('=== Final Summary ===')
  console.log(`Total processed: ${totalProcessed}`)
  console.log(`Total updated: ${totalUpdated}`)
  console.log(`Total skipped: ${totalSkipped}`)
  console.log(`Total errors: ${totalErrors}`)
  console.log(`Duration: ${duration}s (${Math.round(duration / 60)}m)`)
}

main().catch(console.error)
