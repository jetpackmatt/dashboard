/**
 * Feature Extraction for Delivery Intelligence Engine
 *
 * Extracts features from shipments for survival analysis training data.
 * Used to populate the delivery_outcomes table.
 */

import { createAdminClient } from '@/lib/supabase/admin'

// =============================================================================
// Types
// =============================================================================

export interface ShipmentFeatures {
  shipment_id: string
  tracking_number: string | null
  carrier: string
  carrier_service: string | null
  client_id: string | null

  // Outcome
  outcome: 'delivered' | 'lost_claim' | 'lost_tracking' | 'lost_exception' | 'lost_timeout' | 'censored'
  outcome_date: string | null
  outcome_source: string | null

  // Zone features
  zone_used: number | null
  zone_bucket: string

  // Destination
  destination_state: string | null
  destination_country: string | null
  destination_region: string | null

  // Seasonality
  transit_start_date: string
  transit_start_month: number
  transit_start_week: number
  season_bucket: string

  // Service tier
  service_bucket: string

  // Time-in-state (Tier 1)
  total_transit_days: number | null
  days_to_out_for_delivery: number | null
  days_last_mile: number | null

  // Observation time
  observed_days: number
  is_censored: boolean

  // Risk factors
  has_exception: boolean
  has_delivery_attempt_failed: boolean
  event_count: number

  // Tier 2 availability
  has_checkpoint_data: boolean
  checkpoint_count: number
}

export interface RawShipment {
  shipment_id: string
  tracking_id: string | null
  carrier: string
  carrier_service: string | null
  client_id: string | null
  zone_used: number | null
  destination_state: string | null
  destination_country: string | null
  event_intransit: string | null
  event_outfordelivery: string | null
  event_delivered: string | null
  event_deliveryattemptfailed: string | null
  event_logs: unknown[] | null
}

// =============================================================================
// Zone Bucket Functions
// =============================================================================

/**
 * Convert zone number to zone bucket
 *
 * Uses individual zones 1-10 for domestic shipments (each has 700+ samples,
 * sufficient for high confidence curves). International zones (11+) are
 * bucketed together due to fragmented/sparse data.
 *
 * Zone sample sizes (verified Feb 2026):
 *   Zone 1:  1,752 | Zone 6:  8,326
 *   Zone 2:  5,437 | Zone 7: 10,464
 *   Zone 3:  5,895 | Zone 8:  4,391
 *   Zone 4: 12,116 | Zone 9:    715
 *   Zone 5: 28,147 | Zone 10: 1,218
 */
export function getZoneBucket(zone: number | null): string {
  if (zone === null || zone === undefined) return 'zone_5' // Default to most common zone

  // Individual zones for domestic (1-10) - each has distinct transit profile
  if (zone >= 1 && zone <= 10) return `zone_${zone}`

  // International zones (11+) bucketed together due to sparse data
  return 'international'
}

/**
 * Get adjacent zone buckets for fallback hierarchy
 * Used when a specific zone has insufficient data
 */
export function getAdjacentZoneBuckets(zoneBucket: string): string[] {
  // Parse zone number from bucket name
  const match = zoneBucket.match(/^zone_(\d+)$/)
  if (!match) return [] // International or invalid

  const zone = parseInt(match[1], 10)

  // Return adjacent zones for fallback (closer zones have more similar transit times)
  const adjacent: string[] = []
  if (zone > 1) adjacent.push(`zone_${zone - 1}`)
  if (zone < 10) adjacent.push(`zone_${zone + 1}`)

  return adjacent
}

// =============================================================================
// Service Bucket Functions
// =============================================================================

/**
 * Convert carrier_service to service bucket
 * Ground and Economy are combined (equivalent national ground services)
 */
export function getServiceBucket(carrierService: string | null): string {
  const service = (carrierService || '').toLowerCase()

  // Express/Overnight (1-day)
  if (service.includes('overnight') || service.includes('priority overnight') || service.includes('next day')) {
    return 'express'
  }

  // 2-Day
  if (service.includes('2day') || service.includes('2 day')) {
    return '2day'
  }

  // Premium (carrier-specific premium tiers)
  if (service.includes('premium')) {
    return 'premium'
  }

  // Ground/Economy/Standard - COMBINED (equivalent national ground services)
  if (service.includes('ground') || service.includes('parcel') || service.includes('standard') ||
      service.includes('economy') || service.includes('advantage')) {
    return 'ground'
  }

  return 'ground' // Default to ground, not "other"
}

// =============================================================================
// Season Bucket Functions
// =============================================================================

