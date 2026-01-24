/**
 * Claim Eligibility Logic
 *
 * Determines whether a shipment is eligible for each claim type:
 * - Lost in Transit: 15 days inactivity (domestic) or 20 days (international)
 * - Damage: Package must be delivered
 * - Incorrect Items (Pick Error): Package must be delivered
 * - Incorrect Quantity (Short Ship): Package must be delivered
 */

export type ClaimType = 'lostInTransit' | 'damage' | 'incorrectItems' | 'incorrectQuantity'

export interface ClaimEligibility {
  eligible: boolean
  reason?: string
  // For Lost in Transit: indicates this needs AfterShip verification when clicked
  requiresVerification?: boolean
}

export interface ClaimEligibilityResult {
  shipmentId: string
  isDelivered: boolean
  lastTrackingUpdate: string | null
  daysSinceLastUpdate: number | null
  isInternational: boolean
  eligibility: {
    lostInTransit: ClaimEligibility
    damage: ClaimEligibility
    incorrectItems: ClaimEligibility
    incorrectQuantity: ClaimEligibility
  }
}

export interface ShipmentData {
  shipment_id: string
  origin_country: string | null
  destination_country: string | null
  event_delivered: string | null
  event_intransit: string | null
  event_outfordelivery: string | null
  event_logs: EventLog[] | null
  // Label date used for pre-filter (shipment must be at least 15 days old to potentially qualify)
  event_labeled: string | null
}

interface EventLog {
  log_type_id: number
  timestamp: string  // Field name from ShipBob API stored in event_logs JSONB
  [key: string]: unknown
}

// Carrier-related event log type IDs from ShipBob
// These represent the last known carrier activity
const CARRIER_EVENT_LOG_TYPE_IDS = [
  606,  // PreTransit - "Received By Carrier"
  607,  // InTransit - "In Transit"
  608,  // OutForDelivery - "Out For Delivery"
  609,  // Delivered - "Delivered"
  611,  // DeliveryAttemptFailed - "Delivery Attempt Failed"
  107,  // ShipmentPickedupByCarrier - "Order picked up by carrier"
]

// Eligibility thresholds (days since last tracking update)
const LOST_IN_TRANSIT_DOMESTIC_DAYS = 15
const LOST_IN_TRANSIT_INTERNATIONAL_DAYS = 20

/**
 * Calculate claim eligibility for a shipment
 */
export function calculateEligibility(shipment: ShipmentData): ClaimEligibilityResult {
  const isDelivered = !!shipment.event_delivered
  const isInternational = shipment.origin_country !== shipment.destination_country

  // Find the most recent tracking event
  const lastTrackingUpdate = getLastTrackingUpdate(shipment)
  const daysSinceLastUpdate = lastTrackingUpdate
    ? getDaysSince(lastTrackingUpdate)
    : null

  // Calculate days since label was created (for pre-filter)
  const daysSinceLabeled = shipment.event_labeled
    ? getDaysSince(shipment.event_labeled)
    : null

  // Calculate eligibility for each claim type
  const eligibility = {
    lostInTransit: calculateLostInTransitEligibility(
      isDelivered,
      isInternational,
      daysSinceLastUpdate,
      daysSinceLabeled
    ),
    damage: calculateDeliveryRequiredEligibility(isDelivered, 'Damage'),
    incorrectItems: calculateDeliveryRequiredEligibility(isDelivered, 'Incorrect Items'),
    incorrectQuantity: calculateDeliveryRequiredEligibility(isDelivered, 'Incorrect Quantity'),
  }

  return {
    shipmentId: shipment.shipment_id,
    isDelivered,
    lastTrackingUpdate,
    daysSinceLastUpdate,
    isInternational,
    eligibility,
  }
}

/**
 * Get the most recent tracking update timestamp
 * Priority: event_logs → event_outfordelivery → event_intransit
 */
