import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTracking } from '@/lib/trackingmore/client'
import { storeCheckpoints } from '@/lib/trackingmore/checkpoint-storage'
import { generateAssessment, calculateNextCheckTime, type ShipmentDataForAssessment } from '@/lib/ai/client'

// Types for shipment candidates
interface ShipmentCandidate {
  shipment_id: string
  tracking_id: string
  carrier: string | null
  client_id: string | null
  event_labeled: string
  event_delivered: string | null
  origin_country: string | null
  destination_country: string | null
  zone_used: number | null
  ship_option: number | null
  status_details: unknown[] | null
}

/**
 * POST /api/cron/monitoring-entry
 *
 * Hourly cron to add shipments to Lookout IQ monitoring.
 * Finds shipments that exceed transit benchmarks and haven't been delivered.
 *
 * Entry criteria:
 * - Dynamic: days_in_transit > (benchmark_avg * 1.30) - 30% buffer above average
 * - Fallback: 8+ days in transit (domestic) or 12+ days (international)
 *
 * Schedule: Every hour (0 * * * *)
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()

  console.log('[MonitoringEntry] Starting monitoring entry scan...')

  try {
    // Get transit benchmarks for threshold calculation
    const { data: benchmarks } = await supabase
      .from('transit_benchmarks')
      .select('*')

    const benchmarkMap = new Map<string, Record<string, number | null>>()
    if (benchmarks) {
      for (const b of benchmarks) {
        const key = `${b.benchmark_type}:${b.benchmark_key}`
        benchmarkMap.set(key, {
          zone_1: b.zone_1_avg,
          zone_2: b.zone_2_avg,
          zone_3: b.zone_3_avg,
          zone_4: b.zone_4_avg,
          zone_5: b.zone_5_avg,
          zone_6: b.zone_6_avg,
          zone_7: b.zone_7_avg,
          zone_8: b.zone_8_avg,
          zone_9: b.zone_9_avg,
          zone_10: b.zone_10_avg,
        })
      }
    }

    // Find shipments that might need monitoring
    // Look for shipments labeled 3+ days ago that aren't delivered
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    const { data: candidates, error: candidatesError } = await supabase
      .from('shipments')
      .select(`
        shipment_id,
        tracking_id,
        carrier,
        client_id,
        event_labeled,
        event_delivered,
        origin_country,
        destination_country,
        zone_used,
        ship_option,
        status_details
      `)
      .is('event_delivered', null)
      .lte('event_labeled', threeDaysAgo.toISOString())
      .not('tracking_id', 'is', null)
      .order('event_labeled', { ascending: true })
      .limit(500)

    if (candidatesError) {
      console.error('[MonitoringEntry] Error fetching candidates:', candidatesError)
      return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 })
    }

    if (!candidates || candidates.length === 0) {
      console.log('[MonitoringEntry] No candidates found')
      return NextResponse.json({ success: true, added: 0, skipped: 0 })
    }

    console.log(`[MonitoringEntry] Found ${candidates.length} candidate shipments`)

    // Get existing monitoring entries to avoid duplicates
    const shipmentIds = (candidates as ShipmentCandidate[]).map((c: ShipmentCandidate) => c.shipment_id)
    const { data: existing } = await supabase
      .from('lost_in_transit_checks')
      .select('shipment_id')
      .in('shipment_id', shipmentIds)

    const existingSet = new Set(existing?.map((e: { shipment_id: string }) => e.shipment_id) || [])

    let added = 0
    let skipped = 0
    const errors: string[] = []

    for (const shipment of candidates) {
      // Skip if already monitored
      if (existingSet.has(shipment.shipment_id)) {
        skipped++
        continue
      }

      // Calculate days in transit
      const labelDate = new Date(shipment.event_labeled)
      const now = new Date()
      const daysInTransit = Math.floor((now.getTime() - labelDate.getTime()) / (1000 * 60 * 60 * 24))

      // Check if this shipment should be monitored
      const isInternational = shipment.origin_country && shipment.destination_country &&
        shipment.origin_country !== shipment.destination_country
      const zone = shipment.zone_used || 5 // Default to zone 5 if unknown

      // Buffer percentage added to benchmark average (30% above average)
      const BUFFER_PERCENT = 0.30

      // Get threshold from benchmarks
      let threshold = isInternational ? 12 : 8 // Default thresholds
      let benchmarkAvg: number | null = null

      if (isInternational) {
        // For international, try carrier-specific international route benchmark first
        // Key format: "carrier:origin:destination"
        const carrierRouteKey = `${shipment.carrier}:${shipment.origin_country}:${shipment.destination_country}`
        const carrierRouteBenchmark = benchmarkMap.get(`international_route:${carrierRouteKey}`)
        if (carrierRouteBenchmark && carrierRouteBenchmark['zone_1']) {
          // zone_1 stores the average for international routes
          benchmarkAvg = carrierRouteBenchmark['zone_1'] as number
          threshold = Math.ceil(benchmarkAvg * (1 + BUFFER_PERCENT))
          console.log(`[MonitoringEntry] Using carrier-specific international benchmark for ${shipment.shipment_id}: ${carrierRouteKey} = ${benchmarkAvg} days → threshold ${threshold} days`)
        }
        // No fallback needed - we use the default 12-day threshold if no benchmark exists
      } else {
        // For domestic, try carrier-specific benchmark first
        const carrierBenchmark = benchmarkMap.get(`carrier_service:${shipment.carrier}`)
        if (carrierBenchmark && carrierBenchmark[`zone_${zone}`]) {
          benchmarkAvg = carrierBenchmark[`zone_${zone}`] as number
          threshold = Math.ceil(benchmarkAvg * (1 + BUFFER_PERCENT))
        } else {
          // Try ship_option benchmark
          const shipOptionBenchmark = benchmarkMap.get(`ship_option:${shipment.ship_option}`)
          if (shipOptionBenchmark && shipOptionBenchmark[`zone_${zone}`]) {
            benchmarkAvg = shipOptionBenchmark[`zone_${zone}`] as number
            threshold = Math.ceil(benchmarkAvg * (1 + BUFFER_PERCENT))
          }
        }
      }

      // Skip if not past threshold
      if (daysInTransit < threshold) {
        skipped++
        continue
      }

      console.log(`[MonitoringEntry] Adding shipment ${shipment.shipment_id} (${daysInTransit} days, threshold: ${threshold})`)

      try {
        // Create TrackingMore tracking if needed
        let trackingMoreId: string | null = null
        let checkpointData: { last_scan_date?: string; last_scan_description?: string; checkpoints?: unknown[] } | null = null

        try {
          // Get tracking (creates if needed, $0.04 first time, FREE after)
          const trackingResult = await getTracking(shipment.tracking_id, shipment.carrier || undefined)
          if (trackingResult.success && trackingResult.tracking) {
            trackingMoreId = trackingResult.tracking.id || null
            const checkpoints = trackingResult.tracking.origin_info?.trackinfo || []
            checkpointData = {
              last_scan_date: trackingResult.tracking.latest_checkpoint_time || undefined,
              last_scan_description: trackingResult.tracking.latest_event || undefined,
              checkpoints
            }

            // Store ALL checkpoints for Delivery IQ (permanent storage)
            try {
              await storeCheckpoints(shipment.shipment_id, trackingResult.tracking, shipment.carrier || 'Unknown')
            } catch (storeError) {
              console.error(`[MonitoringEntry] Failed to store checkpoints for ${shipment.shipment_id}:`, storeError)
            }
          }
        } catch (trackingError) {
          console.error(`[MonitoringEntry] TrackingMore error for ${shipment.shipment_id}:`, trackingError)
          // Continue without TrackingMore data
        }

        // Calculate days since last scan
        let daysSinceLastScan: number | null = null
        if (checkpointData?.last_scan_date) {
          const lastScan = new Date(checkpointData.last_scan_date)
          daysSinceLastScan = Math.floor((now.getTime() - lastScan.getTime()) / (1000 * 60 * 60 * 24))
        }

        // Determine claim eligibility status
        let claimEligibilityStatus: string = 'at_risk'
        const eligibilityThreshold = isInternational ? 20 : 15
        if (daysSinceLastScan && daysSinceLastScan >= eligibilityThreshold) {
          claimEligibilityStatus = 'eligible'
        }

        // Calculate eligible_after date
        const eligibleAfterDate = new Date()
        if (checkpointData?.last_scan_date) {
          const lastScan = new Date(checkpointData.last_scan_date)
          eligibleAfterDate.setTime(lastScan.getTime() + eligibilityThreshold * 24 * 60 * 60 * 1000)
        } else {
          eligibleAfterDate.setTime(labelDate.getTime() + eligibilityThreshold * 24 * 60 * 60 * 1000)
        }

        // Generate AI assessment
        let aiAssessment = null
        let aiStatusBadge = null
        let aiRiskLevel = null
        let aiReshipmentUrgency = null
        let aiCustomerAnxiety = null
        let aiPredictedOutcome = null

        try {
          const shipmentDataForAI: ShipmentDataForAssessment = {
            trackingId: shipment.tracking_id,
            carrier: shipment.carrier || 'Unknown',
            originCountry: shipment.origin_country || 'US',
            destinationCountry: shipment.destination_country || 'US',
            labelDate: shipment.event_labeled,
            daysSinceLabel: daysInTransit,
            firstScanDate: null,
            daysInTransit,
            lastScanDate: checkpointData?.last_scan_date || null,
            daysSinceLastScan,
            checkpoints: (checkpointData?.checkpoints || []).map((cp: any) => ({
              date: cp.Date || cp.checkpoint_time || '',
              description: cp.StatusDescription || cp.checkpoint_description || '',
              location: cp.Details || cp.location || ''
            })),
            typicalTransitDays: threshold - 1,
            carrierPerformanceSummary: null
          }

          aiAssessment = await generateAssessment(shipmentDataForAI)
          if (aiAssessment) {
            aiStatusBadge = aiAssessment.statusBadge
            aiRiskLevel = aiAssessment.riskLevel
            aiReshipmentUrgency = aiAssessment.reshipmentUrgency
            aiCustomerAnxiety = null // Will be calculated from sentiment
            aiPredictedOutcome = null // Will be extracted from assessment
          }
        } catch (aiError) {
          console.error(`[MonitoringEntry] AI assessment error for ${shipment.shipment_id}:`, aiError)
        }

        // Calculate next check time
        const nextCheckAt = calculateNextCheckTime(aiAssessment, daysSinceLastScan)

        // Insert into monitoring
        const { error: insertError } = await supabase
          .from('lost_in_transit_checks')
          .insert({
            shipment_id: shipment.shipment_id,
            tracking_number: shipment.tracking_id,
            carrier: shipment.carrier,
            client_id: shipment.client_id,
            is_international: isInternational,
            claim_eligibility_status: claimEligibilityStatus,
            eligible_after: eligibleAfterDate.toISOString().split('T')[0],
            last_scan_date: checkpointData?.last_scan_date || null,
            last_scan_description: checkpointData?.last_scan_description || null,
            trackingmore_tracking_id: trackingMoreId,
            first_checked_at: now.toISOString(),
            days_since_last_update: daysSinceLastScan,
            days_in_transit: daysInTransit,
            // AI fields
            ai_assessment: aiAssessment,
            ai_assessed_at: aiAssessment ? now.toISOString() : null,
            ai_next_check_at: nextCheckAt.toISOString(),
            ai_status_badge: aiStatusBadge,
            ai_risk_level: aiRiskLevel,
            ai_reshipment_urgency: aiReshipmentUrgency,
            ai_customer_anxiety: aiCustomerAnxiety,
            ai_predicted_outcome: aiPredictedOutcome,
          })

        if (insertError) {
          console.error(`[MonitoringEntry] Insert error for ${shipment.shipment_id}:`, insertError)
          errors.push(`${shipment.shipment_id}: ${insertError.message}`)
        } else {
          added++
        }
      } catch (shipmentError) {
        console.error(`[MonitoringEntry] Error processing ${shipment.shipment_id}:`, shipmentError)
        errors.push(`${shipment.shipment_id}: ${shipmentError}`)
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const duration = Date.now() - startTime
    console.log(`[MonitoringEntry] Complete: ${added} added, ${skipped} skipped in ${duration}ms`)

    return NextResponse.json({
      success: true,
      added,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
      duration
    })
  } catch (error) {
    console.error('[MonitoringEntry] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process monitoring entries' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
