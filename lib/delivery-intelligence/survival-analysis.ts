/**
 * Survival Analysis Engine
 *
 * Implements Kaplan-Meier survival curve estimation for delivery probability.
 * Curves are computed per segment (carrier × service × zone × season) and
 * stored in the survival_curves table.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getConfidenceLevel } from './feature-extraction'

// =============================================================================
// Types
// =============================================================================

export interface SurvivalPoint {
  day: number
  survival_prob: number
  at_risk: number
  events: number
  cumulative_events: number
}

export interface SurvivalCurve {
  carrier: string
  carrier_service: string | null
  service_bucket: string
  zone_bucket: string
  season_bucket: string
  curve_data: SurvivalPoint[]
  sample_size: number
  delivered_count: number
  lost_count: number
  censored_count: number
  median_days: number | null
  p75_days: number | null
  p90_days: number | null
  p95_days: number | null
  confidence_level: 'high' | 'medium' | 'low' | 'insufficient'
}

interface OutcomeRecord {
  observed_days: number
  outcome: string
  is_censored: boolean
}

// =============================================================================
// Kaplan-Meier Computation
// =============================================================================

/**
 * Compute Kaplan-Meier survival curve from outcome records
 *
 * The Kaplan-Meier estimator handles censored data properly:
 * - At each time point, we calculate: S(t) = S(t-1) * (1 - d_i/n_i)
 *   where d_i = events (deliveries) at time i, n_i = at risk at time i
 * - Censored observations are removed from at-risk count but don't count as events
 *
 * For delivery analysis, we invert the traditional interpretation:
 * - "Event" = delivered (good outcome)
 * - "Survival" = still in transit (not yet delivered)
 * - So survival_prob represents P(still in transit at day X)
 * - And (1 - survival_prob) = P(delivered by day X)
 */
export function computeKaplanMeier(records: OutcomeRecord[]): SurvivalPoint[] {
  if (records.length === 0) return []

  // Sort by observed time
  const sorted = [...records].sort((a, b) => a.observed_days - b.observed_days)

  // Group by day (round to nearest day for practical binning)
  const dayGroups = new Map<number, { events: number; censored: number }>()

  for (const record of sorted) {
    const day = Math.floor(record.observed_days)
    const group = dayGroups.get(day) || { events: 0, censored: 0 }

    if (record.outcome === 'delivered') {
      group.events++
    } else if (record.is_censored) {
      group.censored++
    }
    // Lost outcomes are treated as events that didn't deliver
    // They stay "at risk" until they're confirmed lost

    dayGroups.set(day, group)
  }

  // Compute survival curve
  const curve: SurvivalPoint[] = []
  let atRisk = records.length
  let survivalProb = 1.0
  let cumulativeEvents = 0

  // Add day 0 point
  curve.push({
    day: 0,
    survival_prob: 1.0,
    at_risk: atRisk,
    events: 0,
    cumulative_events: 0,
  })

  // Process each day in order
  const days = Array.from(dayGroups.keys()).sort((a, b) => a - b)

  for (const day of days) {
    const group = dayGroups.get(day)!

    // Calculate survival probability at this time point
    // S(t) = S(t-1) * (1 - d/n) where d = deliveries, n = at risk
    if (atRisk > 0 && group.events > 0) {
      survivalProb = survivalProb * (1 - group.events / atRisk)
    }

    cumulativeEvents += group.events

    curve.push({
      day,
      survival_prob: Math.max(0, Math.min(1, survivalProb)),
      at_risk: atRisk,
      events: group.events,
      cumulative_events: cumulativeEvents,
    })

    // Remove delivered and censored from at-risk for next time point
    atRisk -= group.events + group.censored
  }

  return curve
}

/**
 * Calculate percentile days from survival curve
 * Returns the day at which survival probability drops below (1 - percentile)
 *
 * For delivery: P95 means 95% of packages delivered by this day
 */
