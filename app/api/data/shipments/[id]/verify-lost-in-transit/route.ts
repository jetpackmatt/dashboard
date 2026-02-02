import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
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

export interface VerifyLostInTransitResponse {
  eligible: boolean
  // If not eligible, reason details
  reason?: string
  lastScanDate?: string
  lastScanDescription?: string
  lastScanLocation?: string
  daysRemaining?: number
  // If eligible
  canProceed?: boolean
  // Metadata
  isInternational: boolean
  requiredDays: number
  daysSinceLastScan: number | null
  // Error info
  error?: string
  // Was this from cache or fresh TrackingMore call?
  fromCache: boolean
  // Previous check info if from cache
  previousCheckDate?: string
}

/**
 * POST /api/data/shipments/[id]/verify-lost-in-transit
 *
 * Verifies Lost in Transit eligibility using TrackingMore.
 * - First checks if we have a recent verification that hasn't reached eligibility yet
 * - If not, calls TrackingMore to get real carrier tracking data
 * - Logs the result to prevent redundant API calls
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id: shipmentId } = await params

  if (!shipmentId) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
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
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
      }
      console.error('Error fetching shipment:', shipmentError)
      return NextResponse.json({ error: shipmentError.message }, { status: 500 })
    }

    // CRITICAL SECURITY: Verify user has access to this shipment's client
    try {
      await verifyClientAccess(shipment.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Check if package is already delivered (from our data)
    if (shipment.event_delivered) {
      return NextResponse.json<VerifyLostInTransitResponse>({
        eligible: false,
        reason: 'This package has been marked as delivered. Lost in Transit claims cannot be filed for delivered packages.',
        isInternational: shipment.origin_country !== shipment.destination_country,
        requiredDays: shipment.origin_country !== shipment.destination_country
          ? LOST_IN_TRANSIT_INTERNATIONAL_DAYS
          : LOST_IN_TRANSIT_DOMESTIC_DAYS,
        daysSinceLastScan: null,
        fromCache: false,
      })
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

      // If still not eligible based on cached check, return cached result
      if (eligibleAfter > today) {
        const daysRemaining = Math.ceil((eligibleAfter.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

        return NextResponse.json<VerifyLostInTransitResponse>({
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
        })
      }
      // Otherwise, continue to make a fresh TrackingMore call (they might be eligible now)
    }

    // Validate we have tracking info
    if (!shipment.tracking_id) {
      return NextResponse.json<VerifyLostInTransitResponse>({
        eligible: false,
        reason: 'This shipment does not have a tracking number. Unable to verify carrier status.',
        isInternational,
        requiredDays,
        daysSinceLastScan: null,
        fromCache: false,
      })
    }

    // Call TrackingMore to get real tracking data
    const trackingResult = await getTracking(shipment.tracking_id, shipment.carrier)

    // If TrackingMore fails to retrieve tracking, check if we can still determine eligibility
    // based on the label date (if carrier has no record, treat as never scanned)
    if (!trackingResult.success || !trackingResult.tracking) {
      // Calculate days since label was created
      const labelDate = shipment.event_labeled ? new Date(shipment.event_labeled) : null
      const daysSinceLabeled = labelDate
        ? Math.floor((Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24))
        : null

      // If it's been 15+ days since labeling and we can't find tracking data,
      // the package likely never made it into the carrier system - mark as eligible
      if (daysSinceLabeled !== null && daysSinceLabeled >= requiredDays) {
        console.log('[LIT Verify] TrackingMore failed but label is old enough, marking eligible:', daysSinceLabeled, 'days')
        return NextResponse.json<VerifyLostInTransitResponse>({
          eligible: true,
          canProceed: true,
          reason: `Unable to retrieve carrier tracking data. The package was labeled ${daysSinceLabeled} days ago with no carrier scan records found.`,
          lastScanDescription: 'No carrier records found',
          isInternational,
          requiredDays,
          daysSinceLastScan: daysSinceLabeled,
          fromCache: false,
        })
      }

      // If not enough days have passed
      if (daysSinceLabeled !== null && daysSinceLabeled < requiredDays) {
        const daysRemaining = requiredDays - daysSinceLabeled
        return NextResponse.json<VerifyLostInTransitResponse>({
          eligible: false,
          reason: `Unable to retrieve carrier tracking data. The package was labeled ${daysSinceLabeled} day${daysSinceLabeled === 1 ? '' : 's'} ago. Lost in Transit claims for ${isInternational ? 'international' : 'domestic'} shipments require ${requiredDays} days. Please check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
          lastScanDescription: 'No carrier records found',
          daysRemaining,
          isInternational,
          requiredDays,
          daysSinceLastScan: daysSinceLabeled,
          fromCache: false,
        })
      }

      // Fallback if we don't have label date
      return NextResponse.json<VerifyLostInTransitResponse>({
        eligible: false,
        reason: `Unable to verify tracking status: ${trackingResult.error || 'Unknown error'}. Please try again later or contact support.`,
        error: trackingResult.error,
        isInternational,
        requiredDays,
        daysSinceLastScan: null,
        fromCache: false,
      })
    }

    const tracking = trackingResult.tracking

    // Store ALL checkpoints for Delivery IQ (permanent storage)
    try {
      await storeCheckpoints(shipment.shipment_id, tracking, shipment.carrier)
    } catch (storeError) {
      // Log but don't fail the request if storage fails
      console.error('[LIT Verify] Failed to store checkpoints:', storeError)
    }

    // Log the raw tracking data for debugging
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
      return NextResponse.json<VerifyLostInTransitResponse>({
        eligible: false,
        reason: 'Carrier records show this package has been delivered. Lost in Transit claims cannot be filed for delivered packages.',
        isInternational,
        requiredDays,
        daysSinceLastScan: null,
        fromCache: false,
      })
    }

    // Get last checkpoint info
    // TrackingMore returns { date, message, location } where location is already a formatted string
    const lastCheckpoint = trackingResult.lastCheckpoint
    const lastCheckpointDate = getLastCheckpointDate(tracking)
    const daysSince = daysSinceLastCheckpoint(tracking)

    // TrackingMore already provides location as a formatted string (e.g., "Paramount, CA, US")
    const location = lastCheckpoint?.location || undefined

    // Handle case where TrackingMore returns a tracking but no checkpoint data
    // If status is "pending" or "notfound", the carrier has never scanned this package.
    // If it's been 15+ days since labeling, this is actually eligible - the package
    // never made it into the carrier's system at all.
    if (!lastCheckpointDate) {
      const statusMessage = tracking.latest_event || tracking.status || 'pending'
      const neverScannedStatuses = ['pending', 'notfound', 'inforeceived', '']
      // Treat null/undefined/empty status as "never scanned" - if TrackingMore has no data, the carrier hasn't scanned it
      const trackingStatus = tracking.status?.toLowerCase() || ''
      const wasNeverScanned = neverScannedStatuses.includes(trackingStatus) || !tracking.status

      console.log('[LIT Verify] No checkpoint data. Status:', tracking.status, 'wasNeverScanned:', wasNeverScanned)

      // Calculate days since label was created
      const labelDate = shipment.event_labeled ? new Date(shipment.event_labeled) : null
      const daysSinceLabeled = labelDate
        ? Math.floor((Date.now() - labelDate.getTime()) / (1000 * 60 * 60 * 24))
        : null

      // If carrier never scanned it AND it's been 15+ days since labeling, it's eligible
      if (wasNeverScanned && daysSinceLabeled !== null && daysSinceLabeled >= requiredDays) {
        return NextResponse.json<VerifyLostInTransitResponse>({
          eligible: true,
          canProceed: true,
          reason: `The carrier has no record of receiving this package. It was labeled ${daysSinceLabeled} days ago and has never been scanned by the carrier.`,
          lastScanDescription: 'Never scanned by carrier',
          isInternational,
          requiredDays,
          daysSinceLastScan: daysSinceLabeled, // Use days since label as proxy
          fromCache: false,
        })
      }

      // If carrier never scanned but not enough days have passed
      if (wasNeverScanned && daysSinceLabeled !== null && daysSinceLabeled < requiredDays) {
        const daysRemaining = requiredDays - daysSinceLabeled
        return NextResponse.json<VerifyLostInTransitResponse>({
          eligible: false,
          reason: `The carrier has no record of receiving this package. It was labeled ${daysSinceLabeled} day${daysSinceLabeled === 1 ? '' : 's'} ago. Lost in Transit claims for ${isInternational ? 'international' : 'domestic'} shipments require ${requiredDays} days. Please check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
          lastScanDescription: 'Never scanned by carrier',
          daysRemaining,
          isInternational,
          requiredDays,
          daysSinceLastScan: daysSinceLabeled,
          fromCache: false,
        })
      }

      // Fallback for other cases (no label date, unexpected status, etc.)
      return NextResponse.json<VerifyLostInTransitResponse>({
        eligible: false,
        reason: `Unable to determine last carrier scan date. The tracking status is "${statusMessage}". Please try again later or contact support if this persists.`,
        lastScanDescription: statusMessage,
        isInternational,
        requiredDays,
        daysSinceLastScan: null,
        fromCache: false,
      })
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
      // Don't fail the request, just log it
    }

    // Check eligibility
    if (daysSince !== null && daysSince >= requiredDays) {
      return NextResponse.json<VerifyLostInTransitResponse>({
        eligible: true,
        canProceed: true,
        lastScanDate: lastCheckpointDate?.toISOString(),
        lastScanDescription: lastCheckpoint?.message,
        lastScanLocation: location,
        isInternational,
        requiredDays,
        daysSinceLastScan: daysSince,
        fromCache: false,
      })
    }

    // Not eligible yet
    const daysRemaining = daysSince !== null ? requiredDays - daysSince : requiredDays

    return NextResponse.json<VerifyLostInTransitResponse>({
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
    })

  } catch (err) {
    console.error('Verify Lost in Transit API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
