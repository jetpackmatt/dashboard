import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  recheckTracking,
  hasExistingLossClaim,
  LOST_IN_TRANSIT_DOMESTIC_DAYS,
  LOST_IN_TRANSIT_INTERNATIONAL_DAYS,
  FILING_WINDOW_DOMESTIC_MAX_DAYS,
  FILING_WINDOW_INTERNATIONAL_MAX_DAYS,
} from '@/lib/trackingmore/at-risk'
import { isDelivered, daysSinceLastCheckpoint, getLastCheckpointDate, type TrackingMoreTracking } from '@/lib/trackingmore/client'

// Patterns that indicate the carrier has admitted the package is lost
// These should trigger immediate promotion to "eligible" (Ready to File)
const LOST_STATUS_PATTERNS = [
  /^lost,/i,                           // "Lost,HARRISBURG,PA,US,..."
  /unable to locate/i,                 // "Unable to Locate We're sorry..."
  /cannot be located/i,                // "Package cannot be located"
  /missing mail search/i,              // "Missing Mail Search Request Initiated..."
  /package is lost/i,                  // Explicit lost statement
  /declared lost/i,                    // "Package declared lost"
  /presumed lost/i,                    // "Package presumed lost"
]

// Check if a tracking description indicates the package is lost
function isLostStatus(description: string | null): boolean {
  if (!description) return false
  return LOST_STATUS_PATTERNS.some(pattern => pattern.test(description))
}

// Helper to extract delivery date from tracking checkpoints
function getDeliveryDate(tracking: TrackingMoreTracking): string | null {
  const checkpoints = [
    ...(tracking.origin_info?.trackinfo || []),
    ...(tracking.destination_info?.trackinfo || []),
  ].sort((a, b) => new Date(b.checkpoint_date).getTime() - new Date(a.checkpoint_date).getTime())

  for (const checkpoint of checkpoints) {
    const status = (checkpoint.checkpoint_delivery_status || '').toLowerCase()
    const detail = (checkpoint.tracking_detail || '').toLowerCase()

    if (status === 'delivered' || detail.includes('delivered') || detail.includes('delivery has been arranged')) {
      return checkpoint.checkpoint_date
    }
  }
  return null
}

/**
 * Frequent recheck of at-risk and eligible shipments using TrackingMore GET (FREE)
 *
 * Query: lost_in_transit_checks WHERE claim_eligibility_status IN ('at_risk', 'eligible')
 * Actions:
 *   - Marks as 'missed_window' if past max filing window (45 days domestic, 50 days international)
 *   - Promotes 'at_risk' to 'eligible' when minimum days threshold met
 *   - Removes records when shipment is delivered
 *   - Marks as 'claim_filed' if a care ticket already exists
 *
 * Schedule: Every hour (0 * * * *)
 *
 * This is FREE because we're using GET /trackings/get on already-created trackings.
 */

export const maxDuration = 300 // 5 minutes