export function getPercentileDay(curve: SurvivalPoint[], percentile: number): number | null {
  if (curve.length === 0) return null

  // We want the day where (1 - survival_prob) >= percentile
  // i.e., survival_prob <= (1 - percentile)
  const targetSurvival = 1 - percentile

  for (const point of curve) {
    if (point.survival_prob <= targetSurvival) {
      return point.day
    }
  }

  return null // Never reached this percentile
}

// =============================================================================
// Curve Computation for Segments
// =============================================================================

interface SegmentKey {
  carrier: string
  carrier_service: string | null
  service_bucket: string
  zone_bucket: string
  season_bucket: string
}

/**
 * Compute survival curves for all segments
 */
export async function computeAllSurvivalCurves(): Promise<{
  computed: number
  errors: number
}> {
  const supabase = createAdminClient()

  // Get all unique segments using cursor-based pagination
  // CRITICAL: Supabase returns max 1000 rows, must paginate
  const uniqueSegments = new Map<string, SegmentKey>()
  const pageSize = 1000
  let lastId: string | null = null

  console.log('[Survival] Fetching all segments with pagination...')

  while (true) {
    let query = supabase
      .from('delivery_outcomes')
      .select('id, carrier, carrier_service, service_bucket, zone_bucket, season_bucket')
      .not('carrier', 'is', null)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data: segments, error: segmentError } = await query

    if (segmentError) {
      console.error('[Survival] Error fetching segments:', segmentError)
      return { computed: 0, errors: 1 }
    }

    if (!segments || segments.length === 0) break

    // Deduplicate segments
    for (const seg of segments) {
      const key = `${seg.carrier}|${seg.carrier_service || ''}|${seg.service_bucket}|${seg.zone_bucket}|${seg.season_bucket}`
      if (!uniqueSegments.has(key)) {
        uniqueSegments.set(key, {
          carrier: seg.carrier,
          carrier_service: seg.carrier_service,
          service_bucket: seg.service_bucket,
          zone_bucket: seg.zone_bucket,
          season_bucket: seg.season_bucket,
        })
      }
    }

    lastId = segments[segments.length - 1].id

    // If we got less than pageSize, we're done
    if (segments.length < pageSize) break
  }

  console.log(`[Survival] Found ${uniqueSegments.size} unique segments from all pages`)

  let computed = 0
  let errors = 0

  // Compute curve for each segment
  for (const segment of uniqueSegments.values()) {
    try {
      const curve = await computeCurveForSegment(segment)
      if (curve) {
        await upsertSurvivalCurve(curve)
        computed++
      }
    } catch (err) {
      console.error(`[Survival] Error computing curve for ${JSON.stringify(segment)}:`, err)
      errors++
    }
  }

  // Also compute aggregated curves for fallback hierarchy

  // 1. carrier + service_bucket + zone + season (ignore exact carrier_service)
  const aggSegments1 = await computeAggregatedCurves('carrier_service_bucket')
  computed += aggSegments1.computed
  errors += aggSegments1.errors

  // 2. service_bucket + zone + season (all carriers)
  const aggSegments2 = await computeAggregatedCurves('service_bucket_zone_season')
  computed += aggSegments2.computed
  errors += aggSegments2.errors

  // 3. zone + season only
  const aggSegments3 = await computeAggregatedCurves('zone_season')
  computed += aggSegments3.computed
  errors += aggSegments3.errors

  console.log(`[Survival] Completed: ${computed} curves computed, ${errors} errors`)
  return { computed, errors }
}

/**
 * Helper to fetch all unique segments with pagination
 */
async function fetchUniqueSegments<T extends Record<string, unknown>>(
  fields: string[],
  keyFn: (seg: T) => string
): Promise<Map<string, T>> {
  const supabase = createAdminClient()
  const uniqueKeys = new Map<string, T>()
  const pageSize = 1000
  let lastId: string | null = null

  while (true) {
    let query = supabase
      .from('delivery_outcomes')
      .select(`id, ${fields.join(', ')}`)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data: segments, error } = await query

    if (error || !segments || segments.length === 0) break

    for (const seg of segments) {
      const key = keyFn(seg as T)
      if (!uniqueKeys.has(key)) {
        uniqueKeys.set(key, seg as T)
      }
    }

    lastId = segments[segments.length - 1].id
    if (segments.length < pageSize) break
  }

  return uniqueKeys
}

