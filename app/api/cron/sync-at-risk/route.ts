import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getNewAtRiskCandidates,
  processAtRiskShipment,
  hasExistingLossClaim,
} from '@/lib/trackingmore/at-risk'

/**
 * Daily cron to identify potentially Lost in Transit shipments
 *
 * First filter (FREE - database query):
 * - NOT delivered (event_delivered IS NULL)
 * - Status is one of: Labelled, Awaiting Carrier, In Transit, Out for Delivery, Exception
 * - 15+ days since label creation (event_labeled)
 *
 * Then: Create TrackingMore tracking for new shipments ($0.04 each)
 * Result: Insert into lost_in_transit_checks with claim_eligibility_status
 *
 * Schedule: Daily 3 AM UTC (configured in vercel.json)
 */

export const maxDuration = 300 // 5 minutes

const API_DELAY_MS = 600 // 600ms between TrackingMore calls

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[At-Risk Sync] Starting daily sync...')
  const startTime = Date.now()
  const supabase = createAdminClient()

  const results = {
    totalCandidates: 0,
    processed: 0,
    atRisk: 0,
    eligible: 0,
    delivered: 0,
    skipped: 0,
    errors: [] as string[],
    estimatedCost: 0,
  }

  try {
    // Get shipments that are candidates but not yet in lost_in_transit_checks
    const candidates = await getNewAtRiskCandidates(15, 500)
    results.totalCandidates = candidates.length

    console.log(`[At-Risk Sync] Found ${candidates.length} new candidates to process`)

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        duration: `${Date.now() - startTime}ms`,
        summary: results,
        message: 'No new at-risk candidates found',
      })
    }

    // Process each candidate
    for (const shipment of candidates) {
      try {
        console.log(`[At-Risk Sync] Processing ${shipment.shipment_id} (${shipment.carrier})...`)

        const result = await processAtRiskShipment(shipment)
        results.estimatedCost += 0.04 // Each call costs $0.04

        if (!result.success || !result.eligibility) {
          console.log(`[At-Risk Sync] Failed: ${result.error}`)
          results.errors.push(`${shipment.shipment_id}: ${result.error}`)
          results.skipped++
          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        const eligibility = result.eligibility

        // If delivered, don't add to tracking
        if (eligibility.isDelivered) {
          console.log(`[At-Risk Sync] ${shipment.shipment_id} is already delivered`)
          results.delivered++
          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        // If no status (shouldn't happen), skip
        if (!eligibility.status) {
          console.log(`[At-Risk Sync] ${shipment.shipment_id} has no eligibility status`)
          results.skipped++
          await new Promise(r => setTimeout(r, API_DELAY_MS))
          continue
        }

        // If eligible, check for existing claim and downgrade to claim_filed if found
        let finalStatus = eligibility.status
        if (finalStatus === 'eligible') {
          const hasClaim = await hasExistingLossClaim(shipment.shipment_id)
          if (hasClaim) {
            finalStatus = 'claim_filed'
            console.log(`[At-Risk Sync] ${shipment.shipment_id} has existing claim - marking as claim_filed`)
          }
        }

        // Insert into lost_in_transit_checks
        const { error: insertError } = await supabase
          .from('lost_in_transit_checks')
          .upsert({
            shipment_id: shipment.shipment_id,
            tracking_number: shipment.tracking_id,
            carrier: shipment.carrier,
            client_id: shipment.client_id,
            checked_at: new Date().toISOString(),
            eligible_after: eligibility.eligibleAfter?.toISOString().split('T')[0] || null,
            last_scan_date: eligibility.lastScanDate?.toISOString() || null,
            last_scan_description: eligibility.lastScanDescription || null,
            last_scan_location: eligibility.lastScanLocation || null,
            is_international: eligibility.isInternational,
            // New columns for at-risk tracking
            claim_eligibility_status: finalStatus,
            first_checked_at: new Date().toISOString(),
            last_recheck_at: new Date().toISOString(),
            trackingmore_tracking_id: eligibility.trackingMoreId || null,
          }, {
            onConflict: 'shipment_id',
          })

        if (insertError) {
          console.error(`[At-Risk Sync] DB error for ${shipment.shipment_id}:`, insertError)
          results.errors.push(`${shipment.shipment_id}: DB error - ${insertError.message}`)
          results.skipped++
        } else {
          results.processed++
          if (finalStatus === 'at_risk') {
            results.atRisk++
            console.log(`[At-Risk Sync] ${shipment.shipment_id} marked AT RISK (${eligibility.daysRemaining} days remaining)`)
          } else if (finalStatus === 'claim_filed') {
            // Already has claim - counted as processed but not eligible
            console.log(`[At-Risk Sync] ${shipment.shipment_id} marked CLAIM_FILED (existing claim)`)
          } else {
            results.eligible++
            console.log(`[At-Risk Sync] ${shipment.shipment_id} marked ELIGIBLE for claim`)
          }
        }

        await new Promise(r => setTimeout(r, API_DELAY_MS))
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error'
        console.error(`[At-Risk Sync] Error processing ${shipment.shipment_id}:`, e)
        results.errors.push(`${shipment.shipment_id}: ${errorMsg}`)
        results.skipped++
        await new Promise(r => setTimeout(r, API_DELAY_MS))
      }
    }

    const duration = Date.now() - startTime
    console.log(`[At-Risk Sync] Completed in ${duration}ms`)
    console.log(`[At-Risk Sync] Summary: ${results.atRisk} at-risk, ${results.eligible} eligible, ${results.delivered} delivered, ${results.skipped} skipped`)
    console.log(`[At-Risk Sync] Estimated cost: $${results.estimatedCost.toFixed(2)}`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      summary: results,
    })
  } catch (e) {
    console.error('[At-Risk Sync] Fatal error:', e)
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