const API_DELAY_MS = 500 // 500ms between TrackingMore calls (polite even though free)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[At-Risk Recheck] Starting recheck...')
  const startTime = Date.now()
  const supabase = createAdminClient()

  const results = {
    totalChecked: 0,
    nowEligible: 0,
    nowEligibleLostStatus: 0,  // Promoted due to carrier admitting lost
    nowDelivered: 0,
    missedWindow: 0,
    stillAtRisk: 0,
    stillEligible: 0,
    errors: [] as string[],
  }

  try {
    // Get all shipments currently marked as at_risk OR eligible (need to check both for missed windows)
    const { data: atRiskShipments, error: fetchError } = await supabase
      .from('lost_in_transit_checks')
      .select(`
        id,
        shipment_id,
        tracking_number,
        carrier,
        client_id,
        eligible_after,
        is_international,
        last_recheck_at,
        claim_eligibility_status,
        last_scan_date
      `)
      .in('claim_eligibility_status', ['at_risk', 'eligible'])
      .order('last_recheck_at', { ascending: true, nullsFirst: true })
      .limit(300)

    if (fetchError) {
      console.error('[At-Risk Recheck] Error fetching at-risk shipments:', fetchError)
      return NextResponse.json(
        { success: false, error: fetchError.message },
        { status: 500 }
      )
    }

    if (!atRiskShipments || atRiskShipments.length === 0) {
      console.log('[At-Risk Recheck] No at-risk shipments to recheck')
      return NextResponse.json({
        success: true,
        duration: `${Date.now() - startTime}ms`,
        summary: results,
        message: 'No at-risk shipments to recheck',
      })
    }

    console.log(`[At-Risk Recheck] Checking ${atRiskShipments.length} shipments...`)

    // Get shipment data for country info (needed for international determination)
    const shipmentIds = atRiskShipments.map((s: { shipment_id: string }) => s.shipment_id)
    const { data: shipmentData } = await supabase
      .from('shipments')
      .select('shipment_id, origin_country, destination_country, event_labeled')
      .in('shipment_id', shipmentIds)

    type ShipmentInfo = { shipment_id: string; origin_country: string | null; destination_country: string | null; event_labeled: string | null }
    const shipmentMap = new Map<string, ShipmentInfo>(
      (shipmentData || []).map((s: ShipmentInfo) => [s.shipment_id, s])
    )

    for (const check of atRiskShipments) {
      results.totalChecked++

      try {
        const shipment = shipmentMap.get(check.shipment_id)
        const isInternational = check.is_international ||
          (shipment?.origin_country !== shipment?.destination_country)
        const requiredDays = isInternational
          ? LOST_IN_TRANSIT_INTERNATIONAL_DAYS
          : LOST_IN_TRANSIT_DOMESTIC_DAYS
        const maxWindowDays = isInternational
          ? FILING_WINDOW_INTERNATIONAL_MAX_DAYS
          : FILING_WINDOW_DOMESTIC_MAX_DAYS

        console.log(`[At-Risk Recheck] Checking ${check.shipment_id} (${check.carrier}, status: ${check.claim_eligibility_status})...`)

        // Check for missed window using last_scan_date or ship date as fallback
        const now = new Date()
        let daysSinceLastScan: number | null = null
        let dateSource = ''

        if (check.last_scan_date) {
          const lastScanDate = new Date(check.last_scan_date)
          daysSinceLastScan = Math.floor((now.getTime() - lastScanDate.getTime()) / (1000 * 60 * 60 * 24))
          dateSource = 'last_scan'
        } else if (shipment?.event_labeled) {
          // Fallback: use ship date when no tracking data available
          // Add buffer of 7 days (max time carrier might take to scan)
          const shipDate = new Date(shipment.event_labeled)
          daysSinceLastScan = Math.floor((now.getTime() - shipDate.getTime()) / (1000 * 60 * 60 * 24)) - 7
          dateSource = 'ship_date'
        }

        if (daysSinceLastScan !== null && daysSinceLastScan > maxWindowDays) {
          // Filing window has expired - mark as missed_window
          const { error: updateError } = await supabase
            .from('lost_in_transit_checks')
            .update({
              claim_eligibility_status: 'missed_window',
              last_recheck_at: new Date().toISOString(),
            })
            .eq('id', check.id)

          if (!updateError) {
            results.missedWindow++
            console.log(`[At-Risk Recheck] ${check.shipment_id} MISSED WINDOW (${daysSinceLastScan} days via ${dateSource} > ${maxWindowDays} max)`)
          }
          continue
        }

        // If already eligible, check for delivery and missed window using fresh tracking data
        if (check.claim_eligibility_status === 'eligible') {
          const trackingResult = await recheckTracking(check.tracking_number, check.carrier)

          if (trackingResult.success && trackingResult.tracking) {
            // Check if now delivered
            if (isDelivered(trackingResult.tracking)) {
              // Update shipments table with delivery status
              const deliveryDate = getDeliveryDate(trackingResult.tracking)
              await supabase
                .from('shipments')
                .update({
                  delivery_status: 'Delivered',
                  ...(deliveryDate && { event_delivered: deliveryDate }),
                })
                .eq('shipment_id', check.shipment_id)

              // Remove from monitoring
              const { error: deleteError } = await supabase
                .from('lost_in_transit_checks')
                .delete()
                .eq('id', check.id)

              if (!deleteError) {
                results.nowDelivered++
                console.log(`[At-Risk Recheck] ${check.shipment_id} NOW DELIVERED - updated shipment and removed from tracking`)
              }
              await new Promise(r => setTimeout(r, API_DELAY_MS))
              continue
            }

            // Check for missed window with fresh tracking data
            const daysSince = daysSinceLastCheckpoint(trackingResult.tracking)
            const lastCheckpointDate = getLastCheckpointDate(trackingResult.tracking)

            if (daysSince !== null && daysSince > maxWindowDays) {
              const { error: updateError } = await supabase
                .from('lost_in_transit_checks')
                .update({
                  claim_eligibility_status: 'missed_window',
                  last_recheck_at: new Date().toISOString(),
                  last_scan_date: lastCheckpointDate?.toISOString() || null,
                  last_scan_description: trackingResult.tracking.latest_event || null,
                })
                .eq('id', check.id)

              if (!updateError) {
                results.missedWindow++
                console.log(`[At-Risk Recheck] ${check.shipment_id} MISSED WINDOW (${daysSince} days > ${maxWindowDays} max)`)
              }
              await new Promise(r => setTimeout(r, API_DELAY_MS))
              continue
            }

            // Update last_scan_date with fresh data
            await supabase
              .from('lost_in_transit_checks')
              .update({
                last_recheck_at: new Date().toISOString(),
                last_scan_date: lastCheckpointDate?.toISOString() || check.last_scan_date,
                last_scan_description: trackingResult.tracking.latest_event || null,
              })
              .eq('id', check.id)
          } else {
            // No tracking data available, just update recheck time
            await supabase
              .from('lost_in_transit_checks')
              .update({ last_recheck_at: new Date().toISOString() })
              .eq('id', check.id)
          }

          results.stillEligible++
          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        // Fetch latest tracking data from TrackingMore (FREE - already created)
        const trackingResult = await recheckTracking(check.tracking_number, check.carrier)

        if (!trackingResult.success || !trackingResult.tracking) {
          // Tracking fetch failed - check if eligible_after date has passed
          const eligibleAfter = new Date(check.eligible_after)
          const today = new Date()
          today.setHours(0, 0, 0, 0)

          if (eligibleAfter <= today) {
            // Check if a claim already exists before marking eligible
            const hasClaim = await hasExistingLossClaim(check.shipment_id)
            if (hasClaim) {
              // Claim already exists - mark as claim_filed instead
              await supabase
                .from('lost_in_transit_checks')
                .update({
                  claim_eligibility_status: 'claim_filed',
                  last_recheck_at: new Date().toISOString(),
                })
                .eq('id', check.id)

              console.log(`[At-Risk Recheck] ${check.shipment_id} has existing claim - marked as claim_filed`)
              results.stillAtRisk++ // Count as handled
            } else {
              // Eligible based on time alone (no tracking data)
              const { error: updateError } = await supabase
                .from('lost_in_transit_checks')
                .update({
                  claim_eligibility_status: 'eligible',
                  last_recheck_at: new Date().toISOString(),
                })
                .eq('id', check.id)

              if (!updateError) {
                results.nowEligible++
                console.log(`[At-Risk Recheck] ${check.shipment_id} NOW ELIGIBLE (no tracking, time elapsed)`)
              }
            }
          } else {
            // Still at risk, update recheck time
            await supabase
              .from('lost_in_transit_checks')
              .update({ last_recheck_at: new Date().toISOString() })
              .eq('id', check.id)

            results.stillAtRisk++
            console.log(`[At-Risk Recheck] ${check.shipment_id} still at risk (tracking unavailable)`)
          }

          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        const tracking = trackingResult.tracking

        // Check if now delivered
        if (isDelivered(tracking)) {
          // Update shipments table with delivery status
          const deliveryDate = getDeliveryDate(tracking)
          await supabase
            .from('shipments')
            .update({
              delivery_status: 'Delivered',
              ...(deliveryDate && { event_delivered: deliveryDate }),
            })
            .eq('shipment_id', check.shipment_id)

          // Remove from monitoring
          const { error: deleteError } = await supabase
            .from('lost_in_transit_checks')
            .delete()
            .eq('id', check.id)

          if (!deleteError) {
            results.nowDelivered++
            console.log(`[At-Risk Recheck] ${check.shipment_id} NOW DELIVERED - updated shipment and removed from tracking`)
          }

          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        // Check if now eligible based on days since last scan
        const daysSince = daysSinceLastCheckpoint(tracking)
        const lastCheckpointDate = getLastCheckpointDate(tracking)

        // Check if carrier has admitted the package is lost
        // This overrides the day-based threshold - carrier admission means immediate eligibility
        if (isLostStatus(tracking.latest_event)) {
          // Check if a claim already exists before marking eligible
          const hasClaim = await hasExistingLossClaim(check.shipment_id)
          if (hasClaim) {
            // Claim already exists - mark as claim_filed instead
            await supabase
              .from('lost_in_transit_checks')
              .update({
                claim_eligibility_status: 'claim_filed',
                last_recheck_at: new Date().toISOString(),
                last_scan_date: lastCheckpointDate?.toISOString() || null,
                last_scan_description: tracking.latest_event || null,
              })
              .eq('id', check.id)

            console.log(`[At-Risk Recheck] ${check.shipment_id} has existing claim (lost status) - marked as claim_filed`)
            results.stillAtRisk++ // Count as handled
          } else {
            // Carrier has admitted loss - immediately eligible!
            const { error: updateError } = await supabase
              .from('lost_in_transit_checks')
              .update({
                claim_eligibility_status: 'eligible',
                last_recheck_at: new Date().toISOString(),
                last_scan_date: lastCheckpointDate?.toISOString() || null,
                last_scan_description: tracking.latest_event || null,
              })
              .eq('id', check.id)

            if (!updateError) {
              results.nowEligibleLostStatus++
              results.nowEligible++ // Also count in main eligible counter
              console.log(`[At-Risk Recheck] ${check.shipment_id} NOW ELIGIBLE - carrier admitted lost: "${tracking.latest_event}"`)
            }
          }

          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        // Check for missed window with fresh tracking data
        if (daysSince !== null && daysSince > maxWindowDays) {
          // Filing window has expired - mark as missed_window
          const { error: updateError } = await supabase
            .from('lost_in_transit_checks')
            .update({
              claim_eligibility_status: 'missed_window',
              last_recheck_at: new Date().toISOString(),
              last_scan_date: lastCheckpointDate?.toISOString() || null,
              last_scan_description: tracking.latest_event || null,
            })
            .eq('id', check.id)

          if (!updateError) {
            results.missedWindow++
            console.log(`[At-Risk Recheck] ${check.shipment_id} MISSED WINDOW (${daysSince} days > ${maxWindowDays} max)`)
          }
          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        if (daysSince !== null && daysSince >= requiredDays) {
          // Check if a claim already exists before marking eligible
          const hasClaim = await hasExistingLossClaim(check.shipment_id)
          if (hasClaim) {
            // Claim already exists - mark as claim_filed instead
            await supabase
              .from('lost_in_transit_checks')
              .update({
                claim_eligibility_status: 'claim_filed',
                last_recheck_at: new Date().toISOString(),
                last_scan_date: lastCheckpointDate?.toISOString() || null,
                last_scan_description: tracking.latest_event || null,
              })
              .eq('id', check.id)

            console.log(`[At-Risk Recheck] ${check.shipment_id} has existing claim - marked as claim_filed`)
            results.stillAtRisk++ // Count as handled
          } else {
            // Now eligible!
            const { error: updateError } = await supabase
              .from('lost_in_transit_checks')
              .update({
                claim_eligibility_status: 'eligible',
                last_recheck_at: new Date().toISOString(),
                last_scan_date: lastCheckpointDate?.toISOString() || null,
                last_scan_description: tracking.latest_event || null,
              })
              .eq('id', check.id)

            if (!updateError) {
              results.nowEligible++
              console.log(`[At-Risk Recheck] ${check.shipment_id} NOW ELIGIBLE (${daysSince} days since last scan)`)
            }
          }
        } else {
          // Still at risk, update last checked info
          const daysRemaining = daysSince !== null ? requiredDays - daysSince : null
          const newEligibleAfter = lastCheckpointDate
            ? new Date(lastCheckpointDate.getTime() + requiredDays * 24 * 60 * 60 * 1000)
            : null

          await supabase
            .from('lost_in_transit_checks')
            .update({
              last_recheck_at: new Date().toISOString(),
              last_scan_date: lastCheckpointDate?.toISOString() || null,
              last_scan_description: tracking.latest_event || null,
              eligible_after: newEligibleAfter?.toISOString().split('T')[0] || check.eligible_after,
            })
            .eq('id', check.id)

          results.stillAtRisk++
          console.log(`[At-Risk Recheck] ${check.shipment_id} still at risk (${daysRemaining} days remaining)`)
        }

        await new Promise(r => setTimeout(r, API_DELAY_MS))
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error'
        console.error(`[At-Risk Recheck] Error checking ${check.shipment_id}:`, e)
        results.errors.push(`${check.shipment_id}: ${errorMsg}`)
        await new Promise(r => setTimeout(r, API_DELAY_MS))
      }
    }

    // Also check a small batch of archived items for delivery
    // This catches items that were archived but later showed as delivered
    const { data: archivedShipments } = await supabase
      .from('lost_in_transit_checks')
      .select('id, shipment_id, tracking_number, carrier')
      .eq('claim_eligibility_status', 'missed_window')
      .not('trackingmore_tracking_id', 'is', null)
      .order('last_recheck_at', { ascending: true, nullsFirst: true })
      .limit(30) // Check 30 archived items per run

    let archivedDelivered = 0
    if (archivedShipments && archivedShipments.length > 0) {
      console.log(`[At-Risk Recheck] Checking ${archivedShipments.length} archived items for delivery...`)

      for (const archived of archivedShipments) {
        try {
          const trackingResult = await recheckTracking(archived.tracking_number, archived.carrier)

          if (trackingResult.success && trackingResult.tracking && isDelivered(trackingResult.tracking)) {
            // Update shipments table with delivery status
            const deliveryDate = getDeliveryDate(trackingResult.tracking)
            await supabase
              .from('shipments')
              .update({
                delivery_status: 'Delivered',
                ...(deliveryDate && { event_delivered: deliveryDate }),
              })
              .eq('shipment_id', archived.shipment_id)

            // Remove from monitoring
            await supabase
              .from('lost_in_transit_checks')
              .delete()
              .eq('id', archived.id)

            archivedDelivered++
            console.log(`[At-Risk Recheck] Archived ${archived.shipment_id} was DELIVERED - removed`)
          } else {
            // Update recheck timestamp so we cycle through all archived items
            await supabase
              .from('lost_in_transit_checks')
              .update({ last_recheck_at: new Date().toISOString() })
              .eq('id', archived.id)
          }

          await new Promise(r => setTimeout(r, API_DELAY_MS))
        } catch (e) {
          console.error(`[At-Risk Recheck] Error checking archived ${archived.shipment_id}:`, e)
        }
      }

      if (archivedDelivered > 0) {
        results.nowDelivered += archivedDelivered
        console.log(`[At-Risk Recheck] Found ${archivedDelivered} delivered items in archive`)
      }
    }

    const duration = Date.now() - startTime
    console.log(`[At-Risk Recheck] Completed in ${duration}ms`)
    console.log(`[At-Risk Recheck] Summary: ${results.nowEligible} now eligible (${results.nowEligibleLostStatus} due to lost status), ${results.nowDelivered} delivered, ${results.missedWindow} missed window, ${results.stillAtRisk} still at risk, ${results.stillEligible} still eligible`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      summary: results,
    })
  } catch (e) {
    console.error('[At-Risk Recheck] Fatal error:', e)
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
        summary: results,
      },
      { status: 500 }
    )
  }
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
