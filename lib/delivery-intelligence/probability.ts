/**
 * Delivery Probability Calculator
 *
 * Provides real-time delivery probability estimates for shipments
 * using pre-computed survival curves and hazard factors.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  getSurvivalCurveWithFallback,
  interpolateSurvivalProbability,
  getDeliveryProbabilityAtDay,
  type SurvivalCurve,
} from './survival-analysis'
import {
  getZoneBucket,
  getServiceBucket,
  getSeasonBucket,
  checkEventLogsForException,
} from './feature-extraction'

// =============================================================================
// Types
// =============================================================================

export interface DeliveryProbabilityResult {
  // Core probability
  deliveryProbability: number // 0-1, chance of eventual delivery
  stillInTransitProbability: number // 0-1, chance still in transit at this point

  // Time context
  daysInTransit: number
  expectedDeliveryDay: number | null // median days for this segment

  // Risk assessment
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  riskFactors: string[]

  // Confidence
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  sampleSize: number

  // Segment info
  segmentUsed: {
    carrier: string
    service_bucket: string
    zone_bucket: string
    season_bucket: string
  }

  // Percentile context
  percentiles: {
    p50: number | null
    p75: number | null
    p90: number | null
    p95: number | null
  }

  // Terminal state (if package has reached a final state)
  terminalState?: {
    isTerminal: boolean
    isPositive: boolean  // true = good outcome (held for pickup)
    reason: string | null
    probability: number
  }
}

interface ShipmentData {
  shipment_id: string
  carrier: string
  carrier_service: string | null
  zone_used: number | null
  event_intransit: string | null
  event_outfordelivery: string | null
  event_delivered: string | null
  event_deliveryattemptfailed: string | null
  event_logs: unknown[] | null
}

// =============================================================================
// Main Probability Calculation
// =============================================================================

/**
 * Calculate delivery probability for a shipment
 */
export async function calculateDeliveryProbability(
  shipmentId: string
): Promise<DeliveryProbabilityResult | null> {
  const supabase = createAdminClient()

  // Fetch shipment data, latest checkpoint, and first transit checkpoint in parallel
  const [shipmentResult, latestCheckpointResult, firstTransitResult] = await Promise.all([
    supabase
      .from('shipments')
      .select(`
        shipment_id,
        carrier,
        carrier_service,
        zone_used,
        event_intransit,
        event_outfordelivery,
        event_delivered,
        event_deliveryattemptfailed,
        event_logs
      `)
      .eq('shipment_id', shipmentId)
      .single(),
    // Latest checkpoint for status assessment
    supabase
      .from('tracking_checkpoints')
      .select('normalized_type, raw_status, raw_description, sentiment')
      .eq('shipment_id', shipmentId)
      .order('checkpoint_date', { ascending: false })
      .limit(1)
      .single(),
    // First transit checkpoint (skip label creation and pre-transit events) for fallback transit start
    supabase
      .from('tracking_checkpoints')
      .select('checkpoint_date')
      .eq('shipment_id', shipmentId)
      .not('raw_description', 'ilike', '%label%created%')
      .not('raw_description', 'ilike', '%pre-shipment%')
      .not('raw_description', 'ilike', '%readyforreceive%')
      .not('raw_description', 'ilike', '%pickupcancelled%')
      .not('raw_description', 'ilike', '%pickup cancelled%')
      .not('raw_description', 'ilike', '%pickup%cancel%')
      .order('checkpoint_date', { ascending: true })
      .limit(1)
      .single()
  ])

  if (shipmentResult.error || !shipmentResult.data) {
    console.error('[Probability] Error fetching shipment:', shipmentResult.error)
    return null
  }

  // Get checkpoint data (may not exist)
  const latestCheckpoint = latestCheckpointResult.data
  const firstTransitCheckpoint = firstTransitResult.data

  return calculateProbabilityForShipment(
    shipmentResult.data as ShipmentData,
    latestCheckpoint,
    firstTransitCheckpoint
  )
}

// Types for checkpoint data
interface LatestCheckpoint {
  normalized_type: string | null
  raw_status: string | null
  raw_description: string | null
  sentiment: string | null
}

/**
 * Check if tracking status indicates a terminal state
 * Returns both positive (held for pickup) and negative (return, seized) terminal states
 */
