import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { getTracking, getTrackingMoreCarrierCode } from '@/lib/trackingmore/client'
import { storeCheckpoints } from '@/lib/trackingmore/checkpoint-storage'

/**
 * GET /api/data/tracking/[trackingNumber]/timeline
 *
 * Fetches the full tracking timeline for a shipment, merging:
 * 1. ShipBob warehouse events (from event_logs)
 * 2. TrackingMore carrier checkpoints (fetched on-demand, FREE for existing trackings)
 *
 * Returns a unified timeline with source attribution.
 */

interface TimelineEvent {
  timestamp: string
  title: string
  description: string
  location: string | null
  source: 'shipbob' | 'carrier' | 'claim'
  type: 'warehouse' | 'transit' | 'delivery' | 'exception' | 'info' | 'claim'
  status?: string
  // AI-normalized fields (for carrier events from tracking_checkpoints)
  normalizedType?: string  // LABEL, PICKUP, HUB, LOCAL, OFD, DELIVERED, etc.
  sentiment?: string  // positive, neutral, concerning, critical
}

interface TrackingTimelineResponse {
  trackingNumber: string
  carrier: string
  carrierDisplayName: string
  currentStatus: string
  claimStatus: string | null  // Care ticket status if claim was filed (Under Review, Credit Requested, Credit Approved, Credit Denied, Resolved)
  estimatedDelivery: string | null
  timeline: TimelineEvent[]
  lastCarrierScan: {
    date: string | null
    description: string | null  // Raw carrier description
    displayTitle: string | null  // AI-normalized friendly title
    location: string | null
    daysSince: number | null
    normalizedType: string | null  // LABEL, PICKUP, HUB, LOCAL, OFD, DELIVERED, etc.
    sentiment: string | null  // positive, neutral, concerning, critical
  }
  shipmentInfo: {
    shipmentId: string
    shipDate: string | null
    firstScanDate: string | null
    origin: string | null
    destination: string | null
  }
}

// Map ShipBob log types to timeline event types
// Only show meaningful warehouse events - filter out noise that overlaps with carrier tracking
function mapShipBobLogType(logTypeName: string): { title: string; type: TimelineEvent['type'] } | null {
  const mapping: Record<string, { title: string; type: TimelineEvent['type'] }> = {
    // Core warehouse events only
    'OrderPlacedStoreIntegration': { title: 'Order Placed', type: 'info' },
    'OrderPicked': { title: 'Picked', type: 'warehouse' },
    'OrderPacked': { title: 'Packed', type: 'warehouse' },
    'LabelGeneratedLog': { title: 'Shipping Label Created', type: 'warehouse' },
    'ShipmentSortedToCarrier': { title: 'Package Sorted for Carrier', type: 'warehouse' },
    'ShipmentPickedupByCarrier': { title: 'Carrier Picked Up Package', type: 'warehouse' },
  }
  return mapping[logTypeName] || null // Return null for events we don't want to show
}