/**
 * Compute aggregated curves for fallback hierarchy
 */
async function computeAggregatedCurves(
  level: 'carrier_service_bucket' | 'service_bucket_zone_season' | 'zone_season'
): Promise<{ computed: number; errors: number }> {
  let computed = 0
  let errors = 0

  if (level === 'carrier_service_bucket') {
    // Aggregate by carrier + service_bucket + zone + season (ignore exact carrier_service)
    const uniqueKeys = await fetchUniqueSegments<{ carrier: string; service_bucket: string; zone_bucket: string; season_bucket: string }>(
      ['carrier', 'service_bucket', 'zone_bucket', 'season_bucket'],
      (seg) => `${seg.carrier}|${seg.service_bucket}|${seg.zone_bucket}|${seg.season_bucket}`
    )

    console.log(`[Survival] Found ${uniqueKeys.size} unique carrier_service_bucket segments`)

    for (const seg of uniqueKeys.values()) {
      try {
        const curve = await computeCurveForSegment({
          carrier: seg.carrier,
          carrier_service: null, // Aggregate all services in this bucket
          service_bucket: seg.service_bucket,
          zone_bucket: seg.zone_bucket,
          season_bucket: seg.season_bucket,
        })
        if (curve) {
          await upsertSurvivalCurve(curve)
          computed++
        }
      } catch (err) {
        errors++
      }
    }
  } else if (level === 'service_bucket_zone_season') {
    // Aggregate all carriers within service_bucket + zone + season
    const uniqueKeys = await fetchUniqueSegments<{ service_bucket: string; zone_bucket: string; season_bucket: string }>(
      ['service_bucket', 'zone_bucket', 'season_bucket'],
      (seg) => `${seg.service_bucket}|${seg.zone_bucket}|${seg.season_bucket}`
    )

    console.log(`[Survival] Found ${uniqueKeys.size} unique service_bucket_zone_season segments`)

    for (const seg of uniqueKeys.values()) {
      try {
        const curve = await computeCurveForSegment({
          carrier: 'all',
          carrier_service: null,
          service_bucket: seg.service_bucket,
          zone_bucket: seg.zone_bucket,
          season_bucket: seg.season_bucket,
        })
        if (curve) {
          await upsertSurvivalCurve(curve)
          computed++
        }
      } catch (err) {
        errors++
      }
    }
  } else if (level === 'zone_season') {
    // Aggregate all carriers and services within zone + season
    const uniqueKeys = await fetchUniqueSegments<{ zone_bucket: string; season_bucket: string }>(
      ['zone_bucket', 'season_bucket'],
      (seg) => `${seg.zone_bucket}|${seg.season_bucket}`
    )

    console.log(`[Survival] Found ${uniqueKeys.size} unique zone_season segments`)

    for (const seg of uniqueKeys.values()) {
      try {
        const curve = await computeCurveForSegment({
          carrier: 'all',
          carrier_service: null,
          service_bucket: 'all',
          zone_bucket: seg.zone_bucket,
          season_bucket: seg.season_bucket,
        })
        if (curve) {
          await upsertSurvivalCurve(curve)
          computed++
        }
      } catch (err) {
        errors++
      }
    }
  }

  return { computed, errors }
}

/**
 * Compute survival curve for a specific segment
 */
