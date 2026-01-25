import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  recheckTracking,
  LOST_IN_TRANSIT_DOMESTIC_DAYS,
  LOST_IN_TRANSIT_INTERNATIONAL_DAYS,
} from '@/lib/trackingmore/at-risk'
import { isDelivered, daysSinceLastCheckpoint, getLastCheckpointDate } from '@/lib/trackingmore/client'

/**
 * Frequent recheck of at-risk shipments using TrackingMore GET (FREE)
 *
 * Query: lost_in_transit_checks WHERE claim_eligibility_status = 'at_risk'
 * Action: GET latest tracking data, update status if now eligible or delivered
 *
 * Schedule: Every 5 hours (0 0,5,10,15,20 * * *)
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
    nowDelivered: 0,
    stillAtRisk: 0,
    errors: [] as string[],
  }

  try {
    // Get all shipments currently marked as at_risk
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
        last_recheck_at
      `)
      .eq('claim_eligibility_status', 'at_risk')
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
    const shipmentIds = atRiskShipments.map(s => s.shipment_id)
    const { data: shipmentData } = await supabase
      .from('shipments')
      .select('shipment_id, origin_country, destination_country, event_labeled')
      .in('shipment_id', shipmentIds)

    const shipmentMap = new Map(
      (shipmentData || []).map(s => [s.shipment_id, s])
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

        console.log(`[At-Risk Recheck] Checking ${check.shipment_id} (${check.carrier})...`)

        // Fetch latest tracking data from TrackingMore (FREE - already created)
        const trackingResult = await recheckTracking(check.tracking_number, check.carrier)

        if (!trackingResult.success || !trackingResult.tracking) {
          // Tracking fetch failed - check if eligible_after date has passed
          const eligibleAfter = new Date(check.eligible_after)
          const today = new Date()
          today.setHours(0, 0, 0, 0)

          if (eligibleAfter <= today) {
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
          // Remove from at-risk tracking or mark as resolved
          const { error: deleteError } = await supabase
            .from('lost_in_transit_checks')
            .delete()
            .eq('id', check.id)

          if (!deleteError) {
            results.nowDelivered++
            console.log(`[At-Risk Recheck] ${check.shipment_id} NOW DELIVERED - removed from tracking`)
          }

          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        // Check if now eligible based on days since last scan
        const daysSince = daysSinceLastCheckpoint(tracking)
        const lastCheckpointDate = getLastCheckpointDate(tracking)

        if (daysSince !== null && daysSince >= requiredDays) {
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

    const duration = Date.now() - startTime
    console.log(`[At-Risk Recheck] Completed in ${duration}ms`)
    console.log(`[At-Risk Recheck] Summary: ${results.nowEligible} now eligible, ${results.nowDelivered} delivered, ${results.stillAtRisk} still at risk`)

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