// Map common tracking descriptions to standardized event titles
// This handles the wide variety of carrier-specific wording
// Built from analysis of ALL distinct tracking descriptions in our database
const DESCRIPTION_TO_TITLE: Array<{ pattern: RegExp; title: string }> = [
  // === DELIVERED ===
  { pattern: /^delivered/i, title: 'Delivered' },
  { pattern: /^delivery,/i, title: 'Delivered' },

  // === OUT FOR DELIVERY ===
  { pattern: /out.*(with )?courier.*delivery/i, title: 'Out for Delivery' },
  { pattern: /out for delivery/i, title: 'Out for Delivery' },
  { pattern: /with delivery courier/i, title: 'Out for Delivery' },
  { pattern: /scheduled for delivery/i, title: 'Out for Delivery' },

  // === DELIVERY ATTEMPTED ===
  { pattern: /delivery attempt/i, title: 'Delivery Attempted' },
  { pattern: /attempted.*(delivery|no response)/i, title: 'Delivery Attempted' },
  { pattern: /no one available/i, title: 'Delivery Attempted' },
  { pattern: /recipient not available/i, title: 'Delivery Attempted' },
  { pattern: /notice left/i, title: 'Delivery Attempted' },

  // === RETURNED TO SENDER ===
  { pattern: /returned to (shipper|sender)/i, title: 'Returned to Sender' },
  { pattern: /return to sender/i, title: 'Returned to Sender' },
  { pattern: /package.*returned to.*seller/i, title: 'Returned to Sender' },
  { pattern: /returninitiated/i, title: 'Return Initiated' },
  { pattern: /being returned to/i, title: 'Return in Progress' },
  { pattern: /exceeded maximum on holds.*return/i, title: 'Returned - Max Holds Exceeded' },

  // === FORWARDED/TRANSFERRED ===
  { pattern: /forwarded to.*(third party|agent|partner)/i, title: 'Forwarded to Local Carrier' },
  { pattern: /transferred to.*(third party|agent|partner|local)/i, title: 'Forwarded to Local Carrier' },
  { pattern: /handed over to.*(delivery|local|agent)/i, title: 'Forwarded to Local Carrier' },
  { pattern: /delivery.*arranged.*third party/i, title: 'Forwarded to Local Carrier' },
  { pattern: /arrived at a local courier/i, title: 'At Local Carrier' },

  // === READY FOR PICKUP ===
  { pattern: /awaiting collection/i, title: 'Ready for Pickup' },
  { pattern: /ready for (pickup|collection)/i, title: 'Ready for Pickup' },
  { pattern: /available for (pickup|collection)/i, title: 'Ready for Pickup' },
  { pattern: /reminder to pick up/i, title: 'Pickup Reminder' },

  // === HELD AT FACILITY ===
  { pattern: /held at.*(post office|facility|location|office)/i, title: 'Held at Facility' },
  { pattern: /hold for instructions/i, title: 'Held for Instructions' },
  { pattern: /shipment is on hold/i, title: 'Shipment on Hold' },
  { pattern: /on hold awaiting.*payment/i, title: 'On Hold - Payment Required' },

  // === CUSTOMS/CLEARANCE ===
  { pattern: /customs clearance/i, title: 'Customs Clearance' },
  { pattern: /^clearance event/i, title: 'Customs Clearance' },
  { pattern: /cleared customs/i, title: 'Cleared Customs' },
  { pattern: /processed for clearance/i, title: 'Customs Clearance' },
  { pattern: /import scan/i, title: 'Import Scan' },
  { pattern: /export scan/i, title: 'Export Scan' },
  { pattern: /customs.*hold/i, title: 'Customs Hold' },

  // === ARRIVED AT FACILITY ===
  // IMPORTANT: More specific patterns must come BEFORE general patterns
  { pattern: /arrived at final servicing facility/i, title: 'Arrived at Final Facility' },
  { pattern: /arrived.*(final|servicing) facility/i, title: 'Arrived at Destination Facility' },
  { pattern: /arrived at military post office/i, title: 'Arrived at Military Post Office' },
  { pattern: /arrived at.*(gofo|veho)/i, title: 'Arrived at Facility' },
  { pattern: /at (veho|gofo|ontrac) facility/i, title: 'At Carrier Facility' },
  { pattern: /arrived at.*(hub|facility|center|sort|destination|fedex|station|post office)/i, title: 'Arrived at Facility' },
  { pattern: /arrivedatcarrierfacility/i, title: 'Arrived at Facility' },
  { pattern: /your item arrived at/i, title: 'Arrived at Facility' },
  { pattern: /received at.*hub/i, title: 'Arrived at Facility' },

  // === DEPARTED FACILITY ===
  { pattern: /departed.*(hub|facility|center|sort|origin|fedex|location)/i, title: 'Departed Facility' },
  { pattern: /^departed$/i, title: 'Departed Facility' },
  { pattern: /^departed,/i, title: 'Departed Facility' },

  // === ORIGIN/PICKUP SCANS ===
  // IMPORTANT: These must come BEFORE "In Transit" patterns because descriptions like
  // "Origin Scan Your package has been received and is on its way to..." contain both
  { pattern: /^origin scan/i, title: 'Origin Scan' },
  { pattern: /origin scan/i, title: 'Origin Scan' },
  { pattern: /picked up/i, title: 'Picked Up' },
  { pattern: /package received/i, title: 'Package Received' },
  { pattern: /shipment received/i, title: 'Shipment Received' },
  { pattern: /pickupcancelled/i, title: 'Pickup Cancelled' },

  // === INFO RECEIVED / LABEL CREATED ===
  { pattern: /received order information/i, title: 'Order Information Received' },
  { pattern: /shipping label created/i, title: 'Shipping Label Created' },
  { pattern: /awaiting carrier scan/i, title: 'Awaiting Carrier Scan' },
  { pattern: /package data was sent to/i, title: 'Label Info Sent to Carrier' },

  // === PROCESSING ===
  { pattern: /processing at.*facility/i, title: 'Processing at Facility' },
  { pattern: /processing exception/i, title: 'Processing Exception' },
  { pattern: /your item is being processed/i, title: 'Processing at Facility' },

  // === IN TRANSIT ===
  // IMPORTANT: These general patterns must come AFTER more specific ones above
  { pattern: /in transit to next facility/i, title: 'In Transit' },
  { pattern: /in transit.*arriving late/i, title: 'In Transit - Delayed' },
  { pattern: /on its way to/i, title: 'In Transit' },
  { pattern: /in transit to/i, title: 'In Transit' },
  { pattern: /en route/i, title: 'In Transit' },

  // === UNABLE TO LOCATE/DELIVER ===
  { pattern: /unable to (locate|find)/i, title: 'Unable to Locate' },
  { pattern: /unable to deliver/i, title: 'Unable to Deliver' },
  { pattern: /undeliverable/i, title: 'Undeliverable' },
  { pattern: /^lost,/i, title: 'Lost' },

  // === ADDRESS ISSUES ===
  { pattern: /address (issue|problem|incorrect)/i, title: 'Address Issue' },
  { pattern: /incorrect.*address/i, title: 'Address Issue' },
  { pattern: /incomplete address/i, title: 'Address Issue' },
  { pattern: /awaiting address confirmation/i, title: 'Address Confirmation Needed' },
  { pattern: /details needed.*contact/i, title: 'Details Needed' },
  { pattern: /need additional information/i, title: 'Details Needed' },

  // === DELAYS/EXCEPTIONS ===
  { pattern: /weather delay/i, title: 'Weather Delay' },
  { pattern: /regional weather/i, title: 'Weather Delay' },
  { pattern: /arriving late/i, title: 'Arriving Late' },
  { pattern: /awaiting delivery.*apologize for the delay/i, title: 'Delayed' },
  { pattern: /delivery exception/i, title: 'Delivery Exception' },
  { pattern: /no access to delivery location/i, title: 'No Access to Location' },

  // === DAMAGED ===
  { pattern: /^damaged/i, title: 'Damaged' },
  { pattern: /package.*damaged/i, title: 'Damaged' },

  // === REDELIVERY ===
  { pattern: /redelivery scheduled/i, title: 'Redelivery Scheduled' },
  { pattern: /reminder to schedule redelivery/i, title: 'Schedule Redelivery' },
  { pattern: /customer.*requested.*redeliver/i, title: 'Redelivery Scheduled' },

  // === CONTACT CARRIER ===
  { pattern: /please contact (dhl|carrier|ups|fedex|usps)/i, title: 'Contact Carrier Required' },

  // === NOTIFICATIONS ===
  { pattern: /recipient notified/i, title: 'Recipient Notified' },
  { pattern: /missing mail search/i, title: 'Missing Mail Search' },
  { pattern: /service.*has been changed/i, title: 'Service Changed' },

  // === ISSUE WITH ORDER (carrier-specific) ===
  { pattern: /issue with order/i, title: 'Issue with Order' },
  { pattern: /delivery.*refused/i, title: 'Delivery Refused' },
]

