import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTracking } from '@/lib/trackingmore/client'
import { storeCheckpoints } from '@/lib/trackingmore/checkpoint-storage'
import { generateAssessment, calculateNextCheckTime, type ShipmentDataForAssessment } from '@/lib/ai/client'

// Types for database records
interface LostInTransitCheck {
  id: string
  shipment_id: string
  tracking_number: string
  carrier: string | null
  client_id: string | null
  is_international: boolean | null
  trackingmore_tracking_id: string | null
  last_scan_date: string | null
  days_in_transit: number | null
  days_since_last_update: number | null
  claim_eligibility_status: string | null
}

interface ShipmentDetail {
  shipment_id: string
  event_labeled: string | null
  origin_country: string | null
  destination_country: string | null
  zone: number | null
  ship_option: number | null
}

/**
 * POST /api/cron/ai-reassess
 *
 * Frequent cron to reassess shipments with AI.
 * Runs every 15 minutes, processes shipments where ai_next_check_at <= NOW().
 *
 * Check frequency (set by calculateNextCheckTime):
 * - At risk (15+ days): every 1 hour
 * - In transit 8+ days: every 4 hours
 *
 * Cost: TrackingMore GET is FREE. Gemini 3.0 is very cheap. Run often!
 *
 * Schedule: Every 15 minutes (* /15 * * * *)
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()
  const now = new Date()

  console.log('[AIReassess] Starting AI reassessment cron...')

  try {
    // Find shipments due for reassessment
    const { data: dueShipments, error: fetchError } = await supabase
      .from('lost_in_transit_checks')
      .select(`
        id,
        shipment_id,
        tracking_number,
        carrier,
        client_id,
        is_international,
        trackingmore_tracking_id,
        last_scan_date,
        days_in_transit,
        days_since_last_update,
        claim_eligibility_status
      `)
      .lte('ai_next_check_at', now.toISOString())
      .not('claim_eligibility_status', 'in', '("approved","denied")') // Don't reassess resolved claims
      .order('ai_next_check_at', { ascending: true })
      .limit(100) // Process in batches

    if (fetchError) {
      console.error('[AIReassess] Error fetching due shipments:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch shipments' }, { status: 500 })
    }

    if (!dueShipments || dueShipments.length === 0) {
      console.log('[AIReassess] No shipments due for reassessment')
      return NextResponse.json({ success: true, processed: 0 })
    }

    console.log(`[AIReassess] Processing ${dueShipments.length} shipments`)

    // Get shipment details for context
    const shipmentIds = (dueShipments as LostInTransitCheck[]).map((s: LostInTransitCheck) => s.shipment_id)
    const { data: shipmentDetails } = await supabase
      .from('shipments')
      .select('shipment_id, event_labeled, origin_country, destination_country, zone, ship_option')
      .in('shipment_id', shipmentIds)

    const shipmentMap = new Map((shipmentDetails as ShipmentDetail[] || []).map((s: ShipmentDetail) => [s.shipment_id, s]))

    let processed = 0
    let errors: string[] = []

    for (const check of dueShipments) {
      try {
        const shipment = shipmentMap.get(check.shipment_id)

        // Get latest tracking data from TrackingMore (FREE)
        let checkpointData: { last_scan_date?: string; last_scan_description?: string; checkpoints?: unknown[] } | null = null

        if (check.trackingmore_tracking_id || check.tracking_number) {
          try {
            const trackingResult = await getTracking(
              check.tracking_number,
              check.carrier || undefined
            )
            if (trackingResult.success && trackingResult.tracking) {
              checkpointData = {
                last_scan_date: trackingResult.tracking.latest_checkpoint_time || undefined,
                last_scan_description: trackingResult.tracking.latest_event || undefined,
                checkpoints: trackingResult.tracking.origin_info?.trackinfo || []
              }

              // Store ALL checkpoints for Delivery IQ (permanent storage)
              try {
                await storeCheckpoints(check.shipment_id, trackingResult.tracking, check.carrier || 'Unknown')
              } catch (storeError) {
                console.error(`[AIReassess] Failed to store checkpoints for ${check.shipment_id}:`, storeError)
              }
            }
          } catch (trackingError) {
            console.error(`[AIReassess] TrackingMore error for ${check.shipment_id}:`, trackingError)
          }
        }

        // Calculate days
        const labelDate = shipment?.event_labeled ? new Date(shipment.event_labeled) : new Date(check.last_scan_date || now)
        const daysInTransit = Math.floor((now.getTime() - labelDate.getTime()) / (1000 * 60 * 60 * 24))

        let daysSinceLastScan: number | null = null
        if (checkpointData?.last_scan_date) {
          const lastScan = new Date(checkpointData.last_scan_date)
          daysSinceLastScan = Math.floor((now.getTime() - lastScan.getTime()) / (1000 * 60 * 60 * 24))
        }

        // Check if package was delivered (remove from monitoring)
        if (checkpointData?.checkpoints && Array.isArray(checkpointData.checkpoints)) {
          const lastCheckpoint = checkpointData.checkpoints[0] as Record<string, string> | undefined
          const status = lastCheckpoint?.substatus || lastCheckpoint?.checkpoint_delivery_status || ''
          if (status.toLowerCase().includes('delivered')) {
            console.log(`[AIReassess] ${check.shipment_id} was delivered, removing from monitoring`)
            await supabase
              .from('lost_in_transit_checks')
              .delete()
              .eq('id', check.id)
            processed++
            continue
          }
        }

        // Generate new AI assessment
        const shipmentDataForAI: ShipmentDataForAssessment = {
          trackingId: check.tracking_number,
          carrier: check.carrier || 'Unknown',
          originCountry: shipment?.origin_country || 'US',
          destinationCountry: shipment?.destination_country || 'US',
          labelDate: shipment?.event_labeled || now.toISOString(),
          daysSinceLabel: daysInTransit,
          firstScanDate: null,
          daysInTransit,
          lastScanDate: checkpointData?.last_scan_date || check.last_scan_date || null,
          daysSinceLastScan,
          checkpoints: ((checkpointData?.checkpoints || []) as Record<string, string>[]).map((cp) => ({
            date: cp.Date || cp.checkpoint_time || '',
            description: cp.StatusDescription || cp.checkpoint_description || '',
            location: cp.Details || cp.location || ''
          })),
          typicalTransitDays: null,
          carrierPerformanceSummary: null
        }

        const aiAssessment = await generateAssessment(shipmentDataForAI)

        // Update claim eligibility status if needed
        let newClaimStatus = check.claim_eligibility_status
        const eligibilityThreshold = check.is_international ? 20 : 15
        if (daysSinceLastScan && daysSinceLastScan >= eligibilityThreshold && newClaimStatus === 'at_risk') {
          newClaimStatus = 'eligible'
        }

        // Calculate next check time
        const nextCheckAt = calculateNextCheckTime(aiAssessment, daysSinceLastScan)

        // Update the record
        const { error: updateError } = await supabase
          .from('lost_in_transit_checks')
          .update({
            last_scan_date: checkpointData?.last_scan_date || check.last_scan_date,
            last_scan_description: checkpointData?.last_scan_description,
            last_recheck_at: now.toISOString(),
            days_since_last_update: daysSinceLastScan,
            days_in_transit: daysInTransit,
            claim_eligibility_status: newClaimStatus,
            // AI fields
            ai_assessment: aiAssessment,
            ai_assessed_at: now.toISOString(),
            ai_next_check_at: nextCheckAt.toISOString(),
            ai_status_badge: aiAssessment?.statusBadge || null,
            ai_risk_level: aiAssessment?.riskLevel || null,
            ai_reshipment_urgency: aiAssessment?.reshipmentUrgency || null,
          })
          .eq('id', check.id)

        if (updateError) {
          console.error(`[AIReassess] Update error for ${check.shipment_id}:`, updateError)
          errors.push(`${check.shipment_id}: ${updateError.message}`)
        } else {
          processed++
        }

        // Small delay between API calls (not needed for cost, just to be polite)
        await new Promise(resolve => setTimeout(resolve, 50))
      } catch (shipmentError) {
        console.error(`[AIReassess] Error processing ${check.shipment_id}:`, shipmentError)
        errors.push(`${check.shipment_id}: ${shipmentError}`)
      }
    }

    const duration = Date.now() - startTime
    console.log(`[AIReassess] Complete: ${processed} processed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      processed,
      errors: errors.length > 0 ? errors : undefined,
      duration
    })
  } catch (error) {
    console.error('[AIReassess] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process reassessments' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
