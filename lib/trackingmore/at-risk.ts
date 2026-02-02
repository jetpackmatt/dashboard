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
  isReturned,
  daysSinceLastCheckpoint,
  getLastCheckpointDate,
  type TrackingMoreTracking,
  type TrackingResult,
} from './client'
import { storeCheckpoints } from './checkpoint-storage'

// Thresholds for Lost in Transit eligibility (minimum days before filing)
export const LOST_IN_TRANSIT_DOMESTIC_DAYS = 15
export const LOST_IN_TRANSIT_INTERNATIONAL_DAYS = 20

// Filing window limits (maximum days before window expires)
export const FILING_WINDOW_DOMESTIC_MAX_DAYS = 45
export const FILING_WINDOW_INTERNATIONAL_MAX_DAYS = 50

/**
 * Claim eligibility status values (full lifecycle):
 *
 * - null: Not tracked (delivered, returned, or not yet checked)
 * - 'at_risk': Potentially lost, waiting for eligibility threshold (15/20 days)
 * - 'eligible': Eligible for claim, awaiting user action ("File a Claim")
 * - 'claim_filed': Claim submitted via Jetpack Care ("Credit Requested")
 * - 'approved': ShipBob approved the credit ("Credit Approved")
 * - 'denied': ShipBob denied the credit ("Credit Denied")
 * - 'missed_window': Filing window expired (>45 days domestic, >50 days international)
 */