// Extract a meaningful title from the tracking description
function extractCarrierTitle(description: string): string {
  if (!description) return 'In Transit'

  // First, try to match against known description patterns
  for (const { pattern, title } of DESCRIPTION_TO_TITLE) {
    if (pattern.test(description)) {
      return title
    }
  }

  // Common phrases that indicate where the title ends (for verbose descriptions)
  const titleEndPatterns = [
    /^(.+?)\s+Your package/i,
    /^(.+?)\s+We're sorry/i,
    /^(.+?)\s+We are unable/i,
    /^(.+?)\s+Package received/i,
    /^(.+?)\s+Package /i,
    /^(.+?)\s+The package/i,
    /^(.+?),?\s+see Estimated/i,
    /^(.+?)\s+Your shipment/i,
    /^(.+?)\s+Item /i,
  ]

  for (const pattern of titleEndPatterns) {
    const match = description.match(pattern)
    if (match && match[1] && match[1].length <= 40) {
      return match[1].trim()
    }
  }

  // If description is short and looks like a title already, use it
  if (description.length <= 35 && !/your|package|shipment/i.test(description)) {
    return description
  }

  // Fallback: take first few words if they start with a known prefix
  const words = description.split(/\s+/)
  if (words.length >= 2) {
    const prefixes = [
      'Origin', 'Destination', 'Arrived', 'Departed', 'Out', 'Unable',
      'Delivered', 'Picked', 'Received', 'Forwarded', 'Cleared', 'Sorted'
    ]
    if (prefixes.some(p => words[0].startsWith(p))) {
      let title = words[0]
      for (let i = 1; i < Math.min(words.length, 4); i++) {
        const word = words[i]
        if (['Your', 'The', 'Package', 'Item', 'We', 'has', 'have', 'is', 'was', 'been', 'and', 'see'].includes(word)) {
          break
        }
        title += ' ' + word
      }
      if (title.length <= 35) {
        return title
      }
    }
  }

  return 'In Transit'
}