/**
 * Convert date to season bucket
 * Peak: November - January (holiday + Q4)
 * Normal: February - October
 */
export function getSeasonBucket(date: Date): string {
  const month = date.getMonth() + 1 // 1-12

  if (month >= 11 || month <= 1) {
    return 'peak'
  }
  return 'normal'
}

/**
 * Get ISO week number from date
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// =============================================================================
// Region Functions
// =============================================================================

/**
 * Convert state code to region
 */
export function getRegion(state: string | null, country: string | null): string | null {
  if (country && country !== 'US') {
    return 'international'
  }

  if (!state) return null

  const stateUpper = state.toUpperCase()

  // West Coast
  if (['CA', 'OR', 'WA', 'NV', 'AZ'].includes(stateUpper)) return 'west_coast'

  // Mountain
  if (['CO', 'UT', 'NM', 'MT', 'ID', 'WY'].includes(stateUpper)) return 'mountain'

  // Midwest
  if (['IL', 'OH', 'MI', 'IN', 'WI', 'MN', 'IA', 'MO', 'ND', 'SD', 'NE', 'KS'].includes(stateUpper)) return 'midwest'

  // South
  if (['TX', 'FL', 'GA', 'NC', 'VA', 'TN', 'AL', 'SC', 'LA', 'KY', 'OK', 'AR', 'MS', 'WV'].includes(stateUpper)) return 'south'

  // Northeast
  if (['NY', 'PA', 'NJ', 'MA', 'CT', 'MD', 'DC', 'DE', 'NH', 'VT', 'ME', 'RI'].includes(stateUpper)) return 'northeast'

  // Remote
  if (['AK', 'HI'].includes(stateUpper)) return 'remote'

  return null
}

// =============================================================================
// Outcome Determination
// =============================================================================

// Thresholds for outcome determination
const DOMESTIC_TOO_FRESH_DAYS = 15
const INTERNATIONAL_TOO_FRESH_DAYS = 20
const LOST_TIMEOUT_DAYS = 45

/**
 * Determine shipment outcome based on delivery status and claims
 */
export async function determineOutcome(
  shipment: RawShipment,
  claimStatus: { status: string; issue_type: string } | null
): Promise<{ outcome: ShipmentFeatures['outcome']; outcome_date: string | null; outcome_source: string | null }> {
  // DELIVERED: Clear outcome
  if (shipment.event_delivered) {
    return {
      outcome: 'delivered',
      outcome_date: shipment.event_delivered,
      outcome_source: 'event_delivered',
    }
  }

  // LOST: Confirmed by approved claim
  if (claimStatus && claimStatus.issue_type === 'Loss' &&
      ['Credit Approved', 'Resolved'].includes(claimStatus.status)) {
    return {
      outcome: 'lost_claim',
      outcome_date: null, // Claim approval date not tracked here
      outcome_source: 'claim',
    }
  }

  // Check if exception in event_logs
  const hasException = checkEventLogsForException(shipment.event_logs)

  // Calculate days since last activity
  const isInternational = shipment.zone_used !== null && shipment.zone_used > 10
  const tooFreshDays = isInternational ? INTERNATIONAL_TOO_FRESH_DAYS : DOMESTIC_TOO_FRESH_DAYS

  const transitStart = shipment.event_intransit ? new Date(shipment.event_intransit) : null
  if (!transitStart) {
    // No transit start = can't determine status
    return { outcome: 'censored', outcome_date: null, outcome_source: null }
  }

  // Calculate days since last scan (using latest event as proxy)
  const lastActivity = getLatestEventDate(shipment)
  const daysSinceLastActivity = lastActivity
    ? Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
    : Math.floor((Date.now() - transitStart.getTime()) / (1000 * 60 * 60 * 24))

  const totalTransitDays = Math.floor((Date.now() - transitStart.getTime()) / (1000 * 60 * 60 * 24))

  // Too fresh - exclude from training (treat as censored for now)
  if (daysSinceLastActivity < tooFreshDays) {
    return { outcome: 'censored', outcome_date: null, outcome_source: null }
  }

  // Past timeout + has exception = lost_exception
  if (totalTransitDays > LOST_TIMEOUT_DAYS && hasException) {
    return { outcome: 'lost_exception', outcome_date: null, outcome_source: 'event_logs' }
  }

  // Past timeout = lost_timeout
  if (totalTransitDays > LOST_TIMEOUT_DAYS) {
    return { outcome: 'lost_timeout', outcome_date: null, outcome_source: 'timeout' }
  }

  // Within window but past threshold = censored (still could deliver)
  return { outcome: 'censored', outcome_date: null, outcome_source: null }
}

