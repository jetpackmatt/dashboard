/**
 * Shared Lost in Transit verification logic.
 *
 * Extracted from app/api/data/shipments/[id]/verify-lost-in-transit/route.ts
 * so that both the manual claim flow and auto-file use the same code path.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  getTracking,
  isDelivered,
  daysSinceLastCheckpoint,
  getLastCheckpointDate,
} from '@/lib/trackingmore/client'
import { storeCheckpoints } from '@/lib/trackingmore/checkpoint-storage'

// Eligibility thresholds
const LOST_IN_TRANSIT_DOMESTIC_DAYS = 15
const LOST_IN_TRANSIT_INTERNATIONAL_DAYS = 20

// Patterns that indicate the carrier has admitted the package is lost
// Must stay in sync with recheck-at-risk LOST_STATUS_PATTERNS
const LOST_STATUS_PATTERNS = [
  /^lost,/i,                           // "Lost,HARRISBURG,PA,US,..."
  /unable to locate/i,                 // "Unable to Locate We're sorry..."
  /cannot be located/i,                // "Package cannot be located"
  /missing mail search/i,              // "Missing Mail Search Request Initiated..."
  /package is lost/i,                  // Explicit lost statement
  /declared lost/i,                    // "Package declared lost"
  /presumed lost/i,                    // "Package presumed lost"
]

function isLostStatus(description: string | null): boolean {
  if (!description) return false
  return LOST_STATUS_PATTERNS.some(pattern => pattern.test(description))
}

export interface VerifyLostInTransitResult {
  eligible: boolean
  reason?: string
  lastScanDate?: string
  lastScanDescription?: string
  lastScanLocation?: string
  daysRemaining?: number
  canProceed?: boolean
  isInternational: boolean
  requiredDays: number
  daysSinceLastScan: number | null
  error?: string
  fromCache: boolean
  previousCheckDate?: string
}

/**
 * Verify whether a shipment qualifies for a Lost in Transit claim.
 *
 * 1. Fetches shipment from DB
 * 2. Checks if already delivered
 * 3. Checks lost_in_transit_checks cache
 * 4. Calls TrackingMore if needed
 * 5. Upserts verification record
 */