function getTerminalState(checkpoint: LatestCheckpoint | null): {
  isTerminal: boolean
  isPositive: boolean  // true = good outcome (held for pickup), false = bad outcome (return, seized)
  reason: string | null
  probability: number
} {
  if (!checkpoint) {
    return { isTerminal: false, isPositive: false, reason: null, probability: 1 }
  }

  const normalizedType = checkpoint.normalized_type?.toUpperCase()
  const rawStatus = checkpoint.raw_status?.toLowerCase() || ''
  const rawDesc = checkpoint.raw_description?.toLowerCase() || ''

  // =========================================================================
  // POSITIVE TERMINAL STATES (package is safe, waiting for customer action)
  // =========================================================================

  // HOLD with pickup status = package is at carrier location, waiting for customer
  // This is a SUCCESS scenario - package arrived safely
  if (normalizedType === 'HOLD' && rawStatus === 'pickup') {
    return { isTerminal: true, isPositive: true, reason: 'held_for_pickup', probability: 1 }
  }

  // Explicit "available for pickup" patterns (even without normalized type)
  if (rawDesc.includes('available for pickup') ||
      rawDesc.includes('ready for pickup') ||
      rawDesc.includes('awaiting collection') ||
      (rawDesc.includes('held at') && rawDesc.includes('customer request')) ||
      (rawDesc.includes('held for pickup') && !rawDesc.includes('exception'))) {
    return { isTerminal: true, isPositive: true, reason: 'held_for_pickup', probability: 1 }
  }

  // =========================================================================
  // NEGATIVE TERMINAL STATES (package won't be delivered as intended)
  // =========================================================================

  // RETURN type = package going back to sender = 0% delivery
  // This is a terminal state - item will return to warehouse, not a loss claim scenario
  if (normalizedType === 'RETURN') {
    return { isTerminal: true, isPositive: false, reason: 'returned_to_shipper', probability: 0 }
  }

  // Check raw status for return indicators
  if (rawStatus.includes('return') || rawDesc.includes('return to sender') || rawDesc.includes('returned to shipper')) {
    return { isTerminal: true, isPositive: false, reason: 'returned_to_shipper', probability: 0 }
  }

  // Refused delivery = terminal, item will be returned
  if (rawDesc.includes('refused') || rawStatus.includes('refused')) {
    return { isTerminal: true, isPositive: false, reason: 'delivery_refused', probability: 0 }
  }

  // Seized/confiscated = terminal, item is gone
  if (rawDesc.includes('seized') || rawDesc.includes('confiscated') || rawDesc.includes('customs rejected')) {
    return { isTerminal: true, isPositive: false, reason: 'seized_or_confiscated', probability: 0 }
  }

  // =========================================================================
  // NON-TERMINAL RISK FACTORS (still in transit, but with modifiers)
  // =========================================================================

  // Unable to locate with extended delay = very low probability
  if ((rawDesc.includes('unable to locate') || rawDesc.includes('cannot locate')) && checkpoint.sentiment === 'critical') {
    return { isTerminal: false, isPositive: false, reason: 'unable_to_locate', probability: 0.15 }
  }

  // On hold at customs for extended period with critical sentiment
  if (normalizedType === 'CUSTOMS' && checkpoint.sentiment === 'critical') {
    return { isTerminal: false, isPositive: false, reason: 'customs_delay', probability: 0.40 }
  }

  // General EXCEPTION - non-descript, don't modify probability
  // Let the empirical zone-based rate stand on its own

  return { isTerminal: false, isPositive: false, reason: null, probability: 1 }
}

/**
 * Calculate probability from shipment data (internal)
 */