function getLastTrackingUpdate(shipment: ShipmentData): string | null {
  // First, check event_logs for carrier-related events
  if (shipment.event_logs && Array.isArray(shipment.event_logs)) {
    const carrierEvents = shipment.event_logs
      .filter(log => CARRIER_EVENT_LOG_TYPE_IDS.includes(log.log_type_id))
      .sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )

    if (carrierEvents.length > 0) {
      return carrierEvents[0].timestamp
    }
  }

  // Fallback to event columns (most recent first)
  if (shipment.event_outfordelivery) {
    return shipment.event_outfordelivery
  }
  if (shipment.event_intransit) {
    return shipment.event_intransit
  }

  return null
}

/**
 * Calculate days since a given date
 */
function getDaysSince(dateString: string): number {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Calculate Lost in Transit eligibility (Phase 1 - Pre-filter)
 *
 * Pre-filter logic: Use the label date as a simple gate. If the shipment
 * isn't at least N days old (15 domestic, 20 international), it can't
 * possibly meet the inactivity requirement, so we don't show it as clickable.
 *
 * If the shipment IS old enough from labeling, we show it as clickable
 * but require AfterShip verification to confirm actual carrier inactivity.
 */
function calculateLostInTransitEligibility(
  isDelivered: boolean,
  isInternational: boolean,
  daysSinceLastUpdate: number | null,
  daysSinceLabeled: number | null
): ClaimEligibility {
  // If delivered, not eligible for Lost in Transit
  if (isDelivered) {
    return {
      eligible: false,
      reason: 'Package has been delivered. Lost in Transit claims are not applicable.',
    }
  }

  const requiredDays = isInternational
    ? LOST_IN_TRANSIT_INTERNATIONAL_DAYS
    : LOST_IN_TRANSIT_DOMESTIC_DAYS

  // Pre-filter: Use label date as the gate
  // If the shipment isn't old enough from labeling, it can't qualify
  if (daysSinceLabeled === null) {
    return {
      eligible: false,
      reason: 'No label date available to determine eligibility.',
    }
  }

  // Use the actual threshold for the shipment type (15 domestic, 20 international)
  // No point calling AfterShip if the shipment isn't even old enough
  if (daysSinceLabeled < requiredDays) {
    const daysRemaining = requiredDays - daysSinceLabeled
    const shipmentType = isInternational ? 'international' : 'domestic'

    return {
      eligible: false,
      reason: `Lost in Transit claims for ${shipmentType} shipments require ${requiredDays} days of carrier inactivity. This shipment was labeled ${daysSinceLabeled} day${daysSinceLabeled === 1 ? '' : 's'} ago. Please check back in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`,
    }
  }

  // Shipment is old enough (15+ days from labeling) - show as clickable
  // but require AfterShip verification to confirm actual carrier inactivity
  return {
    eligible: true,
    requiresVerification: true, // Needs AfterShip check when clicked
  }
}

/**
 * Calculate eligibility for claim types that require delivery
 */
function calculateDeliveryRequiredEligibility(
  isDelivered: boolean,
  claimTypeName: string
): ClaimEligibility {
  if (isDelivered) {
    return { eligible: true }
  }

  return {
    eligible: false,
    reason: `${claimTypeName} claims can only be submitted after the package has been delivered.`,
  }
}

/**
 * Map UI claim type to database issue_type
 */
export function claimTypeToIssueType(claimType: ClaimType): string {
  const mapping: Record<ClaimType, string> = {
    lostInTransit: 'Loss',
    damage: 'Damage',
    incorrectItems: 'Pick Error',
    incorrectQuantity: 'Short Ship',
  }
  return mapping[claimType]
}

/**
 * Map database issue_type to UI claim type
 */
export function issueTypeToClaimType(issueType: string): ClaimType | null {
  const mapping: Record<string, ClaimType> = {
    'Loss': 'lostInTransit',
    'Damage': 'damage',
    'Pick Error': 'incorrectItems',
    'Short Ship': 'incorrectQuantity',
  }
  return mapping[issueType] || null
}

/**
 * Get UI display label for a claim type
 */
export function getClaimTypeLabel(claimType: ClaimType): string {
  const labels: Record<ClaimType, string> = {
    lostInTransit: 'Lost in Transit',
    damage: 'Damage',
    incorrectItems: 'Incorrect Items',
    incorrectQuantity: 'Incorrect Quantity',
  }
  return labels[claimType]
}
