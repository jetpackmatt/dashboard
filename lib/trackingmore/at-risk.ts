/**
 * At-Risk Shipment Tracking Helpers
 *
 * Proactively identifies shipments that may be Lost in Transit
 * by checking TrackingMore API for carrier tracking data.
 *
 * Cost model:
 * - Creating a tracking: $0.04 (POST /trackings/realtime)
 * - Checking existing tracking: FREE (GET /trackings/get)
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  getTracking,
  getTrackingMoreCarrierCode,
  isDelivered,
  daysSinceLastCheckpoint,
  getLastCheckpointDate,
  type TrackingMoreTracking,
  type TrackingResult,
} from './client'

// Thresholds for Lost in Transit eligibility
export const LOST_IN_TRANSIT_DOMESTIC_DAYS = 15
export const LOST_IN_TRANSIT_INTERNATIONAL_DAYS = 20

export type ClaimEligibilityStatus = 'at_risk' | 'eligible' | null

export interface AtRiskShipment {
  id: string // DB primary key
  shipment_id: string
  tracking_id: string
  carrier: string
  client_id: string
  origin_country: string | null
  destination_country: string | null
  event_labeled: string
}

export interface EligibilityResult {
  status: ClaimEligibilityStatus
  daysSinceLastScan: number | null
  daysRemaining: number | null
  eligibleAfter: Date | null
  isInternational: boolean
  requiredDays: number
  lastScanDate: Date | null
  lastScanDescription: string | null
  lastScanLocation: string | null
  isDelivered: boolean
  trackingMoreId: string | null
}

/**
 * Build query for shipments that are potentially at-risk (first filter)
 *
 * Criteria:
 * - NOT delivered (event_delivered IS NULL)
 * - 15+ days since label creation
 * - Status indicates package is "in progress" (not completed successfully)
 *
 * This is a FREE database query - no TrackingMore API calls.
 */
