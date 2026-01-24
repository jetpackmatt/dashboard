/**
 * AfterShip API Client
 *
 * Used for verifying Lost in Transit claim eligibility by checking
 * actual carrier tracking data.
 *
 * API Docs: https://www.aftership.com/docs/tracking/api/overview
 */

const AFTERSHIP_API_BASE = 'https://api.aftership.com/v4'

export interface AfterShipCheckpoint {
  slug: string
  city: string | null
  created_at: string
  location: string | null
  country_name: string | null
  message: string
  country_iso3: string | null
  tag: string
  subtag: string
  subtag_message: string
  checkpoint_time: string
  coordinates: number[] | null
  state: string | null
  zip: string | null
  raw_tag: string
}

export interface AfterShipTracking {
  id: string
  created_at: string
  updated_at: string
  last_updated_at: string
  tracking_number: string
  slug: string
  active: boolean
  android: string[]
  ios: string[]
  emails: string[]
  smses: string[]
  subscribed_smses: string[]
  subscribed_emails: string[]
  custom_fields: Record<string, unknown>
  customer_name: string | null
  delivery_time: number | null
  destination_country_iso3: string | null
  destination_raw_location: string | null
  destination_city: string | null
  destination_state: string | null
  destination_postal_code: string | null
  courier_destination_country_iso3: string | null
  courier_tracking_link: string | null
  first_attempted_at: string | null
  origin_country_iso3: string | null
  origin_raw_location: string | null
  origin_city: string | null
  origin_state: string | null
  origin_postal_code: string | null
  shipment_package_count: number
  shipment_pickup_date: string | null
  shipment_delivery_date: string | null
  shipment_type: string | null
  shipment_weight: number | null
  shipment_weight_unit: string | null
  signed_by: string | null
  source: string
  tag: string
  subtag: string
  subtag_message: string
  title: string
  tracked_count: number
  unique_token: string
  checkpoints: AfterShipCheckpoint[]
  expected_delivery: string | null
  order_id: string | null
  order_id_path: string | null
  order_date: string | null
  note: string | null
  order_number: string | null
  shipment_tags: string[]
  latest_estimated_delivery: {
    type: string
    source: string
    datetime: string | null
    datetime_min: string | null
    datetime_max: string | null
  } | null
  first_estimated_delivery: {
    type: string
    source: string
    datetime: string | null
    datetime_min: string | null
    datetime_max: string | null
  } | null
}

interface AfterShipResponse<T> {
  meta: {
    code: number
    message?: string
    type?: string
  }
  data: T
}

export interface TrackingResult {
  success: boolean
  tracking?: AfterShipTracking
  lastCheckpoint?: AfterShipCheckpoint
  error?: string
}

/**
 * Map common carrier names to AfterShip slug
 */
export function getAfterShipSlug(carrier: string): string | null {
  const carrierLower = (carrier || '').toLowerCase()

  // Common carrier mappings
  if (carrierLower.includes('usps')) return 'usps'
  if (carrierLower.includes('ups')) return 'ups'
  if (carrierLower.includes('fedex')) return 'fedex'
  if (carrierLower.includes('dhl')) {
    if (carrierLower.includes('express')) return 'dhl'
    if (carrierLower.includes('ecommerce')) return 'dhl-ecommerce'
    return 'dhl'
  }
  if (carrierLower.includes('ontrac')) return 'ontrac'
  if (carrierLower.includes('amazon')) return 'amazon-shipping'
  if (carrierLower.includes('veho')) return 'veho'
  if (carrierLower.includes('lasership')) return 'lasership'
  if (carrierLower.includes('spee-dee') || carrierLower.includes('speedee')) return 'speedee'

  return null
}

/**
 * Detect carrier from tracking number format (fallback)
 */