/**
 * Get the latest event date from a shipment
 */
function getLatestEventDate(shipment: RawShipment): Date | null {
  const dates = [
    shipment.event_outfordelivery,
    shipment.event_deliveryattemptfailed,
    shipment.event_intransit,
  ]
    .filter(Boolean)
    .map((d) => new Date(d as string))

  if (dates.length === 0) return null

  return dates.reduce((latest, current) => (current > latest ? current : latest))
}

/**
 * Check if event_logs contains exception events
 */
export function checkEventLogsForException(eventLogs: unknown[] | null): boolean {
  if (!eventLogs || !Array.isArray(eventLogs)) return false

  const logsStr = JSON.stringify(eventLogs).toLowerCase()
  return logsStr.includes('exception') ||
         logsStr.includes('unable to locate') ||
         logsStr.includes('delivery attempt failed') ||
         logsStr.includes('address issue')
}

// =============================================================================
// Main Feature Extraction
// =============================================================================

/**
 * Extract features from a single shipment
 */
export async function extractFeatures(
  shipment: RawShipment,
  claimStatus: { status: string; issue_type: string } | null = null,
  checkpointCount: number = 0
): Promise<ShipmentFeatures | null> {
  // Must have transit start
  if (!shipment.event_intransit) {
    return null
  }

  const transitStart = new Date(shipment.event_intransit)

  // Determine outcome
  const { outcome, outcome_date, outcome_source } = await determineOutcome(shipment, claimStatus)

  // Calculate time-in-state metrics
  const delivered = shipment.event_delivered ? new Date(shipment.event_delivered) : null
  const outForDelivery = shipment.event_outfordelivery ? new Date(shipment.event_outfordelivery) : null
  const now = new Date()

  const totalTransitDays = delivered
    ? (delivered.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)
    : (now.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)

  const daysToOfd = outForDelivery
    ? (outForDelivery.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)
    : null

  const daysLastMile = delivered && outForDelivery
    ? (delivered.getTime() - outForDelivery.getTime()) / (1000 * 60 * 60 * 24)
    : null

  // Observed time for Kaplan-Meier
  const observedDays = outcome === 'delivered' && delivered
    ? (delivered.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)
    : (now.getTime() - transitStart.getTime()) / (1000 * 60 * 60 * 24)

  // Event count
  const eventCount = Array.isArray(shipment.event_logs) ? shipment.event_logs.length : 0

  return {
    shipment_id: shipment.shipment_id,
    tracking_number: shipment.tracking_id,
    carrier: shipment.carrier,
    carrier_service: shipment.carrier_service,
    client_id: shipment.client_id,

    outcome,
    outcome_date,
    outcome_source,

    zone_used: shipment.zone_used,
    zone_bucket: getZoneBucket(shipment.zone_used),

    destination_state: shipment.destination_state,
    destination_country: shipment.destination_country,
    destination_region: getRegion(shipment.destination_state, shipment.destination_country),

    transit_start_date: transitStart.toISOString().split('T')[0],
    transit_start_month: transitStart.getMonth() + 1,
    transit_start_week: getWeekNumber(transitStart),
    season_bucket: getSeasonBucket(transitStart),

    service_bucket: getServiceBucket(shipment.carrier_service),

    total_transit_days: Math.round(totalTransitDays * 100) / 100,
    days_to_out_for_delivery: daysToOfd !== null ? Math.round(daysToOfd * 100) / 100 : null,
    days_last_mile: daysLastMile !== null ? Math.round(daysLastMile * 100) / 100 : null,

    observed_days: Math.round(observedDays * 100) / 100,
    is_censored: outcome === 'censored',

    has_exception: checkEventLogsForException(shipment.event_logs),
    has_delivery_attempt_failed: !!shipment.event_deliveryattemptfailed,
    event_count: eventCount,

    has_checkpoint_data: checkpointCount > 0,
    checkpoint_count: checkpointCount,
  }
}

// =============================================================================
// Batch Processing
// =============================================================================

/**
 * Process a batch of shipments and upsert to delivery_outcomes
 */
