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

  // Fetch shipment data
  const { data: shipment, error } = await supabase
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
    .single()

  if (error || !shipment) {
    console.error('[Probability] Error fetching shipment:', error)
    return null
  }

  return calculateProbabilityForShipment(shipment as ShipmentData)
}

/**
 * Calculate probability from shipment data (internal)
 */
export async function calculateProbabilityForShipment(
  shipment: ShipmentData
): Promise<DeliveryProbabilityResult | null> {
  // Must have transit start
  if (!shipment.event_intransit) {
    return null
  }

  // If already delivered, probability is 1
  if (shipment.event_delivered) {
    const transitStart = new Date(shipment.event_intransit)
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

  // Calculate days in transit
  const transitStart = new Date(shipment.event_intransit)
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

  // Ensure probability stays in valid range
  eventualDeliveryProb = Math.max(0.05, Math.min(0.999, eventualDeliveryProb))

  // Calculate risk level (risk factors already collected above)
  const riskLevel = getRiskLevel(daysInTransit, riskFactors, curve)

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
  curve?: SurvivalCurve
): 'low' | 'medium' | 'high' | 'critical' {
  const hasException = riskFactors.includes('exception_detected')
  const hasFailedAttempt = riskFactors.includes('delivery_attempt_failed')
  const pastP90 = riskFactors.includes('past_p90_delivery_time')
  const pastP95 = riskFactors.includes('past_p95_delivery_time')

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

  // Calculate for each
  for (const shipment of shipments) {
    const result = await calculateProbabilityForShipment(shipment as ShipmentData)
    if (result) {
      results.set(shipment.shipment_id, result)
    }
  }

  return results
}