export function detectCarrierFromTracking(trackingNumber: string): string | null {
  if (!trackingNumber) return null
  const tracking = trackingNumber.trim().toUpperCase()

  // UPS: Starts with "1Z" followed by 16 alphanumeric characters
  if (tracking.startsWith('1Z') && tracking.length === 18) return 'ups'

  // FedEx: 12, 15, 20, or 22 digits
  if (/^\d{12}$/.test(tracking) || /^\d{15}$/.test(tracking) ||
      /^\d{20}$/.test(tracking) || /^\d{22}$/.test(tracking)) return 'fedex'

  // USPS: 20-22 digits, or specific formats
  if (/^(94|93|92|91|70|01|02)\d{18,20}$/.test(tracking)) return 'usps'
  if (/^\d{20,22}$/.test(tracking)) return 'usps'

  // DHL: 10 digits
  if (/^\d{10}$/.test(tracking)) return 'dhl'

  // OnTrac: Starts with C or D, 14-15 characters
  if (/^[CD]\d{13,14}$/.test(tracking)) return 'ontrac'

  return null
}

/**
 * Get tracking information from AfterShip
 */
export async function getTracking(
  trackingNumber: string,
  carrier?: string
): Promise<TrackingResult> {
  const apiKey = process.env.AFTERSHIP_API_KEY

  if (!apiKey) {
    console.error('[AfterShip] API key not configured')
    return { success: false, error: 'AfterShip API key not configured' }
  }

  // Determine carrier slug
  let slug = carrier ? getAfterShipSlug(carrier) : null
  if (!slug) {
    slug = detectCarrierFromTracking(trackingNumber)
  }

  if (!slug) {
    return { success: false, error: 'Unable to determine carrier for tracking number' }
  }

  try {
    // Try to get existing tracking first
    const getResponse = await fetch(
      `${AFTERSHIP_API_BASE}/trackings/${slug}/${trackingNumber}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'aftership-api-key': apiKey,
        },
      }
    )

    if (getResponse.ok) {
      const data: AfterShipResponse<{ tracking: AfterShipTracking }> = await getResponse.json()

      if (data.meta.code === 200 && data.data.tracking) {
        const tracking = data.data.tracking
        const lastCheckpoint = tracking.checkpoints && tracking.checkpoints.length > 0
          ? tracking.checkpoints[0] // AfterShip returns checkpoints in reverse chronological order
          : undefined

        return { success: true, tracking, lastCheckpoint }
      }
    }

    // If tracking doesn't exist (404), create it and fetch
    if (getResponse.status === 404) {
      // Create the tracking
      const createResponse = await fetch(`${AFTERSHIP_API_BASE}/trackings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'aftership-api-key': apiKey,
        },
        body: JSON.stringify({
          tracking: {
            slug,
            tracking_number: trackingNumber,
          },
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        console.error('[AfterShip] Failed to create tracking:', errorData)
        return { success: false, error: errorData.meta?.message || 'Failed to create tracking' }
      }

      const createData: AfterShipResponse<{ tracking: AfterShipTracking }> = await createResponse.json()

      if (createData.meta.code === 201 || createData.meta.code === 200) {
        const tracking = createData.data.tracking
        const lastCheckpoint = tracking.checkpoints && tracking.checkpoints.length > 0
          ? tracking.checkpoints[0]
          : undefined

        return { success: true, tracking, lastCheckpoint }
      }

      return { success: false, error: createData.meta.message || 'Unknown error creating tracking' }
    }

    // Other error
    const errorData = await getResponse.json()
    console.error('[AfterShip] API error:', errorData)
    return { success: false, error: errorData.meta?.message || 'AfterShip API error' }

  } catch (error) {
    console.error('[AfterShip] Request failed:', error)
    return { success: false, error: 'Failed to connect to AfterShip' }
  }
}

/**
 * Check if a tracking shows the package as delivered
 */
export function isDelivered(tracking: AfterShipTracking): boolean {
  return tracking.tag === 'Delivered'
}

/**
 * Get the last checkpoint date as a Date object
 */
export function getLastCheckpointDate(tracking: AfterShipTracking): Date | null {
  if (!tracking.checkpoints || tracking.checkpoints.length === 0) {
    return null
  }

  // AfterShip checkpoints are in reverse chronological order (newest first)
  const lastCheckpoint = tracking.checkpoints[0]
  return new Date(lastCheckpoint.checkpoint_time)
}

/**
 * Calculate days since last checkpoint
 */
export function daysSinceLastCheckpoint(tracking: AfterShipTracking): number | null {
  const lastDate = getLastCheckpointDate(tracking)
  if (!lastDate) return null

  const now = new Date()
  const diffMs = now.getTime() - lastDate.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}