async function computeCurveForSegment(segment: SegmentKey): Promise<SurvivalCurve | null> {
  const supabase = createAdminClient()

  // Fetch all records for this segment with pagination
  // CRITICAL: Supabase returns max 1000 rows
  const records: OutcomeRecord[] = []
  const pageSize = 1000
  let lastId: string | null = null

  while (true) {
    let query = supabase
      .from('delivery_outcomes')
      .select('id, observed_days, outcome, is_censored')
      .order('id', { ascending: true })
      .limit(pageSize)

    if (segment.carrier !== 'all') {
      query = query.eq('carrier', segment.carrier)
    }

    if (segment.carrier_service !== null) {
      query = query.eq('carrier_service', segment.carrier_service)
    }

    if (segment.service_bucket !== 'all') {
      query = query.eq('service_bucket', segment.service_bucket)
    }

    query = query
      .eq('zone_bucket', segment.zone_bucket)
      .eq('season_bucket', segment.season_bucket)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data, error } = await query

    if (error) {
      console.error('[Survival] Query error:', error)
      return null
    }

    if (!data || data.length === 0) break

    for (const row of data) {
      records.push({
        observed_days: row.observed_days,
        outcome: row.outcome,
        is_censored: row.is_censored,
      })
    }

    lastId = data[data.length - 1].id
    if (data.length < pageSize) break
  }

  if (records.length === 0) {
    return null
  }

  // Compute Kaplan-Meier curve
  const curveData = computeKaplanMeier(records)

  // Calculate statistics
  const deliveredCount = records.filter(r => r.outcome === 'delivered').length
  const lostCount = records.filter(r => r.outcome.startsWith('lost')).length
  const censoredCount = records.filter(r => r.is_censored).length

  // Calculate percentiles
  const medianDays = getPercentileDay(curveData, 0.5)
  const p75Days = getPercentileDay(curveData, 0.75)
  const p90Days = getPercentileDay(curveData, 0.90)
  const p95Days = getPercentileDay(curveData, 0.95)

  return {
    carrier: segment.carrier,
    carrier_service: segment.carrier_service,
    service_bucket: segment.service_bucket,
    zone_bucket: segment.zone_bucket,
    season_bucket: segment.season_bucket,
    curve_data: curveData,
    sample_size: records.length,
    delivered_count: deliveredCount,
    lost_count: lostCount,
    censored_count: censoredCount,
    median_days: medianDays,
    p75_days: p75Days,
    p90_days: p90Days,
    p95_days: p95Days,
    confidence_level: getConfidenceLevel(records.length),
  }
}

/**
 * Upsert survival curve to database
 *
 * NOTE: Standard UNIQUE constraint doesn't handle NULLs properly (NULL != NULL),
 * so we use delete-then-insert pattern to avoid duplicates.
 */
async function upsertSurvivalCurve(curve: SurvivalCurve): Promise<void> {
  const supabase = createAdminClient()

  // Delete existing row with matching keys (handles NULL carrier_service properly)
  let deleteQuery = supabase
    .from('survival_curves')
    .delete()
    .eq('carrier', curve.carrier)
    .eq('service_bucket', curve.service_bucket)
    .eq('zone_bucket', curve.zone_bucket)
    .eq('season_bucket', curve.season_bucket)

  // Handle NULL carrier_service
  if (curve.carrier_service === null) {
    deleteQuery = deleteQuery.is('carrier_service', null)
  } else {
    deleteQuery = deleteQuery.eq('carrier_service', curve.carrier_service)
  }

  await deleteQuery

  // Insert new row
  const { error } = await supabase
    .from('survival_curves')
    .insert({
      carrier: curve.carrier,
      carrier_service: curve.carrier_service,
      service_bucket: curve.service_bucket,
      zone_bucket: curve.zone_bucket,
      season_bucket: curve.season_bucket,
      curve_data: curve.curve_data,
      sample_size: curve.sample_size,
      delivered_count: curve.delivered_count,
      lost_count: curve.lost_count,
      censored_count: curve.censored_count,
      median_days: curve.median_days,
      p75_days: curve.p75_days,
      p90_days: curve.p90_days,
      p95_days: curve.p95_days,
      confidence_level: curve.confidence_level,
      computed_at: new Date().toISOString(),
    })

  if (error) {
    throw error
  }
}

// =============================================================================
// Curve Lookup with Fallback
// =============================================================================