export type ClaimEligibilityStatus = 'at_risk' | 'eligible' | 'claim_filed' | 'approved' | 'denied' | 'missed_window' | null

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
  // Status filter: Processing (labeled but no carrier scan), In Transit, Out for Delivery, Exception
  // Key requirement: event_labeled must exist (label was created, package handed to carrier)
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
    // Processing = labeled but carrier never scanned (lost at pickup)
    .or(
      'status_details->0->>name.eq.Processing,' +
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
 * Get shipment IDs that have been replaced by a newer shipment for the same order
 * (reshipment scenario - original shipment failed, replacement was created)
 *
 * These should be excluded from at-risk tracking since the customer already
 * received a replacement shipment.
 */
export async function getReplacedShipmentIds(
  shipmentIds: string[]
): Promise<Set<string>> {
  if (shipmentIds.length === 0) return new Set()

  const supabase = createAdminClient()

  // Get order_ids for these shipments
  const { data: shipmentData } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, event_labeled')
    .in('shipment_id', shipmentIds)
    .not('order_id', 'is', null)

  if (!shipmentData || shipmentData.length === 0) return new Set()

  type ShipmentData = { shipment_id: string; order_id: string; event_labeled: string }
  const orderIds = [...new Set((shipmentData as ShipmentData[]).map(s => s.order_id))]
  const shipmentLabelDates = new Map<string, Date>(
    (shipmentData as ShipmentData[]).map(s => [s.shipment_id, new Date(s.event_labeled)])
  )
  const shipmentOrderMap = new Map<string, string>(
    (shipmentData as ShipmentData[]).map(s => [s.shipment_id, s.order_id])
  )

  // Find orders that have a delivered shipment
  const { data: deliveredSiblings } = await supabase
    .from('shipments')
    .select('order_id, shipment_id, event_labeled, event_delivered')
    .in('order_id', orderIds)
    .not('event_delivered', 'is', null)

  if (!deliveredSiblings || deliveredSiblings.length === 0) return new Set()

  // Build a map of order_id -> delivered shipments
  type DeliveredSibling = { order_id: string; shipment_id: string; event_labeled: string; event_delivered: string }
  const deliveredByOrder = new Map<string, DeliveredSibling[]>()
  for (const sibling of (deliveredSiblings as DeliveredSibling[])) {
    const existing = deliveredByOrder.get(sibling.order_id) || []
    existing.push(sibling)
    deliveredByOrder.set(sibling.order_id, existing)
  }

  // A shipment is "replaced" if:
  // 1. Same order has a newer shipment that was delivered
  // 2. The replacement was labeled AFTER the original
  const replacedIds = new Set<string>()

  for (const shipmentId of shipmentIds) {
    const orderId = shipmentOrderMap.get(shipmentId)
    if (!orderId) continue

    const labelDate = shipmentLabelDates.get(shipmentId)
    if (!labelDate) continue

    const deliveredSibs = deliveredByOrder.get(orderId) || []

    // Check if any delivered sibling was labeled after this shipment
    for (const sibling of deliveredSibs) {
      if (sibling.shipment_id === shipmentId) continue

      const siblingLabelDate = new Date(sibling.event_labeled)
      if (siblingLabelDate > labelDate) {
        // This shipment was replaced by a newer, delivered shipment
        replacedIds.add(shipmentId)
        break
      }
    }
  }

  return replacedIds
}

/**
 * Get shipments that are candidates but NOT already in lost_in_transit_checks
 *
 * Note: We intentionally do NOT filter out reshipments. If a shipment was lost
 * and a replacement was sent, the original shipment is STILL eligible for a claim.
 * The claim lifecycle will track it through: at_risk -> eligible -> claim_filed -> approved/denied
 *
 * We DO filter out shipments that already have resolved Loss care_tickets,
 * since those already have a claim filed/processed.
 */
export async function getNewAtRiskCandidates(
  minDaysOld: number = 15,
  limit: number = 500
): Promise<AtRiskShipment[]> {
  const supabase = createAdminClient()

  // Get all candidates
  const candidates = await getAtRiskCandidates(minDaysOld, limit * 2)

  if (candidates.length === 0) return []

  const candidateShipmentIds = candidates.map(c => c.shipment_id)

  // Get shipment IDs already in lost_in_transit_checks
  const { data: existingChecks } = await supabase
    .from('lost_in_transit_checks')
    .select('shipment_id')
    .in('shipment_id', candidateShipmentIds)

  const existingIds = new Set((existingChecks || []).map((c: { shipment_id: string }) => c.shipment_id))

  // Get shipment IDs that already have resolved Loss care_tickets
  const { data: existingClaims } = await supabase
    .from('care_tickets')
    .select('shipment_id')
    .in('shipment_id', candidateShipmentIds)
    .eq('issue_type', 'Loss')
    .in('status', ['Resolved', 'Credit Approved', 'Credit Requested'])

  const claimedIds = new Set((existingClaims || []).map((c: { shipment_id: string }) => c.shipment_id))

  // Filter out already-checked shipments AND shipments with existing claims
  return candidates
    .filter(c => !existingIds.has(c.shipment_id) && !claimedIds.has(c.shipment_id))
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

  // CRITICAL: If no tracking data, return null status
  // We NEVER mark as eligible without TrackingMore confirmation
  if (!tracking) {
    return {
      ...baseResult,
      status: null, // Cannot determine eligibility without tracking data
      lastScanDescription: 'No carrier data available',
    }
  }

  // Check if delivered (enhanced check includes checkpoint descriptions)
  if (isDelivered(tracking)) {
    return {
      ...baseResult,
      status: null, // Not at risk, delivered
      isDelivered: true,
      trackingMoreId: tracking.id,
    }
  }

  // Check if returned to sender (not lost in transit)
  if (isReturned(tracking)) {
    return {
      ...baseResult,
      status: null, // Not at risk, returned
      trackingMoreId: tracking.id,
      lastScanDescription: tracking.latest_event || 'Returned to sender',
    }
  }

  // Get last checkpoint info
  const lastCheckpointDate = getLastCheckpointDate(tracking)
  const daysSince = daysSinceLastCheckpoint(tracking)

  // CRITICAL: If no checkpoint data, mark as at_risk only (pending recheck)
  // We NEVER mark as eligible without actual checkpoint data
  if (!lastCheckpointDate || daysSince === null) {
    const daysSinceLabel = Math.floor(
      (Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    // Use label date for estimated eligibility date, but status is at_risk (not eligible)
    const eligibleAfterDate = new Date(labelDate.getTime() + requiredDays * 24 * 60 * 60 * 1000)

    return {
      ...baseResult,
      status: 'at_risk', // Never 'eligible' without checkpoint data
      daysSinceLastScan: daysSinceLabel,
      daysRemaining: Math.max(0, requiredDays - daysSinceLabel),
      eligibleAfter: eligibleAfterDate,
      lastScanDescription: tracking.latest_event || 'Awaiting carrier scan data',
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

  // Check filing window limits
  const maxDays = isInternational
    ? FILING_WINDOW_INTERNATIONAL_MAX_DAYS
    : FILING_WINDOW_DOMESTIC_MAX_DAYS

  // If past the filing window, mark as missed
  if (daysSince > maxDays) {
    return {
      ...baseResult,
      status: 'missed_window',
      daysSinceLastScan: daysSince,
      daysRemaining: 0,
      eligibleAfter: eligibleAfterDate,
      lastScanDate: lastCheckpointDate,
      lastScanDescription: lastCheckpoint?.tracking_detail || tracking.latest_event || null,
      lastScanLocation: lastCheckpoint?.location || null,
      trackingMoreId: tracking.id,
    }
  }

  // If within the filing window and past the minimum threshold, eligible to file
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
 *
 * IMPORTANT: Also stores ALL checkpoints permanently for survival analysis (Tier 2 data)
 */
export async function processAtRiskShipment(
  shipment: AtRiskShipment
): Promise<{ success: boolean; eligibility?: EligibilityResult; error?: string; checkpointsStored?: number }> {
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

  // CRITICAL: Store ALL checkpoints permanently for survival analysis
  // This is Tier 2 data - granular carrier scan data that expires in TrackingMore after ~4 months
  let checkpointsStored = 0
  if (trackingResult.tracking) {
    try {
      const storageResult = await storeCheckpoints(
        shipment.shipment_id,
        trackingResult.tracking,
        shipment.carrier
      )
      checkpointsStored = storageResult.stored
    } catch (err) {
      // Log but don't fail the whole operation - checkpoint storage is secondary
      console.error('[At-Risk] Failed to store checkpoints:', err)
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
    checkpointsStored,
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
 * Recheck tracking and store any new checkpoints
 *
 * This is FREE (uses existing tracking) and also stores checkpoints permanently.
 * Use this for rechecks to ensure we capture all checkpoint data over time.
 */
export async function recheckTrackingWithStorage(
  shipmentId: string,
  trackingNumber: string,
  carrier: string
): Promise<TrackingResult & { checkpointsStored?: number }> {
  const result = await recheckTracking(trackingNumber, carrier)

  if (result.success && result.tracking) {
    try {
      const storageResult = await storeCheckpoints(
        shipmentId,
        result.tracking,
        carrier
      )
      return {
        ...result,
        checkpointsStored: storageResult.stored,
      }
    } catch (err) {
      console.error('[At-Risk] Failed to store checkpoints on recheck:', err)
      // Return original result if checkpoint storage fails
      return { ...result, checkpointsStored: 0 }
    }
  }

  return result
}

/**
 * Check if a shipment already has a Loss claim (care_ticket) in progress or resolved
 *
 * Returns true if a claim exists, meaning we should NOT mark the shipment as eligible
 */
export async function hasExistingLossClaim(shipmentId: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('care_tickets')
    .select('id')
    .eq('shipment_id', shipmentId)
    .eq('issue_type', 'Loss')
    .in('status', ['Resolved', 'Credit Approved', 'Credit Requested', 'Under Review'])
    .limit(1)

  if (error) {
    console.error('[At-Risk] Error checking for existing claim:', error)
    return false // On error, allow the update to proceed
  }

  return (data || []).length > 0
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
  type CheckRecord = { shipment_id: string; tracking_number: string; carrier: string; client_id: string; eligible_after: string; last_recheck_at: string | null }
  const shipmentIds = (data || []).map((d: CheckRecord) => d.shipment_id)

  if (shipmentIds.length === 0) return []

  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, origin_country, destination_country')
    .in('shipment_id', shipmentIds)

  type ShipmentRecord = { shipment_id: string; origin_country: string | null; destination_country: string | null }
  const shipmentMap = new Map<string, ShipmentRecord>(
    (shipments || []).map((s: ShipmentRecord) => [s.shipment_id, s])
  )

  return (data || []).map((d: CheckRecord) => ({
    ...d,
    origin_country: shipmentMap.get(d.shipment_id)?.origin_country || null,
    destination_country: shipmentMap.get(d.shipment_id)?.destination_country || null,
  }))
}