export async function processShipmentBatch(
  shipments: RawShipment[],
  claimMap: Map<string, { status: string; issue_type: string }>,
  checkpointCountMap: Map<string, number>
): Promise<{ processed: number; errors: number }> {
  const supabase = createAdminClient()
  let processed = 0
  let errors = 0

  const records: ShipmentFeatures[] = []

  for (const shipment of shipments) {
    try {
      const claimStatus = claimMap.get(shipment.shipment_id) || null
      const checkpointCount = checkpointCountMap.get(shipment.shipment_id) || 0

      const features = await extractFeatures(shipment, claimStatus, checkpointCount)
      if (features) {
        records.push(features)
      }
    } catch (err) {
      console.error(`[FeatureExtraction] Error processing ${shipment.shipment_id}:`, err)
      errors++
    }
  }

  if (records.length > 0) {
    const { error } = await supabase
      .from('delivery_outcomes')
      .upsert(records, {
        onConflict: 'shipment_id',
        ignoreDuplicates: false,
      })

    if (error) {
      console.error('[FeatureExtraction] Upsert error:', error)
      errors += records.length
    } else {
      processed = records.length
    }
  }

  return { processed, errors }
}

/**
 * Get confidence level based on sample size
 */
export function getConfidenceLevel(sampleSize: number): 'high' | 'medium' | 'low' | 'insufficient' {
  if (sampleSize >= 500) return 'high'
  if (sampleSize >= 100) return 'medium'
  if (sampleSize >= 50) return 'low'
  return 'insufficient'
}

/**
 * Sync new shipments to delivery_outcomes incrementally
 * Called by the compute-survival-curves cron before recomputing curves
 */
export async function syncNewDeliveryOutcomes(): Promise<{ added: number; errors: number }> {
  const supabase = createAdminClient()
  console.log('[FeatureExtraction] Starting incremental sync...')

  // 1. Load claims map for outcome determination
  const claimMap = new Map<string, { status: string; issue_type: string }>()
  let claimOffset = 0
  const claimPageSize = 1000

  while (true) {
    const { data: claims, error } = await supabase
      .from('care_tickets')
      .select('shipment_id, status, issue_type')
      .not('shipment_id', 'is', null)
      .range(claimOffset, claimOffset + claimPageSize - 1)

    if (error || !claims || claims.length === 0) break

    for (const claim of claims) {
      if (claim.shipment_id) {
        const existing = claimMap.get(claim.shipment_id)
        if (!existing || claim.issue_type === 'Loss') {
          claimMap.set(claim.shipment_id, {
            status: claim.status,
            issue_type: claim.issue_type,
          })
        }
      }
    }

    claimOffset += claims.length
    if (claims.length < claimPageSize) break
  }

  console.log(`[FeatureExtraction] Loaded ${claimMap.size} claims`)

  // 2. Find shipments NOT in delivery_outcomes (with event_intransit)
  // Use cursor-based pagination to handle large datasets
  let totalAdded = 0
  let totalErrors = 0
  let lastShipmentId: string | null = null
  const batchSize = 500

  while (true) {
    // Query shipments with event_intransit that aren't in delivery_outcomes
    let query = supabase
      .from('shipments')
      .select(`
        shipment_id,
        shipbob_order_id,
        tracking_id,
        carrier,
        carrier_service,
        client_id,
        zone_used,
        destination_country,
        event_intransit,
        event_outfordelivery,
        event_delivered,
        event_deliveryattemptfailed,
        event_logs
      `)
      .not('event_intransit', 'is', null)
      .order('shipment_id', { ascending: true })
      .limit(batchSize)

    if (lastShipmentId) {
      query = query.gt('shipment_id', lastShipmentId)
    }

    const { data: shipments, error: shipmentError } = await query

    if (shipmentError) {
      console.error('[FeatureExtraction] Error fetching shipments:', shipmentError)
      break
    }

    if (!shipments || shipments.length === 0) break

    // Filter to only shipments not in delivery_outcomes
    const typedShipments = shipments as RawShipment[]
    const shipmentIds = typedShipments.map(s => s.shipment_id)
    const { data: existing } = await supabase
      .from('delivery_outcomes')
      .select('shipment_id')
      .in('shipment_id', shipmentIds)

    const existingIds = new Set((existing || []).map((e: { shipment_id: string }) => e.shipment_id))
    const newShipments = typedShipments.filter(s => !existingIds.has(s.shipment_id))

    if (newShipments.length > 0) {
      // Process the new shipments
      const checkpointCountMap = new Map<string, number>() // Could be enhanced later
      const result = await processShipmentBatch(
        newShipments,
        claimMap,
        checkpointCountMap
      )
      totalAdded += result.processed
      totalErrors += result.errors
    }

    lastShipmentId = shipments[shipments.length - 1].shipment_id

    // If we got fewer than batchSize, we've reached the end
    if (shipments.length < batchSize) break
  }

  console.log(`[FeatureExtraction] Incremental sync complete: ${totalAdded} added, ${totalErrors} errors`)
  return { added: totalAdded, errors: totalErrors }
}