export async function getAtRiskCandidates(
  minDaysOld: number = 15,
  limit: number = 500
): Promise<AtRiskShipment[]> {
  const supabase = createAdminClient()

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - minDaysOld)

  // Find shipments that are potentially stuck
  // Status filter: Labelled, Awaiting Carrier, In Transit, Out for Delivery, Exception
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id,
      shipment_id,
      tracking_id,
      carrier,
      client_id,
      origin_country,
      destination_country,
      event_labeled
    `)
    .is('event_delivered', null)
    .is('deleted_at', null)
    .neq('status', 'Cancelled')
    .not('tracking_id', 'is', null)
    .not('event_labeled', 'is', null)
    .lt('event_labeled', cutoffDate.toISOString())
    // Status indicates package is "in progress" - not yet delivered
    .or(
      'status_details->0->>name.eq.InTransit,' +
      'status_details->0->>name.eq.OutForDelivery,' +
      'status_details->0->>name.eq.DeliveryException,' +
      'status_details->0->>name.eq.DeliveryAttemptFailed,' +
      'status_details->0->>name.eq.AwaitingCarrierScan,' +
      'status.eq.LabeledCreated,' +
      'status.eq.AwaitingCarrierScan,' +
      'status.eq.Completed' // Completed but no delivery event = stuck
    )
    .order('event_labeled', { ascending: true })
    .limit(limit)

  if (error) {
    console.error('[At-Risk] Error fetching candidates:', error)
    return []
  }

  return (shipments || []).filter((s: { tracking_id: string | null; client_id: string | null }) => s.tracking_id && s.client_id) as AtRiskShipment[]
}

/**
 * Get shipments that are candidates but NOT already in lost_in_transit_checks
 */
export async function getNewAtRiskCandidates(
  minDaysOld: number = 15,
  limit: number = 500
): Promise<AtRiskShipment[]> {
  const supabase = createAdminClient()

  // Get all candidates
  const candidates = await getAtRiskCandidates(minDaysOld, limit * 2)

  if (candidates.length === 0) return []

  // Get shipment IDs already in lost_in_transit_checks
  const { data: existingChecks } = await supabase
    .from('lost_in_transit_checks')
    .select('shipment_id')
    .in('shipment_id', candidates.map(c => c.shipment_id))

  const existingIds = new Set((existingChecks || []).map((c: { shipment_id: string }) => c.shipment_id))

  // Filter out already-checked shipments
  return candidates
    .filter(c => !existingIds.has(c.shipment_id))
    .slice(0, limit)
}

/**
 * Calculate eligibility status based on TrackingMore data
 */
export function calculateEligibility(
  tracking: TrackingMoreTracking | null,
  shipment: AtRiskShipment,
  labelDate: Date
): EligibilityResult {
  const isInternational = shipment.origin_country !== shipment.destination_country
  const requiredDays = isInternational
    ? LOST_IN_TRANSIT_INTERNATIONAL_DAYS
    : LOST_IN_TRANSIT_DOMESTIC_DAYS

  // Default result for when tracking fails
  const baseResult: EligibilityResult = {
    status: null,
    daysSinceLastScan: null,
    daysRemaining: null,
    eligibleAfter: null,
    isInternational,
    requiredDays,
    lastScanDate: null,
    lastScanDescription: null,
    lastScanLocation: null,
    isDelivered: false,
    trackingMoreId: null,
  }

  // If no tracking data, use label date as fallback
  if (!tracking) {
    const daysSinceLabel = Math.floor(
      (Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysSinceLabel >= requiredDays) {
      return {
        ...baseResult,
        status: 'eligible',
        daysSinceLastScan: daysSinceLabel,
        daysRemaining: 0,
        eligibleAfter: labelDate,
        lastScanDescription: 'No carrier data available',
      }
    }

    return {
      ...baseResult,
      status: 'at_risk',
      daysSinceLastScan: daysSinceLabel,
      daysRemaining: requiredDays - daysSinceLabel,
      eligibleAfter: new Date(labelDate.getTime() + requiredDays * 24 * 60 * 60 * 1000),
      lastScanDescription: 'No carrier data available',
    }
  }

  // Check if delivered
  if (isDelivered(tracking)) {
    return {
      ...baseResult,
      status: null, // Not at risk, delivered
      isDelivered: true,
      trackingMoreId: tracking.id,
    }
  }

  // Get last checkpoint info
  const lastCheckpointDate = getLastCheckpointDate(tracking)
  const daysSince = daysSinceLastCheckpoint(tracking)

  // If no checkpoint data, use label date
  if (!lastCheckpointDate || daysSince === null) {
    const daysSinceLabel = Math.floor(
      (Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    const eligibleAfterDate = new Date(labelDate.getTime() + requiredDays * 24 * 60 * 60 * 1000)

    if (daysSinceLabel >= requiredDays) {
      return {
        ...baseResult,
        status: 'eligible',
        daysSinceLastScan: daysSinceLabel,
        daysRemaining: 0,
        eligibleAfter: eligibleAfterDate,
        lastScanDescription: tracking.latest_event || 'Never scanned by carrier',
        trackingMoreId: tracking.id,
      }
    }

    return {
      ...baseResult,
      status: 'at_risk',
      daysSinceLastScan: daysSinceLabel,
      daysRemaining: requiredDays - daysSinceLabel,
      eligibleAfter: eligibleAfterDate,
      lastScanDescription: tracking.latest_event || 'Never scanned by carrier',
      trackingMoreId: tracking.id,
    }
  }

  // Calculate eligibility based on last checkpoint
  const eligibleAfterDate = new Date(
    lastCheckpointDate.getTime() + requiredDays * 24 * 60 * 60 * 1000
  )

  // Get checkpoint details
  const checkpoints = [
    ...(tracking.origin_info?.trackinfo || []),
    ...(tracking.destination_info?.trackinfo || []),
  ].sort((a, b) => new Date(b.checkpoint_date).getTime() - new Date(a.checkpoint_date).getTime())

  const lastCheckpoint = checkpoints[0]

  if (daysSince >= requiredDays) {
    return {
      ...baseResult,
      status: 'eligible',
      daysSinceLastScan: daysSince,
      daysRemaining: 0,
      eligibleAfter: eligibleAfterDate,
      lastScanDate: lastCheckpointDate,
      lastScanDescription: lastCheckpoint?.tracking_detail || tracking.latest_event || null,
      lastScanLocation: lastCheckpoint?.location || null,
      trackingMoreId: tracking.id,
    }
  }

  return {
    ...baseResult,
    status: 'at_risk',
    daysSinceLastScan: daysSince,
    daysRemaining: requiredDays - daysSince,
    eligibleAfter: eligibleAfterDate,
    lastScanDate: lastCheckpointDate,
    lastScanDescription: lastCheckpoint?.tracking_detail || tracking.latest_event || null,
    lastScanLocation: lastCheckpoint?.location || null,
    trackingMoreId: tracking.id,
  }
}

/**
 * Process a shipment: Create tracking in TrackingMore and calculate eligibility
 *
 * This COSTS $0.04 per shipment (creates a new tracking)
 */
export async function processAtRiskShipment(
  shipment: AtRiskShipment
): Promise<{ success: boolean; eligibility?: EligibilityResult; error?: string }> {
  // Validate carrier code
  const carrierCode = getTrackingMoreCarrierCode(shipment.carrier)
  if (!carrierCode) {
    return {
      success: false,
      error: `Unsupported carrier: ${shipment.carrier}`,
    }
  }

  // Create/fetch tracking from TrackingMore
  const trackingResult = await getTracking(shipment.tracking_id, shipment.carrier)

  if (!trackingResult.success) {
    // DO NOT mark as eligible without TrackingMore data
    // We need actual carrier checkpoint data to verify lost in transit
    return {
      success: false,
      error: trackingResult.error || 'TrackingMore lookup failed',
    }
  }

  const eligibility = calculateEligibility(
    trackingResult.tracking!,
    shipment,
    new Date(shipment.event_labeled)
  )

  return {
    success: true,
    eligibility,
  }
}

/**
 * Get existing tracking from TrackingMore (FREE)
 *
 * Use this for rechecks after initial creation
 */
export async function recheckTracking(
  trackingNumber: string,
  carrier: string
): Promise<TrackingResult> {
  // getTracking checks for existing tracking first (free),
  // only creates if not found
  return getTracking(trackingNumber, carrier)
}

/**
 * Get shipments currently marked as at_risk that need rechecking
 */
export async function getAtRiskShipmentsForRecheck(
  limit: number = 200
): Promise<Array<{
  shipment_id: string
  tracking_number: string
  carrier: string
  client_id: string
  origin_country: string | null
  destination_country: string | null
  eligible_after: string
  last_recheck_at: string | null
}>> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('lost_in_transit_checks')
    .select(`
      shipment_id,
      tracking_number,
      carrier,
      client_id,
      eligible_after,
      last_recheck_at
    `)
    .eq('claim_eligibility_status', 'at_risk')
    .order('last_recheck_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error) {
    console.error('[At-Risk] Error fetching for recheck:', error)
    return []
  }

  // Join with shipments to get country info for international determination
  const shipmentIds = (data || []).map(d => d.shipment_id)

  if (shipmentIds.length === 0) return []

  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, origin_country, destination_country')
    .in('shipment_id', shipmentIds)

  const shipmentMap = new Map(
    (shipments || []).map(s => [s.shipment_id, s])
  )

  return (data || []).map(d => ({
    ...d,
    origin_country: shipmentMap.get(d.shipment_id)?.origin_country || null,
    destination_country: shipmentMap.get(d.shipment_id)?.destination_country || null,
  }))
}