// Country code to full name mapping for international destinations
const COUNTRY_NAMES: Record<string, string> = {
  'US': 'United States',
  'USA': 'United States',
  'CA': 'Canada',
  'CAN': 'Canada',
  'MX': 'Mexico',
  'MEX': 'Mexico',
  'GB': 'United Kingdom',
  'UK': 'United Kingdom',
  'GBR': 'United Kingdom',
  'AU': 'Australia',
  'AUS': 'Australia',
  'DE': 'Germany',
  'DEU': 'Germany',
  'FR': 'France',
  'FRA': 'France',
  'IT': 'Italy',
  'ITA': 'Italy',
  'ES': 'Spain',
  'ESP': 'Spain',
  'NL': 'Netherlands',
  'NLD': 'Netherlands',
  'BE': 'Belgium',
  'BEL': 'Belgium',
  'JP': 'Japan',
  'JPN': 'Japan',
  'KR': 'South Korea',
  'KOR': 'South Korea',
  'CN': 'China',
  'CHN': 'China',
  'IN': 'India',
  'IND': 'India',
  'BR': 'Brazil',
  'BRA': 'Brazil',
  'IE': 'Ireland',
  'IRL': 'Ireland',
  'SE': 'Sweden',
  'SWE': 'Sweden',
  'NO': 'Norway',
  'NOR': 'Norway',
  'DK': 'Denmark',
  'DNK': 'Denmark',
  'FI': 'Finland',
  'FIN': 'Finland',
  'AT': 'Austria',
  'AUT': 'Austria',
  'CH': 'Switzerland',
  'CHE': 'Switzerland',
  'NZ': 'New Zealand',
  'NZL': 'New Zealand',
  'SG': 'Singapore',
  'SGP': 'Singapore',
  'HK': 'Hong Kong',
  'HKG': 'Hong Kong',
  'TW': 'Taiwan',
  'TWN': 'Taiwan',
  'PH': 'Philippines',
  'PHL': 'Philippines',
  'TH': 'Thailand',
  'THA': 'Thailand',
  'MY': 'Malaysia',
  'MYS': 'Malaysia',
  'ID': 'Indonesia',
  'IDN': 'Indonesia',
  'VN': 'Vietnam',
  'VNM': 'Vietnam',
  'AE': 'United Arab Emirates',
  'ARE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'SAU': 'Saudi Arabia',
  'IL': 'Israel',
  'ISR': 'Israel',
  'ZA': 'South Africa',
  'ZAF': 'South Africa',
  'PT': 'Portugal',
  'PRT': 'Portugal',
  'PL': 'Poland',
  'POL': 'Poland',
  'CZ': 'Czech Republic',
  'CZE': 'Czech Republic',
  'RO': 'Romania',
  'ROU': 'Romania',
  'GR': 'Greece',
  'GRC': 'Greece',
  'HU': 'Hungary',
  'HUN': 'Hungary',
  'AR': 'Argentina',
  'ARG': 'Argentina',
  'CL': 'Chile',
  'CHL': 'Chile',
  'CO': 'Colombia',
  'COL': 'Colombia',
  'PE': 'Peru',
  'PER': 'Peru',
  'PR': 'Puerto Rico',
  'PRI': 'Puerto Rico',
  'VI': 'US Virgin Islands',
  'VIR': 'US Virgin Islands',
}