/**
 * Get survival curve for a shipment with fallback hierarchy
 *
 * Fallback order (service-preserving - never mix Express with Ground):
 * 1. carrier + exact carrier_service + zone + season (most specific)
 * 2. carrier + carrier_service + zone (ignore season)
 * 3. carrier + service_bucket + zone (broaden service within same tier)
 * 4. all carriers + service_bucket + zone (all carriers in same tier)
 * 5. all + service_bucket + zone (last resort, same service tier)
 */
export async function getSurvivalCurveWithFallback(
  carrier: string,
  carrierService: string | null,
  serviceBucket: string,
  zoneBucket: string,
  seasonBucket: string,
  minSampleSize: number = 100 // Default to 100 = medium confidence minimum (low/insufficient not usable)
): Promise<SurvivalCurve | null> {
  const supabase = createAdminClient()

  // 1. Most specific: carrier + exact service + zone + season
  let { data: curve } = await supabase
    .from('survival_curves')
    .select('*')
    .eq('carrier', carrier)
    .eq('carrier_service', carrierService)
    .eq('zone_bucket', zoneBucket)
    .eq('season_bucket', seasonBucket)
    .gte('sample_size', minSampleSize)
    .single()

  if (curve) return curve as SurvivalCurve

  // 2. Ignore season: carrier + exact service + zone
  ({ data: curve } = await supabase
    .from('survival_curves')
    .select('*')
    .eq('carrier', carrier)
    .eq('carrier_service', carrierService)
    .eq('zone_bucket', zoneBucket)
    .gte('sample_size', minSampleSize)
    .limit(1)
    .single())

  if (curve) return curve as SurvivalCurve

  // 3. Broaden to service bucket: carrier + service_bucket + zone
  ({ data: curve } = await supabase
    .from('survival_curves')
    .select('*')
    .eq('carrier', carrier)
    .is('carrier_service', null)
    .eq('service_bucket', serviceBucket)
    .eq('zone_bucket', zoneBucket)
    .gte('sample_size', minSampleSize)
    .limit(1)
    .single())

  if (curve) return curve as SurvivalCurve

  // 4. All carriers in same service tier
  ({ data: curve } = await supabase
    .from('survival_curves')
    .select('*')
    .eq('carrier', 'all')
    .eq('service_bucket', serviceBucket)
    .eq('zone_bucket', zoneBucket)
    .gte('sample_size', minSampleSize)
    .limit(1)
    .single())

  if (curve) return curve as SurvivalCurve

  // 5. Last resort: zone only (within same service tier)
  ({ data: curve } = await supabase
    .from('survival_curves')
    .select('*')
    .eq('carrier', 'all')
    .eq('service_bucket', 'all')
    .eq('zone_bucket', zoneBucket)
    .gte('sample_size', minSampleSize)
    .limit(1)
    .single())

  return curve as SurvivalCurve | null
}

/**
 * Interpolate survival probability for a specific day
 */
export function interpolateSurvivalProbability(
  curveData: SurvivalPoint[],
  day: number
): number {
  if (curveData.length === 0) return 1.0
  if (day <= 0) return 1.0

  // Find surrounding points
  let lower: SurvivalPoint | null = null
  let upper: SurvivalPoint | null = null

  for (const point of curveData) {
    if (point.day <= day) {
      lower = point
    }
    if (point.day >= day && upper === null) {
      upper = point
    }
  }

  // If we're past the end of the curve, return the last value
  if (!upper) {
    return lower?.survival_prob ?? 0
  }

  // If we're at or before the first point, return 1.0
  if (!lower) {
    return 1.0
  }

  // If exact match, return that probability
  if (lower.day === day) {
    return lower.survival_prob
  }

  // Linear interpolation between points
  const range = upper.day - lower.day
  if (range === 0) return lower.survival_prob

  const fraction = (day - lower.day) / range
  return lower.survival_prob + fraction * (upper.survival_prob - lower.survival_prob)
}

/**
 * Calculate delivery probability at day X
 * This is (1 - survival_prob), since survival = still in transit
 */
export function getDeliveryProbabilityAtDay(
  curveData: SurvivalPoint[],
  day: number
): number {
  const survivalProb = interpolateSurvivalProbability(curveData, day)
  return 1 - survivalProb
}
