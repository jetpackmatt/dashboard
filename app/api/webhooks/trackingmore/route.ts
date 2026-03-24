import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { storeCheckpoints } from '@/lib/trackingmore/checkpoint-storage'
import { isDelivered, isReturned, getLastCheckpointDate, type TrackingMoreTracking } from '@/lib/trackingmore/client'

const RTS_PATTERNS = [
  /returned to sender/i, /returned to shipper/i, /returned to seller/i,
  /return to sender/i, /return in progress/i, /return initiated/i,
  /returninitiated/i, /to original sender/i, /being returned/i,
  /was returned/i, /return to shipper/i,
]

/**
 * POST /api/webhooks/trackingmore
 *
 * Receives push notifications from TrackingMore when tracking status changes.
 * This eliminates our polling delay — we get updates the moment TM has them.
 *
 * Setup: Configure webhook URL in TrackingMore dashboard (Developer > Webhooks)
 * Security: HMAC-SHA256 signature verification using TRACKINGMORE_WEBHOOK_SECRET
 *
 * Flow:
 * 1. Verify signature
 * 2. Parse tracking data from payload
 * 3. Store checkpoints in tracking_checkpoints table
 * 4. If tracking is in lost_in_transit_checks, update monitoring entry
 *    (delivered → remove, RTS → update status, otherwise update last scan)
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.TRACKINGMORE_WEBHOOK_SECRET

  // Read raw body for signature verification
  const rawBody = await request.text()
  let payload: { code: number; message: string; data: Record<string, unknown> }

  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[Webhook TM] Invalid JSON payload')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Verify HMAC-SHA256 signature if secret is configured
  if (webhookSecret) {
    const timestamp = request.headers.get('timestamp')
    const signature = request.headers.get('signature')

    if (!timestamp || !signature) {
      console.error('[Webhook TM] Missing timestamp or signature headers')
      return NextResponse.json({ error: 'Missing auth headers' }, { status: 401 })
    }

    const expectedSignature = createHmac('sha256', webhookSecret)
      .update(timestamp)
      .digest('hex')

    if (signature !== expectedSignature) {
      console.error('[Webhook TM] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  // Extract tracking data from payload
  const data = payload.data
  if (!data || !data.tracking_number) {
    console.error('[Webhook TM] No tracking data in payload')
    return NextResponse.json({ error: 'No tracking data' }, { status: 400 })
  }

  const trackingNumber = data.tracking_number as string
  // Webhook uses courier_code; our interface uses carrier_code
  const courierCode = (data.courier_code as string) || ''
  const deliveryStatus = (data.delivery_status as string) || ''

  console.log(`[Webhook TM] Received update: ${trackingNumber} (${courierCode}) status=${deliveryStatus}`)

  // Map webhook payload to our TrackingMoreTracking interface
  const tracking: TrackingMoreTracking = {
    id: (data.id as string) || '',
    tracking_number: trackingNumber,
    carrier_code: courierCode,
    delivery_status: deliveryStatus,
    created_at: (data.created_at as string) || '',
    updated_at: (data.update_at as string) || (data.updated_at as string) || '',
    original_country: (data.origin_country as string) || null,
    destination_country: (data.destination_country as string) || null,
    origin_info: data.origin_info as TrackingMoreTracking['origin_info'],
    destination_info: data.destination_info as TrackingMoreTracking['destination_info'],
    latest_event: (data.latest_event as string) || null,
    latest_checkpoint_time: (data.latest_checkpoint_time as string) || null,
  }

  const supabase = createAdminClient()

  try {
    // Find this tracking in our system
    // Check lost_in_transit_checks first (Delivery IQ monitored shipments)
    const { data: litEntry } = await supabase
      .from('lost_in_transit_checks')
      .select('id, shipment_id, tracking_number, carrier, claim_eligibility_status, is_international')
      .eq('tracking_number', trackingNumber)
      .limit(1)
      .maybeSingle()

    // Also find the shipment for checkpoint storage
    let shipmentId: string | null = litEntry?.shipment_id || null
    let carrier: string = litEntry?.carrier || courierCode

    if (!shipmentId) {
      // Look up in shipments table
      const { data: shipment } = await supabase
        .from('shipments')
        .select('shipment_id, carrier')
        .eq('tracking_id', trackingNumber)
        .limit(1)
        .maybeSingle()

      if (shipment) {
        shipmentId = shipment.shipment_id
        carrier = shipment.carrier || courierCode
      }
    }

    // Store checkpoints if we have a shipment_id
    let checkpointsStored = 0
    if (shipmentId) {
      try {
        const result = await storeCheckpoints(shipmentId, tracking, carrier)
        checkpointsStored = result.stored
      } catch (err) {
        console.error(`[Webhook TM] Failed to store checkpoints for ${trackingNumber}:`, err)
      }
    }

    // If not in Delivery IQ monitoring, we're done (just stored checkpoints)
    if (!litEntry) {
      console.log(`[Webhook TM] ${trackingNumber}: not in Delivery IQ, stored ${checkpointsStored} checkpoints`)
      return NextResponse.json({ success: true, action: 'checkpoints_only', checkpointsStored })
    }

    // Skip updates for terminal statuses (already resolved)
    const terminalStatuses = ['approved', 'denied', 'missed_window', 'claim_filed']
    if (terminalStatuses.includes(litEntry.claim_eligibility_status)) {
      console.log(`[Webhook TM] ${trackingNumber}: status=${litEntry.claim_eligibility_status}, skipping update`)
      return NextResponse.json({ success: true, action: 'skipped_terminal', checkpointsStored })
    }

    // Process the tracking update for Delivery IQ
    const delivered = isDelivered(tracking)
    const returned = isReturned(tracking)

    if (delivered) {
      // Remove from monitoring — package was delivered
      await supabase.from('lost_in_transit_checks').delete().eq('id', litEntry.id)
      console.log(`[Webhook TM] ${trackingNumber}: DELIVERED — removed from monitoring`)
      return NextResponse.json({ success: true, action: 'delivered_removed', checkpointsStored })
    }

    // Get latest checkpoint info for scan update
    const lastCheckpointDate = getLastCheckpointDate(tracking)
    const latestEvent = tracking.latest_event || ''

    // Check RTS from latest event
    const isRTS = RTS_PATTERNS.some(p => p.test(latestEvent)) &&
      !/reminder to schedule redelivery/i.test(latestEvent)

    // Calculate days since last scan
    const daysSinceLastScan = lastCheckpointDate
      ? Math.floor((Date.now() - lastCheckpointDate.getTime()) / (1000 * 60 * 60 * 24))
      : null

    // Determine new eligibility status
    const eligibilityThreshold = litEntry.is_international ? 20 : 15
    let newStatus = litEntry.claim_eligibility_status

    if (returned || isRTS) {
      newStatus = 'returned_to_sender'
    } else if (daysSinceLastScan !== null && daysSinceLastScan >= eligibilityThreshold && litEntry.claim_eligibility_status === 'at_risk') {
      newStatus = 'eligible'
    } else if (daysSinceLastScan !== null && daysSinceLastScan < eligibilityThreshold && litEntry.claim_eligibility_status === 'eligible') {
      // New scan arrived — package is moving again, revert to at_risk
      newStatus = 'at_risk'
    }

    // Build location string from latest checkpoint
    const checkpoints = [
      ...(tracking.origin_info?.trackinfo || []),
      ...(tracking.destination_info?.trackinfo || []),
    ].sort((a, b) => new Date(b.checkpoint_date).getTime() - new Date(a.checkpoint_date).getTime())

    const latestCheckpoint = checkpoints[0]
    const latestLocation = latestCheckpoint?.location ||
      [latestCheckpoint?.city, latestCheckpoint?.state].filter(Boolean).join(', ') || null

    // Update the monitoring entry
    const updateData: Record<string, unknown> = {
      claim_eligibility_status: newStatus,
      last_recheck_at: new Date().toISOString(),
      trackingmore_tracking_id: tracking.id || undefined,
    }

    if (lastCheckpointDate) {
      updateData.last_scan_date = lastCheckpointDate.toISOString()
      updateData.last_scan_description = `${latestEvent},${latestLocation || ''},${lastCheckpointDate.toISOString()}`
      updateData.days_in_transit = daysSinceLastScan
    }

    const { error: updateErr } = await supabase
      .from('lost_in_transit_checks')
      .update(updateData)
      .eq('id', litEntry.id)

    if (updateErr) {
      console.error(`[Webhook TM] Update error for ${trackingNumber}:`, updateErr.message)
      return NextResponse.json({ success: false, error: updateErr.message }, { status: 500 })
    }

    console.log(`[Webhook TM] ${trackingNumber}: updated status=${newStatus}, daysSince=${daysSinceLastScan}, checkpoints=${checkpointsStored}`)
    return NextResponse.json({
      success: true,
      action: isRTS || returned ? 'rts_detected' : 'updated',
      newStatus,
      checkpointsStored,
    })
  } catch (error) {
    console.error(`[Webhook TM] Error processing ${trackingNumber}:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