export async function calculateProbabilityForShipment(
  shipment: ShipmentData,
  latestCheckpoint?: LatestCheckpoint | null,
  firstTransitCheckpoint?: { checkpoint_date: string } | null
): Promise<DeliveryProbabilityResult | null> {
  // Determine transit start: prefer event_intransit, fall back to first checkpoint
  const transitStartDate = shipment.event_intransit || firstTransitCheckpoint?.checkpoint_date

  if (!transitStartDate) {
    return null
  }

  // If already delivered, probability is 1
  if (shipment.event_delivered) {
    const transitStart = new Date(transitStartDate)
    const delivered = new Date(shipment.event_delivered)
    const daysInTransit = (delivered.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)

    return {
      deliveryProbability: 1.0,
      stillInTransitProbability: 0,
      daysInTransit: Math.round(daysInTransit * 100) / 100,
      expectedDeliveryDay: null,
      riskLevel: 'low',
      riskFactors: [],
      confidence: 'high',
      sampleSize: 0,
      segmentUsed: {
        carrier: shipment.carrier,
        service_bucket: getServiceBucket(shipment.carrier_service),
        zone_bucket: getZoneBucket(shipment.zone_used),
        season_bucket: 'delivered',
      },
      percentiles: { p50: null, p75: null, p90: null, p95: null },
    }
  }

  // Check for terminal states from tracking checkpoints (positive or negative)
  const terminalCheck = getTerminalState(latestCheckpoint || null)

  // POSITIVE TERMINAL STATE: Held for customer pickup = success!
  // Package is safe at carrier facility, waiting for customer
  if (terminalCheck.isTerminal && terminalCheck.isPositive) {
    const transitStart = new Date(transitStartDate)
    const now = new Date()
    const daysInTransit = (now.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)

    return {
      deliveryProbability: 1.0,
      stillInTransitProbability: 0,
      daysInTransit: Math.round(daysInTransit * 100) / 100,
      expectedDeliveryDay: null,
      riskLevel: 'low',
      riskFactors: terminalCheck.reason ? [terminalCheck.reason] : [],
      confidence: 'high',
      sampleSize: 0,
      segmentUsed: {
        carrier: shipment.carrier,
        service_bucket: getServiceBucket(shipment.carrier_service),
        zone_bucket: getZoneBucket(shipment.zone_used),
        season_bucket: 'held_for_pickup',
      },
      percentiles: { p50: null, p75: null, p90: null, p95: null },
      terminalState: terminalCheck,
    }
  }

  // Calculate days in transit
  const transitStart = new Date(transitStartDate)
  const now = new Date()
  const daysInTransit = (now.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)

  // Get segment parameters
  const zoneBucket = getZoneBucket(shipment.zone_used)
  const serviceBucket = getServiceBucket(shipment.carrier_service)
  const seasonBucket = getSeasonBucket(transitStart)

  // Get survival curve with fallback
  const curve = await getSurvivalCurveWithFallback(
    shipment.carrier,
    shipment.carrier_service,
    serviceBucket,
    zoneBucket,
    seasonBucket
  )

  if (!curve) {
    // No curve available - return null or basic estimate
    return {
      deliveryProbability: 0.95, // Default optimistic estimate
      stillInTransitProbability: interpolateBasicSurvival(daysInTransit),
      daysInTransit: Math.round(daysInTransit * 100) / 100,
      expectedDeliveryDay: 4, // Default median
      riskLevel: getRiskLevel(daysInTransit, []),
      riskFactors: [],
      confidence: 'insufficient',
      sampleSize: 0,
      segmentUsed: {
        carrier: shipment.carrier,
        service_bucket: serviceBucket,
        zone_bucket: zoneBucket,
        season_bucket: seasonBucket,
      },
      percentiles: { p50: null, p75: null, p90: null, p95: null },
    }
  }

  // Calculate survival probability (still in transit)
  const stillInTransitProb = interpolateSurvivalProbability(curve.curve_data, daysInTransit)

  // Collect risk factors first (needed for probability calculation)
  const riskFactors: string[] = []
  const hasException = checkEventLogsForException(shipment.event_logs)
  if (hasException) {
    riskFactors.push('exception_detected')
  }
  if (shipment.event_deliveryattemptfailed) {
    riskFactors.push('delivery_attempt_failed')
  }
  if (daysInTransit > (curve.p90_days || 7)) {
    riskFactors.push('past_p90_delivery_time')
  }
  if (daysInTransit > (curve.p95_days || 10)) {
    riskFactors.push('past_p95_delivery_time')
  }

  // Calculate delivery probability using Bayesian approach:
  // P(delivers | overdue, risk_factors)
  //
  // Key insight: If a package SHOULD have delivered by now (past P95) but hasn't,
  // and especially if it has exceptions, the probability drops significantly.
  //
  // Historical delivery rate is ~99%, but that doesn't apply to packages that
  // are already showing signs of being lost.

  const deliveryRate = curve.delivered_count / curve.sample_size
  const p50 = curve.median_days || 3
  const p95 = curve.p95_days || 7

  // Calculate how overdue the package is (ratio of current days to expected P95)
  const overdueRatio = daysInTransit / p95

  // Base probability starts at delivery rate
  let eventualDeliveryProb = deliveryRate

  // If within normal delivery window, use historical rate
  if (daysInTransit <= p95) {
    // Package is within expected delivery window - use high probability
    eventualDeliveryProb = deliveryRate
  } else {
    // Package is overdue - apply decay based on how overdue it is
    // The longer overdue, the lower the probability
    //
    // Formula: prob = baseRate * decay^(overdueRatio - 1)
    // At P95: prob = 99%
    // At 2x P95: prob = 99% * 0.7 = 69%
    // At 3x P95: prob = 99% * 0.49 = 48%
    // At 4x P95: prob = 99% * 0.34 = 34%

    const decayFactor = 0.7 // 30% reduction per P95 interval
    const intervalsOverdue = overdueRatio - 1
    const overdueDecay = Math.pow(decayFactor, intervalsOverdue)

    eventualDeliveryProb = deliveryRate * overdueDecay
  }

  // Apply additional penalties for risk factors
  // Exception detected: significant penalty (packages with exceptions are more likely to be lost)
  if (hasException) {
    // Exception penalty increases the longer the package is overdue
    // At P95: 10% penalty
    // At 2x P95: 25% penalty
    // At 4x P95: 50% penalty
    const exceptionPenalty = Math.min(0.5, 0.1 * overdueRatio)
    eventualDeliveryProb *= (1 - exceptionPenalty)
  }

  // Failed delivery attempt: moderate penalty
  if (shipment.event_deliveryattemptfailed) {
    eventualDeliveryProb *= 0.85 // 15% penalty
  }

  // Apply terminal state override from tracking checkpoints
  // This takes precedence over statistical calculations
  if (terminalCheck.isTerminal || terminalCheck.probability < 1) {
    // Cap probability at the terminal state probability
    eventualDeliveryProb = Math.min(eventualDeliveryProb, terminalCheck.probability)

    // Add appropriate risk factor
    if (terminalCheck.reason) {
      riskFactors.push(terminalCheck.reason)
    }
  }

  // Ensure probability stays in valid range
  eventualDeliveryProb = Math.max(0.01, Math.min(0.999, eventualDeliveryProb))

  // Calculate risk level (risk factors already collected above)
  const riskLevel = getRiskLevel(daysInTransit, riskFactors, curve, terminalCheck)

  return {
    deliveryProbability: Math.round(eventualDeliveryProb * 1000) / 1000,
    stillInTransitProbability: Math.round(stillInTransitProb * 1000) / 1000,
    daysInTransit: Math.round(daysInTransit * 100) / 100,
    expectedDeliveryDay: curve.median_days,
    riskLevel,
    riskFactors,
    confidence: curve.confidence_level,
    sampleSize: curve.sample_size,
    segmentUsed: {
      carrier: curve.carrier,
      service_bucket: curve.service_bucket,
      zone_bucket: curve.zone_bucket,
      season_bucket: curve.season_bucket,
    },
    percentiles: {
      p50: curve.median_days,
      p75: curve.p75_days,
      p90: curve.p90_days,
      p95: curve.p95_days,
    },
    // Include terminal state if applicable (for negative terminal states like return, seized)
    ...(terminalCheck.isTerminal || terminalCheck.probability < 1 ? { terminalState: terminalCheck } : {}),
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Basic survival interpolation when no curve is available
 */
function interpolateBasicSurvival(daysInTransit: number): number {
  // Simple exponential decay model as fallback
  // Assumes ~95% delivered by day 5, ~99% by day 10
  const rate = 0.5 // decay rate
  return Math.exp(-rate * daysInTransit)
}

/**
 * Calculate risk level based on days and factors
 */
function getRiskLevel(
  daysInTransit: number,
  riskFactors: string[],
  curve?: SurvivalCurve,
  terminalCheck?: { isTerminal: boolean; isPositive: boolean; reason: string | null; probability: number }
): 'low' | 'medium' | 'high' | 'critical' {
  // Positive terminal states (held for pickup) = low risk (success!)
  if (terminalCheck?.isTerminal && terminalCheck?.isPositive) {
    return 'low'
  }

  // Negative terminal states are always critical
  if (terminalCheck?.isTerminal && !terminalCheck?.isPositive) {
    return 'critical'
  }

  // Very low probability from tracking status = critical
  if (terminalCheck && terminalCheck.probability < 0.3) {
    return 'critical'
  }

  const hasException = riskFactors.includes('exception_detected')
  const hasFailedAttempt = riskFactors.includes('delivery_attempt_failed')
  const pastP90 = riskFactors.includes('past_p90_delivery_time')
  const pastP95 = riskFactors.includes('past_p95_delivery_time')
  const hasTerminalReason = riskFactors.includes('returned_to_shipper') ||
    riskFactors.includes('delivery_refused') ||
    riskFactors.includes('seized_or_confiscated') ||
    riskFactors.includes('unable_to_locate') ||
    riskFactors.includes('critical_exception')

  // Terminal reasons = critical
  if (hasTerminalReason) {
    return 'critical'
  }

  // Critical: Past P95 with exception or failed attempt
  if (pastP95 && (hasException || hasFailedAttempt)) {
    return 'critical'
  }

  // Critical: Way past expected delivery (15+ days)
  if (daysInTransit > 15 && hasException) {
    return 'critical'
  }

  // High: Past P95 or exception detected
  if (pastP95 || (hasException && daysInTransit > 8)) {
    return 'high'
  }

  // Medium: Past P90 or has risk factors
  if (pastP90 || hasFailedAttempt || (daysInTransit > 8 && riskFactors.length > 0)) {
    return 'medium'
  }

  // Low: Normal transit
  return 'low'
}

/**
 * Get probability summary for display
 */
export function getProbabilitySummary(result: DeliveryProbabilityResult): string {
  const pct = Math.round(result.deliveryProbability * 100)

  if (result.deliveryProbability >= 0.99) {
    return 'Very likely to deliver'
  }

  if (result.deliveryProbability >= 0.95) {
    return `${pct}% likely to deliver`
  }

  if (result.deliveryProbability >= 0.85) {
    return `${pct}% delivery probability - monitor closely`
  }

  if (result.deliveryProbability >= 0.70) {
    return `${pct}% delivery probability - at risk`
  }

  return `${pct}% delivery probability - high risk of loss`
}

/**
 * Get recommended action based on probability
 */
export function getRecommendedAction(result: DeliveryProbabilityResult): string {
  if (result.riskLevel === 'critical') {
    if (result.riskFactors.includes('exception_detected')) {
      return 'File lost in transit claim or consider reshipment'
    }
    return 'Contact carrier for investigation'
  }

  if (result.riskLevel === 'high') {
    return 'Monitor closely - proactively contact customer'
  }

  if (result.riskLevel === 'medium') {
    return 'Add to watchlist - check again tomorrow'
  }

  return 'No action needed - normal transit'
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Calculate probabilities for multiple shipments
 */
export async function calculateBatchProbabilities(
  shipmentIds: string[]
): Promise<Map<string, DeliveryProbabilityResult>> {
  const supabase = createAdminClient()
  const results = new Map<string, DeliveryProbabilityResult>()

  // Fetch all shipments in one query
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      shipment_id,
      carrier,
      carrier_service,
      zone_used,
      event_intransit,
      event_outfordelivery,
      event_delivered,
      event_deliveryattemptfailed,
      event_logs
    `)
    .in('shipment_id', shipmentIds)

  if (error || !shipments) {
    console.error('[Probability] Error fetching shipments:', error)
    return results
  }

  // For shipments missing event_intransit, fetch checkpoint fallback data
  const missingTransitIds = (shipments as ShipmentData[])
    .filter((s: ShipmentData) => !s.event_intransit)
    .map((s: ShipmentData) => s.shipment_id)

  const checkpointFallbacks = new Map<string, { checkpoint_date: string }>()

  if (missingTransitIds.length > 0) {
    // Fetch first transit checkpoint for each shipment missing event_intransit
    const { data: checkpoints } = await supabase
      .from('tracking_checkpoints')
      .select('shipment_id, checkpoint_date')
      .in('shipment_id', missingTransitIds)
      .not('raw_description', 'ilike', '%label%created%')
      .not('raw_description', 'ilike', '%pre-shipment%')
      .not('raw_description', 'ilike', '%readyforreceive%')
      .not('raw_description', 'ilike', '%pickupcancelled%')
      .not('raw_description', 'ilike', '%pickup cancelled%')
      .not('raw_description', 'ilike', '%pickup%cancel%')
      .order('checkpoint_date', { ascending: true })

    if (checkpoints) {
      // Get first checkpoint per shipment
      for (const cp of checkpoints) {
        if (!checkpointFallbacks.has(cp.shipment_id)) {
          checkpointFallbacks.set(cp.shipment_id, { checkpoint_date: cp.checkpoint_date })
        }
      }
    }
  }

  // Calculate for each
  for (const shipment of (shipments as ShipmentData[])) {
    const firstTransit = checkpointFallbacks.get(shipment.shipment_id) || null
    const result = await calculateProbabilityForShipment(
      shipment,
      null, // No latest checkpoint in batch mode (for now)
      firstTransit
    )
    if (result) {
      results.set(shipment.shipment_id, result)
    }
  }

  return results
}