export async function verifyLostInTransit(
  shipmentId: string,
  supabase: SupabaseClient
): Promise<VerifyLostInTransitResult> {
  // Fetch shipment data
  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .select(`
      shipment_id,
      tracking_id,
      carrier,
      client_id,
      origin_country,
      destination_country,
      event_delivered,
      event_labeled
    `)
    .eq('shipment_id', shipmentId)
    .single()

  if (shipmentError) {
    if (shipmentError.code === 'PGRST116') {
      return {
        eligible: false,
        reason: 'Shipment not found.',
        error: 'not_found',
        isInternational: false,
        requiredDays: LOST_IN_TRANSIT_DOMESTIC_DAYS,
        daysSinceLastScan: null,
        fromCache: false,
      }
    }
    throw new Error(`Error fetching shipment: ${shipmentError.message}`)
  }

  // Check if package is already delivered
  if (shipment.event_delivered) {
    return {
      eligible: false,
      reason: 'This package has been marked as delivered. Lost in Transit claims cannot be filed for delivered packages.',
      isInternational: shipment.origin_country !== shipment.destination_country,
      requiredDays: shipment.origin_country !== shipment.destination_country
        ? LOST_IN_TRANSIT_INTERNATIONAL_DAYS
        : LOST_IN_TRANSIT_DOMESTIC_DAYS,
      daysSinceLastScan: null,
      fromCache: false,
    }
  }

  const isInternational = shipment.origin_country !== shipment.destination_country
  const requiredDays = isInternational
    ? LOST_IN_TRANSIT_INTERNATIONAL_DAYS
    : LOST_IN_TRANSIT_DOMESTIC_DAYS

  // Check for existing verification that hasn't reached eligibility
  const { data: existingCheck } = await supabase
    .from('lost_in_transit_checks')
    .select('*')
    .eq('shipment_id', shipmentId)
    .single()

  if (existingCheck) {
    const eligibleAfter = new Date(existingCheck.eligible_after)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // If carrier already admitted loss (recheck-at-risk detected it), skip cache
    // and proceed to fresh TrackingMore call to confirm
    const carrierAdmittedLoss = isLostStatus(existingCheck.last_scan_description)

    // If still not eligible based on cached check AND carrier hasn't admitted loss,
    // return cached result
    if (eligibleAfter > today && !carrierAdmittedLoss) {
      const daysRemaining = Math.ceil((eligibleAfter.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

      return {
        eligible: false,
        reason: `${isInternational ? 'International' : 'Domestic'} shipments require ${requiredDays} days of carrier inactivity. Check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
        lastScanDate: existingCheck.last_scan_date,
        lastScanDescription: existingCheck.last_scan_description,
        lastScanLocation: existingCheck.last_scan_location,
        daysRemaining,
        isInternational,
        requiredDays,
        daysSinceLastScan: existingCheck.last_scan_date
          ? Math.floor((Date.now() - new Date(existingCheck.last_scan_date).getTime()) / (1000 * 60 * 60 * 24))
          : null,
        fromCache: true,
        previousCheckDate: existingCheck.checked_at,
      }
    }
    // Otherwise, continue to make a fresh TrackingMore call
  }

  // Validate we have tracking info
  if (!shipment.tracking_id) {
    return {
      eligible: false,
      reason: 'This shipment does not have a tracking number. Unable to verify carrier status.',
      isInternational,
      requiredDays,
      daysSinceLastScan: null,
      fromCache: false,
    }
  }

  // Call TrackingMore to get real tracking data
  const trackingResult = await getTracking(shipment.tracking_id, shipment.carrier)

  // If TrackingMore fails, check if we can determine eligibility from label date
  if (!trackingResult.success || !trackingResult.tracking) {
    const labelDate = shipment.event_labeled ? new Date(shipment.event_labeled) : null
    const daysSinceLabeled = labelDate
      ? Math.floor((Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24))
      : null

    if (daysSinceLabeled !== null && daysSinceLabeled >= requiredDays) {
      console.log('[LIT Verify] TrackingMore failed but label is old enough, marking eligible:', daysSinceLabeled, 'days')
      return {
        eligible: true,
        canProceed: true,
        reason: `Unable to retrieve carrier tracking data. The package was labeled ${daysSinceLabeled} days ago with no carrier scan records found.`,
        lastScanDescription: 'No carrier records found',
        isInternational,
        requiredDays,
        daysSinceLastScan: daysSinceLabeled,
        fromCache: false,
      }
    }

    if (daysSinceLabeled !== null && daysSinceLabeled < requiredDays) {
      const daysRemaining = requiredDays - daysSinceLabeled
      return {
        eligible: false,
        reason: `Unable to retrieve carrier tracking data. The package was labeled ${daysSinceLabeled} day${daysSinceLabeled === 1 ? '' : 's'} ago. Lost in Transit claims for ${isInternational ? 'international' : 'domestic'} shipments require ${requiredDays} days. Please check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
        lastScanDescription: 'No carrier records found',
        daysRemaining,
        isInternational,
        requiredDays,
        daysSinceLastScan: daysSinceLabeled,
        fromCache: false,
      }
    }

    return {
      eligible: false,
      reason: `Unable to verify tracking status: ${trackingResult.error || 'Unknown error'}. Please try again later or contact support.`,
      error: trackingResult.error,
      isInternational,
      requiredDays,
      daysSinceLastScan: null,
      fromCache: false,
    }
  }

  const tracking = trackingResult.tracking

  // Store checkpoints for Delivery IQ
  try {
    await storeCheckpoints(shipment.shipment_id, tracking, shipment.carrier)
  } catch (storeError) {
    console.error('[LIT Verify] Failed to store checkpoints:', storeError)
  }

  console.log('[LIT Verify] TrackingMore response for', shipment.tracking_id, ':', JSON.stringify({
    status: tracking.status,
    latest_event: tracking.latest_event,
    latest_checkpoint_time: tracking.latest_checkpoint_time,
    hasOriginInfo: !!tracking.origin_info?.trackinfo?.length,
    hasDestInfo: !!tracking.destination_info?.trackinfo?.length,
    lastCheckpoint: trackingResult.lastCheckpoint,
  }))

  // Check if TrackingMore shows delivered
  if (isDelivered(tracking)) {
    return {
      eligible: false,
      reason: 'Carrier records show this package has been delivered. Lost in Transit claims cannot be filed for delivered packages.',
      isInternational,
      requiredDays,
      daysSinceLastScan: null,
      fromCache: false,
    }
  }

  // Check if carrier has admitted the package is lost
  // This overrides day-based thresholds — carrier admission = immediate eligibility
  if (isLostStatus(tracking.latest_event)) {
    const lostCheckpoint = trackingResult.lastCheckpoint
    const lostCheckpointDate = getLastCheckpointDate(tracking)
    const lostLocation = lostCheckpoint?.location || undefined
    const lostDaysSince = daysSinceLastCheckpoint(tracking)

    // Upsert with eligible_after = today (immediate eligibility)
    const todayStr = new Date().toISOString().split('T')[0]
    await supabase
      .from('lost_in_transit_checks')
      .upsert({
        shipment_id: shipmentId,
        tracking_number: shipment.tracking_id,
        carrier: shipment.carrier,
        checked_at: new Date().toISOString(),
        eligible_after: todayStr,
        last_scan_date: lostCheckpointDate?.toISOString() || null,
        last_scan_description: tracking.latest_event || null,
        last_scan_location: lostLocation || null,
        is_international: isInternational,
        client_id: shipment.client_id,
      }, { onConflict: 'shipment_id' })

    console.log('[LIT Verify] Carrier admitted loss:', tracking.latest_event)

    return {
      eligible: true,
      canProceed: true,
      reason: `The carrier has confirmed this package is lost: "${tracking.latest_event}"`,
      lastScanDate: lostCheckpointDate?.toISOString(),
      lastScanDescription: tracking.latest_event || undefined,
      lastScanLocation: lostLocation,
      isInternational,
      requiredDays,
      daysSinceLastScan: lostDaysSince,
      fromCache: false,
    }
  }

  // Get last checkpoint info
  const lastCheckpoint = trackingResult.lastCheckpoint
  const lastCheckpointDate = getLastCheckpointDate(tracking)
  const daysSince = daysSinceLastCheckpoint(tracking)
  const location = lastCheckpoint?.location || undefined

  // Handle case where tracking exists but no checkpoint data
  if (!lastCheckpointDate) {
    const statusMessage = tracking.latest_event || tracking.status || 'pending'
    const neverScannedStatuses = ['pending', 'notfound', 'inforeceived', '']
    const trackingStatus = tracking.status?.toLowerCase() || ''
    const wasNeverScanned = neverScannedStatuses.includes(trackingStatus) || !tracking.status

    console.log('[LIT Verify] No checkpoint data. Status:', tracking.status, 'wasNeverScanned:', wasNeverScanned)

    const labelDate = shipment.event_labeled ? new Date(shipment.event_labeled) : null
    const daysSinceLabeled = labelDate
      ? Math.floor((Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24))
      : null

    if (wasNeverScanned && daysSinceLabeled !== null && daysSinceLabeled >= requiredDays) {
      return {
        eligible: true,
        canProceed: true,
        reason: `The carrier has no record of receiving this package. It was labeled ${daysSinceLabeled} days ago and has never been scanned by the carrier.`,
        lastScanDescription: 'Never scanned by carrier',
        isInternational,
        requiredDays,
        daysSinceLastScan: daysSinceLabeled,
        fromCache: false,
      }
    }

    if (wasNeverScanned && daysSinceLabeled !== null && daysSinceLabeled < requiredDays) {
      const daysRemaining = requiredDays - daysSinceLabeled
      return {
        eligible: false,
        reason: `The carrier has no record of receiving this package. It was labeled ${daysSinceLabeled} day${daysSinceLabeled === 1 ? '' : 's'} ago. Lost in Transit claims for ${isInternational ? 'international' : 'domestic'} shipments require ${requiredDays} days. Please check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
        lastScanDescription: 'Never scanned by carrier',
        daysRemaining,
        isInternational,
        requiredDays,
        daysSinceLastScan: daysSinceLabeled,
        fromCache: false,
      }
    }

    return {
      eligible: false,
      reason: `Unable to determine last carrier scan date. The tracking status is "${statusMessage}". Please try again later or contact support if this persists.`,
      lastScanDescription: statusMessage,
      isInternational,
      requiredDays,
      daysSinceLastScan: null,
      fromCache: false,
    }
  }

  // Calculate eligible_after date
  const eligibleAfterDate = new Date(lastCheckpointDate)
  eligibleAfterDate.setDate(eligibleAfterDate.getDate() + requiredDays)

  // Upsert the check result
  const { error: upsertError } = await supabase
    .from('lost_in_transit_checks')
    .upsert({
      shipment_id: shipmentId,
      tracking_number: shipment.tracking_id,
      carrier: shipment.carrier,
      checked_at: new Date().toISOString(),
      eligible_after: eligibleAfterDate.toISOString().split('T')[0],
      last_scan_date: lastCheckpointDate?.toISOString() || null,
      last_scan_description: lastCheckpoint?.message || null,
      last_scan_location: location || null,
      is_international: isInternational,
      client_id: shipment.client_id,
    }, {
      onConflict: 'shipment_id',
    })

  if (upsertError) {
    console.error('Error saving verification check:', upsertError)
  }

  // Check eligibility
  if (daysSince !== null && daysSince >= requiredDays) {
    return {
      eligible: true,
      canProceed: true,
      lastScanDate: lastCheckpointDate?.toISOString(),
      lastScanDescription: lastCheckpoint?.message,
      lastScanLocation: location,
      isInternational,
      requiredDays,
      daysSinceLastScan: daysSince,
      fromCache: false,
    }
  }

  // Not eligible yet
  const daysRemaining = daysSince !== null ? requiredDays - daysSince : requiredDays

  return {
    eligible: false,
    reason: `${isInternational ? 'International' : 'Domestic'} shipments require ${requiredDays} days of carrier inactivity. Check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
    lastScanDate: lastCheckpointDate?.toISOString(),
    lastScanDescription: lastCheckpoint?.message,
    lastScanLocation: location,
    daysRemaining,
    isInternational,
    requiredDays,
    daysSinceLastScan: daysSince,
    fromCache: false,
  }
}