// Format destination based on whether it's domestic or international
function formatDestination(
  originCountry: string | null,
  destinationCountry: string | null,
  lastScanLocation: string | null
): string | null {
  if (!destinationCountry) return lastScanLocation || null

  const isDomestic = originCountry === destinationCountry

  if (isDomestic) {
    // Domestic: show "City, State" format (e.g., "New York, NY" or "Toronto, ON")
    if (lastScanLocation) {
      // lastScanLocation might already be in "City, State" format, or just city
      // or it could have country appended - clean it up
      let location = lastScanLocation
        .replace(/, ?US$/, '')
        .replace(/, ?USA$/, '')
        .replace(/, ?CA$/, '')
        .replace(/, ?Canada$/, '')
        .replace(/, ?United States$/, '')
        .trim()

      return location || null
    }
    return null
  } else {
    // International: show full country name
    const countryName = COUNTRY_NAMES[destinationCountry.toUpperCase()] || destinationCountry
    return countryName
  }
}

// Map TrackingMore status to timeline event type
function mapCarrierStatus(status: string, substatus: string, description: string): { title: string; type: TimelineEvent['type'] } {
  const statusLower = (status || '').toLowerCase()
  const substatusLower = (substatus || '').toLowerCase()

  // Determine event type
  let type: TimelineEvent['type'] = 'transit'
  if (statusLower === 'delivered') type = 'delivery'
  else if (statusLower === 'exception' || substatusLower.includes('exception')) type = 'exception'
  else if (statusLower === 'inforeceived') type = 'info'

  // Extract title from description
  let title = extractCarrierTitle(description)

  // Override for delivered status
  if (statusLower === 'delivered' && title === 'In Transit') {
    title = 'Delivered'
  }

  // Override for info received
  if (statusLower === 'inforeceived' && title === 'In Transit') {
    title = 'Shipment Info Received'
  }

  return { title, type }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ trackingNumber: string }> }
) {
  const { trackingNumber } = await params
  console.log('[Tracking Timeline] Request for tracking:', trackingNumber)

  // Verify user access
  const searchParams = request.nextUrl.searchParams
  try {
    await verifyClientAccess(searchParams.get('clientId'))
    console.log('[Tracking Timeline] Auth passed')
  } catch (error) {
    console.error('[Tracking Timeline] Auth failed:', error)
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  try {
    // Find the shipment by tracking number
    console.log('[Tracking Timeline] Looking up shipment by tracking_id:', trackingNumber)
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select(`
        shipment_id,
        tracking_id,
        carrier,
        event_logs,
        event_labeled,
        event_delivered,
        origin_country,
        destination_country,
        status
      `)
      .eq('tracking_id', trackingNumber)
      .single()

    if (shipmentError || !shipment) {
      console.error('[Tracking Timeline] Shipment lookup failed:', { trackingNumber, error: shipmentError })
      return NextResponse.json(
        { error: 'Shipment not found', details: shipmentError?.message },
        { status: 404 }
      )
    }

    const timeline: TimelineEvent[] = []

    // 1. Add ShipBob warehouse events from event_logs (only meaningful ones)
    // We dedupe warehouse events by title, keeping only the most recent of each type
    // This handles voided labels and repeated sorting events cleanly
    if (shipment.event_logs && Array.isArray(shipment.event_logs)) {
      // First, collect all events
      const warehouseEvents: TimelineEvent[] = []
      for (const log of shipment.event_logs) {
        const mapped = mapShipBobLogType(log.log_type_name)
        // Skip events we don't want to show (mapping returns null)
        if (!mapped) continue

        warehouseEvents.push({
          timestamp: log.timestamp,
          title: mapped.title,
          description: log.log_type_text || '',
          location: log.metadata?.fulfillment_center || null,
          source: 'shipbob',
          type: mapped.type,
        })
      }

      // Dedupe: for each title, keep only the most recent event
      // This removes voided label attempts and repeated sorting events
      const latestByTitle = new Map<string, TimelineEvent>()
      for (const event of warehouseEvents) {
        const existing = latestByTitle.get(event.title)
        if (!existing || new Date(event.timestamp) > new Date(existing.timestamp)) {
          latestByTitle.set(event.title, event)
        }
      }

      // Add deduped events to timeline
      timeline.push(...latestByTitle.values())
    }

    // 2. Fetch carrier tracking - prefer stored normalized checkpoints, fallback to TrackingMore
    let carrierTimeline: TimelineEvent[] = []
    let lastCarrierScan = {
      date: null as string | null,
      description: null as string | null,
      displayTitle: null as string | null,
      location: null as string | null,
      daysSince: null as number | null,
      normalizedType: null as string | null,
      sentiment: null as string | null,
    }
    let currentStatus = shipment.status || 'Unknown'

    // First, check for stored normalized checkpoints
    const { data: storedCheckpoints } = await supabase
      .from('tracking_checkpoints')
      .select('*')
      .eq('shipment_id', shipment.shipment_id)
      .order('checkpoint_date', { ascending: false })

    if (storedCheckpoints && storedCheckpoints.length > 0) {
      // Use stored normalized checkpoints (preferred path)
      console.log('[Tracking Timeline] Using', storedCheckpoints.length, 'stored checkpoints')

      // Set current status from most recent checkpoint
      const latest = storedCheckpoints[0]
      if (latest.raw_status) {
        currentStatus = latest.raw_status
      }

      lastCarrierScan = {
        date: latest.checkpoint_date,
        description: latest.raw_description,
        displayTitle: latest.display_title || latest.raw_description,
        location: latest.raw_location || null,
        daysSince: Math.floor((Date.now() - new Date(latest.checkpoint_date).getTime()) / (1000 * 60 * 60 * 24)),
        normalizedType: latest.normalized_type,
        sentiment: latest.sentiment,
      }

      // Build timeline from stored checkpoints
      for (const cp of storedCheckpoints) {
        // Skip LABEL type - redundant with warehouse "Shipping Label Created" event
        if (cp.normalized_type === 'LABEL') continue

        // Determine event type from normalized_type
        let type: TimelineEvent['type'] = 'transit'
        if (cp.normalized_type === 'DELIVERED') type = 'delivery'
        else if (['EXCEPTION', 'RETURN', 'ATTEMPT'].includes(cp.normalized_type || '')) type = 'exception'
        else if (cp.normalized_type === 'LABEL') type = 'info'

        carrierTimeline.push({
          timestamp: cp.checkpoint_date,
          title: cp.display_title || cp.raw_description,
          description: cp.raw_description,
          location: cp.raw_location,
          source: 'carrier',
          type,
          status: cp.raw_status || undefined,
          normalizedType: cp.normalized_type || undefined,
          sentiment: cp.sentiment || undefined,
        })
      }
    } else {
      // Fallback: Fetch from TrackingMore and store (FREE for existing trackings)
      const carrierCode = getTrackingMoreCarrierCode(shipment.carrier)
      if (carrierCode) {
        const trackingResult = await getTracking(trackingNumber, shipment.carrier)

        if (trackingResult.success && trackingResult.tracking) {
          const tracking = trackingResult.tracking
          currentStatus = tracking.status || currentStatus

          // Store ALL checkpoints for Delivery IQ (permanent storage)
          try {
            await storeCheckpoints(shipment.shipment_id, tracking, shipment.carrier)
          } catch (storeError) {
            // Log but don't fail the request if storage fails
            console.error('[Tracking Timeline] Failed to store checkpoints:', storeError)
          }

          // Combine origin and destination checkpoints
          const checkpoints = [
            ...(tracking.origin_info?.trackinfo || []),
            ...(tracking.destination_info?.trackinfo || []),
          ]

          // Sort by date descending and get the latest
          checkpoints.sort((a, b) =>
            new Date(b.checkpoint_date).getTime() - new Date(a.checkpoint_date).getTime()
          )

          if (checkpoints.length > 0) {
            const latest = checkpoints[0]
            lastCarrierScan = {
              date: latest.checkpoint_date,
              description: latest.tracking_detail,
              displayTitle: null, // No AI normalization yet
              location: latest.location || [latest.city, latest.state].filter(Boolean).join(', ') || null,
              daysSince: Math.floor((Date.now() - new Date(latest.checkpoint_date).getTime()) / (1000 * 60 * 60 * 24)),
              normalizedType: null,
              sentiment: null,
            }
          }

          // Add all checkpoints to timeline (skip InfoReceived - redundant with warehouse label events)
          for (const checkpoint of checkpoints) {
            const statusLower = (checkpoint.checkpoint_delivery_status || '').toLowerCase()

            // Skip "InfoReceived" status - it's just carrier acknowledging label data
            // which is redundant with our warehouse "Shipping Label Created" event
            if (statusLower === 'inforeceived') continue

            const { title, type } = mapCarrierStatus(
              checkpoint.checkpoint_delivery_status,
              checkpoint.checkpoint_delivery_substatus,
              checkpoint.tracking_detail || ''
            )
            carrierTimeline.push({
              timestamp: checkpoint.checkpoint_date,
              title,
              description: checkpoint.tracking_detail || '',
              location: checkpoint.location || [checkpoint.city, checkpoint.state].filter(Boolean).join(', ') || null,
              source: 'carrier',
              type,
              status: checkpoint.checkpoint_delivery_status,
            })
          }
        }
      }
    }

    // 3. Fetch care ticket events (claims) for this shipment
    let claimTimeline: TimelineEvent[] = []
    const { data: careTicket } = await supabase
      .from('care_tickets')
      .select('ticket_number, status, issue_type, events, credit_amount')
      .eq('shipment_id', shipment.shipment_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (careTicket && careTicket.events && Array.isArray(careTicket.events)) {
      // Care ticket events are stored newest-first, convert to timeline events
      for (const event of careTicket.events) {
        if (!event.createdAt || !event.status) continue

        // Map claim status to a readable title
        let title = event.status
        if (event.status === 'Under Review') title = 'Claim Submitted'
        else if (event.status === 'Credit Requested') title = 'Credit Requested'
        else if (event.status === 'Credit Approved') title = 'Credit Approved'
        else if (event.status === 'Credit Denied') title = 'Credit Denied'
        else if (event.status === 'Resolved') title = 'Claim Resolved'

        claimTimeline.push({
          timestamp: event.createdAt,
          title,
          description: event.note || '',
          location: null,
          source: 'claim',
          type: 'claim',
          status: event.status,
        })
      }
    }

    // Merge and sort all timeline events (newest first)
    const fullTimeline = [...timeline, ...carrierTimeline, ...claimTimeline].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    // Get first scan date (oldest carrier event that's not InfoReceived)
    const carrierEventsOnly = carrierTimeline.filter(e => e.source === 'carrier')
    const firstScanDate = carrierEventsOnly.length > 0
      ? carrierEventsOnly.reduce((oldest, current) =>
          new Date(current.timestamp) < new Date(oldest.timestamp) ? current : oldest
        ).timestamp
      : null

    // Format destination based on domestic vs international
    // Domestic: "City, State" (e.g., "New York, NY" or "Toronto, ON")
    // International: Full country name (e.g., "Mexico", "United Kingdom")
    const destination = formatDestination(
      shipment.origin_country,
      shipment.destination_country,
      lastCarrierScan.location
    )

    // Build response
    const response: TrackingTimelineResponse = {
      trackingNumber,
      carrier: shipment.carrier,
      carrierDisplayName: shipment.carrier,
      currentStatus,
      claimStatus: careTicket?.status || null,  // Care ticket status if claim was filed
      estimatedDelivery: null, // Could be enhanced with AI prediction
      timeline: fullTimeline,
      lastCarrierScan,
      shipmentInfo: {
        shipmentId: shipment.shipment_id,
        shipDate: shipment.event_labeled,
        firstScanDate,
        origin: shipment.origin_country,
        destination,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Tracking Timeline] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tracking timeline' },
      { status: 500 }
    )
  }
}
