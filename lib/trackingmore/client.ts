/**
 * TrackingMore API Client
 *
 * Used for verifying Lost in Transit claim eligibility by checking
 * actual carrier tracking data.
 *
 * API Docs: https://www.trackingmore.com/docs/trackingmore/d5ac362fc3cda-api-quick-start
 *
 * Cost comparison vs AfterShip:
 * - TrackingMore: $0.04/tracking (Pro plan $74/mo)
 * - AfterShip: $0.08/tracking (Pro plan $119/mo)
 */

const TRACKINGMORE_API_BASE = 'https://api.trackingmore.com/v4'

// Timeout for TrackingMore API calls (30 seconds - realtime endpoint can be slow)
const API_TIMEOUT_MS = 30000

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

export interface TrackingMoreCheckpoint {
  // TrackingMore v4 API field names
  checkpoint_date: string
  tracking_detail: string
  checkpoint_delivery_status: string
  checkpoint_delivery_substatus: string
  location: string | null
  city: string | null
  state: string | null
  country_iso2: string | null
  zip: string | null
  raw_status: string | null
}

export interface TrackingMoreTracking {
  id: string
  tracking_number: string
  carrier_code: string
  status: string // "pending", "notfound", "transit", "pickup", "delivered", "expired", "undelivered", "exception", "inforeceived"
  created_at: string
  updated_at: string
  original_country: string | null
  destination_country: string | null
  origin_info: {
    trackinfo: TrackingMoreCheckpoint[]
  } | null
  destination_info: {
    trackinfo: TrackingMoreCheckpoint[]
  } | null
  latest_event: string | null
  latest_checkpoint_time: string | null
}

interface TrackingMoreResponse<T> {
  meta: {
    code: number
    type: string
    message: string
  }
  data: T
}

export interface TrackingResult {
  success: boolean
  tracking?: TrackingMoreTracking
  lastCheckpoint?: {
    date: Date
    message: string
    location: string | null
  }
  error?: string
}

/**
 * Map common carrier names to TrackingMore carrier codes
 * See: https://www.trackingmore.com/docs/trackingmore/wgwsg4rjvvheh-carrier-code
 */
export function getTrackingMoreCarrierCode(carrier: string): string | null {
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
  if (carrierLower.includes('amazon')) return 'amazon-us'
  if (carrierLower.includes('veho')) return 'veho'
  if (carrierLower.includes('lasership')) return 'lasership'
  if (carrierLower.includes('spee-dee') || carrierLower.includes('speedee')) return 'speedee'
  // Cirro eCommerce (also known as GOFO) - use 'gofoexpress' as carrier code
  if (carrierLower.includes('cirro') || carrierLower.includes('gofo')) return 'gofoexpress'
  // BetterTrucks - Regional last-mile carrier
  if (carrierLower.includes('bettertrucks') || carrierLower.includes('better trucks')) return 'bettertrucks'
  // OSM Worldwide - Parcel consolidator (hands off to USPS for final delivery)
  // TrackingMore supports OSM tracking
  if (carrierLower.includes('osm')) return 'osmworldwide'
  // UniUni - Canadian regional carrier
  if (carrierLower.includes('uniuni')) return 'uniuni'
  // Passport - International shipping
  if (carrierLower.includes('passport')) return 'passport'
  // APC Postal Logistics
  if (carrierLower.includes('apc')) return 'apc'
  // UPS Mail Innovations - uses USPS for final delivery
  if (carrierLower.includes('upsmi') || carrierLower.includes('mail innovations')) return 'ups-mi'
  // FedEx SmartPost - uses USPS for final delivery
  if (carrierLower.includes('smartpost')) return 'fedex'

  // Carriers with no TrackingMore support - return null to skip
  // ShipBob internal, PrePaid, DE_KITTING - these are internal/freight and have no tracking
  if (carrierLower.includes('shipbob') || carrierLower.includes('prepaid') || carrierLower.includes('kitting')) {
    return null
  }

  return null
}

/**
 * Detect carrier from tracking number format (fallback)
 * IMPORTANT: Order matters! More specific patterns must come before generic ones.
 */
export function detectCarrierFromTracking(trackingNumber: string): string | null {
  if (!trackingNumber) return null
  const tracking = trackingNumber.trim().toUpperCase()

  // UPS: Starts with "1Z" followed by 16 alphanumeric characters
  if (tracking.startsWith('1Z') && tracking.length === 18) return 'ups'

  // USPS: Check FIRST before FedEx since both can be 20-22 digits
  // USPS tracking numbers starting with specific prefixes (92, 93, 94, etc.)
  if (/^(94|93|92|91|70|01|02)\d{18,20}$/.test(tracking)) return 'usps'

  // FedEx: 12, 15, 20, or 22 digits (but NOT if it starts with USPS prefixes)
  // FedEx 20-digit numbers typically start with 7 or 96
  if (/^\d{12}$/.test(tracking)) return 'fedex'
  if (/^\d{15}$/.test(tracking)) return 'fedex'
  if (/^(7|96)\d{19,21}$/.test(tracking)) return 'fedex' // FedEx 20-22 digits

  // USPS fallback: Generic 20-22 digit numbers (after FedEx-specific patterns)
  if (/^\d{20,22}$/.test(tracking)) return 'usps'

  // DHL: 10 digits
  if (/^\d{10}$/.test(tracking)) return 'dhl'

  // OnTrac: Starts with C or D, 14-15 characters
  if (/^[CD]\d{13,14}$/.test(tracking)) return 'ontrac'

  return null
}

/**
 * Parse location string from TrackingMore checkpoint
 * TrackingMore returns location as a string like "Paramount, CA, US"
 */
function parseLocation(details: string | null): { city: string | null; state: string | null; country: string | null } {
  if (!details) return { city: null, state: null, country: null }

  const parts = details.split(',').map(p => p.trim())

  if (parts.length >= 3) {
    return { city: parts[0], state: parts[1], country: parts[2] }
  } else if (parts.length === 2) {
    return { city: parts[0], state: null, country: parts[1] }
  } else if (parts.length === 1) {
    return { city: parts[0], state: null, country: null }
  }

  return { city: null, state: null, country: null }
}

/**
 * Get tracking information from TrackingMore
 */
export async function getTracking(
  trackingNumber: string,
  carrier?: string
): Promise<TrackingResult> {
  const apiKey = process.env.TRACKINGMORE_API_KEY

  if (!apiKey) {
    console.error('[TrackingMore] API key not configured')
    return { success: false, error: 'TrackingMore API key not configured' }
  }

  // Determine carrier code
  let carrierCode = carrier ? getTrackingMoreCarrierCode(carrier) : null
  if (!carrierCode) {
    carrierCode = detectCarrierFromTracking(trackingNumber)
  }

  if (!carrierCode) {
    return { success: false, error: 'Unable to determine carrier for tracking number' }
  }

  console.log('[TrackingMore] Looking up tracking:', trackingNumber, 'carrier:', carrierCode)

  try {
    // V4 API: Use /trackings/get with query parameters to retrieve existing tracking
    const getParams = new URLSearchParams({
      tracking_numbers: trackingNumber,
      courier_code: carrierCode,
    })

    const getResponse = await fetchWithTimeout(
      `${TRACKINGMORE_API_BASE}/trackings/get?${getParams.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Tracking-Api-Key': apiKey,
        },
      }
    )

    const getResponseText = await getResponse.text()
    let getData: TrackingMoreResponse<TrackingMoreTracking[]> | null = null
    try {
      getData = JSON.parse(getResponseText)
    } catch {
      console.error('[TrackingMore] Failed to parse GET response:', getResponseText.substring(0, 200))
    }

    console.log('[TrackingMore] GET response status:', getResponse.status, 'code:', getData?.meta?.code, 'data length:', getData?.data?.length)

    // V4 returns an array of trackings
    if (getResponse.ok && getData?.meta?.code === 200 && getData?.data && getData.data.length > 0) {
      return processTrackingResponse(getData.data[0])
    }

    // If tracking doesn't exist, create it using the realtime endpoint
    // TrackingMore API V4: "create a tracking" is also "create & get" (real-time API)
    console.log('[TrackingMore] No existing tracking found, using realtime endpoint for:', trackingNumber, 'carrier:', carrierCode)

    // Use the realtime endpoint to get tracking data immediately
    // This fetches from the carrier in real-time rather than waiting for async updates
    const realtimeResponse = await fetchWithTimeout(`${TRACKINGMORE_API_BASE}/trackings/realtime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Tracking-Api-Key': apiKey,
      },
      body: JSON.stringify({
        tracking_number: trackingNumber,
        courier_code: carrierCode,
      }),
    })

    const realtimeData: TrackingMoreResponse<TrackingMoreTracking> = await realtimeResponse.json()
    console.log('[TrackingMore] Realtime response code:', realtimeData.meta?.code, 'message:', realtimeData.meta?.message)

    // TrackingMore returns HTTP 200 even for errors, so check meta.code
    if (realtimeData.meta.code === 200 || realtimeData.meta.code === 201) {
      return processTrackingResponse(realtimeData.data)
    }

    // If realtime fails because tracking already exists, check if it was registered with wrong carrier
    if (realtimeData.meta?.code === 4016 || realtimeData.meta?.code === 4101) {
      // Check if the existing tracking has a different carrier code
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingData = (realtimeData as any).data as { id: string; tracking_number: string; courier_code: string } | undefined
      if (existingData?.courier_code && existingData.courier_code !== carrierCode) {
        console.log('[TrackingMore] Tracking exists with wrong carrier:', existingData.courier_code, '- deleting and recreating with:', carrierCode)
        // Delete the tracking with wrong carrier
        await deleteTrackingById(existingData.id, apiKey)
        // Try creating again with correct carrier
        const retryResponse = await fetchWithTimeout(`${TRACKINGMORE_API_BASE}/trackings/realtime`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Tracking-Api-Key': apiKey,
          },
          body: JSON.stringify({
            tracking_number: trackingNumber,
            courier_code: carrierCode,
          }),
        })
        const retryData: TrackingMoreResponse<TrackingMoreTracking> = await retryResponse.json()
        console.log('[TrackingMore] Retry realtime response code:', retryData.meta?.code)
        if (retryData.meta.code === 200 || retryData.meta.code === 201) {
          return processTrackingResponse(retryData.data)
        }
      }
      // Tracking exists with same carrier, fetch it using the ID
      console.log('[TrackingMore] Tracking already exists, fetching by ID:', existingData?.id)
      if (existingData?.id) {
        return await getTrackingById(existingData.id, apiKey)
      }
    }

    // Try regular create as fallback
    console.log('[TrackingMore] Realtime failed, trying regular create')
    const createResponse = await fetchWithTimeout(`${TRACKINGMORE_API_BASE}/trackings/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Tracking-Api-Key': apiKey,
      },
      body: JSON.stringify({
        tracking_number: trackingNumber,
        courier_code: carrierCode,
      }),
    })

    const createData: TrackingMoreResponse<TrackingMoreTracking> = await createResponse.json()
    console.log('[TrackingMore] Create response code:', createData.meta?.code, 'message:', createData.meta?.message)

    // TrackingMore returns HTTP 200 even for errors, so check meta.code
    if (createData.meta.code === 200 || createData.meta.code === 201) {
      return processTrackingResponse(createData.data)
    }

    // If tracking already exists (4016 or 4101), check carrier and get it
    if (createData.meta?.code === 4016 || createData.meta?.code === 4101) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingData = (createData as any).data as { id: string; tracking_number: string; courier_code: string } | undefined
      if (existingData?.courier_code && existingData.courier_code !== carrierCode) {
        console.log('[TrackingMore] Tracking exists with wrong carrier:', existingData.courier_code, '- deleting and recreating with:', carrierCode)
        await deleteTrackingById(existingData.id, apiKey)
        // Retry create
        const retryResponse = await fetchWithTimeout(`${TRACKINGMORE_API_BASE}/trackings/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Tracking-Api-Key': apiKey,
          },
          body: JSON.stringify({
            tracking_number: trackingNumber,
            courier_code: carrierCode,
          }),
        })
        const retryData: TrackingMoreResponse<TrackingMoreTracking> = await retryResponse.json()
        console.log('[TrackingMore] Retry create response code:', retryData.meta?.code)
        if (retryData.meta.code === 200 || retryData.meta.code === 201) {
          return processTrackingResponse(retryData.data)
        }
      }
      // Fetch by ID if we have it
      if (existingData?.id) {
        console.log('[TrackingMore] Fetching tracking by ID:', existingData.id)
        return await getTrackingById(existingData.id, apiKey)
      }
    }

    console.error('[TrackingMore] Failed to create tracking:', createData)
    return { success: false, error: createData.meta?.message || 'Failed to create tracking' }

  } catch (error) {
    // Check if this was a timeout (AbortError)
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[TrackingMore] Request timed out for:', trackingNumber)
      return { success: false, error: 'Carrier lookup timed out. The carrier may be slow to respond - please try again.' }
    }
    console.error('[TrackingMore] Request failed:', error)
    return { success: false, error: 'Failed to connect to TrackingMore' }
  }
}

/**
 * Delete a tracking by its internal TrackingMore ID
 */
async function deleteTrackingById(id: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `${TRACKINGMORE_API_BASE}/trackings/delete/${id}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Tracking-Api-Key': apiKey,
        },
      },
      15000 // 15 second timeout for delete
    )
    const data = await response.json()
    console.log('[TrackingMore] Delete by ID response:', data.meta?.code, data.meta?.message)
    return data.meta?.code === 200
  } catch (error) {
    console.error('[TrackingMore] Delete by ID failed:', error)
    return false
  }
}

/**
 * Get tracking by its internal TrackingMore ID
 */
async function getTrackingById(id: string, apiKey: string): Promise<TrackingResult> {
  try {
    // V4 API doesn't have a direct "get by ID" - use the batch get endpoint
    // Actually, we can use /trackings/get and filter by created_at or just get all recent ones
    // For now, let's return what we have from the create response
    console.log('[TrackingMore] Note: V4 API requires create to get tracking data, ID fetch not directly supported')
    return {
      success: false,
      error: 'Tracking exists but cannot be retrieved. Please try again.',
    }
  } catch (error) {
    console.error('[TrackingMore] Get by ID failed:', error)
    return { success: false, error: 'Failed to get tracking by ID' }
  }
}

/**
 * Get existing tracking by tracking number
 * Uses V4 /trackings/get endpoint with query parameters
 * Tries the provided carrier first, then tries common alternatives
 */
async function getExistingTracking(
  trackingNumber: string,
  carrierCode: string,
  apiKey: string
): Promise<TrackingResult> {
  // List of carriers to try (provided carrier first, then common alternatives)
  const carriersToTry = [carrierCode]

  // Add common alternative carriers
  const commonCarriers = ['usps', 'fedex', 'ups', 'dhl', 'ontrac']
  for (const carrier of commonCarriers) {
    if (!carriersToTry.includes(carrier)) {
      carriersToTry.push(carrier)
    }
  }

  for (const carrier of carriersToTry) {
    try {
      console.log('[TrackingMore] Trying to GET tracking with carrier:', carrier)

      // V4 API: Use /trackings/get with query parameters
      const params = new URLSearchParams({
        tracking_numbers: trackingNumber,
        courier_code: carrier,
      })

      const response = await fetchWithTimeout(
        `${TRACKINGMORE_API_BASE}/trackings/get?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Tracking-Api-Key': apiKey,
          },
        },
        15000 // 15 second timeout per carrier attempt
      )

      const data: TrackingMoreResponse<TrackingMoreTracking[]> = await response.json()
      console.log('[TrackingMore] GET response for carrier', carrier, '- code:', data.meta?.code, 'data length:', data.data?.length)

      // V4 returns an array of trackings
      if (data.meta?.code === 200 && data.data && data.data.length > 0) {
        console.log('[TrackingMore] Found tracking with carrier:', carrier)
        return processTrackingResponse(data.data[0])
      }
    } catch (err) {
      // Continue to next carrier on timeout or error
      console.error('[TrackingMore] Error trying carrier', carrier, ':', err)
    }
  }

  // None of the carriers worked
  console.error('[TrackingMore] Could not find tracking with any carrier')
  return {
    success: false,
    error: 'Unable to retrieve tracking information. The tracking may have been registered incorrectly.',
  }
}

/**
 * Build location string from checkpoint data
 */
function buildLocationString(checkpoint: TrackingMoreCheckpoint): string | null {
  // First check if location is directly provided
  if (checkpoint.location) return checkpoint.location

  // Build from city, state, country
  const parts: string[] = []
  if (checkpoint.city) parts.push(checkpoint.city)
  if (checkpoint.state) parts.push(checkpoint.state)
  if (checkpoint.country_iso2) parts.push(checkpoint.country_iso2)

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Process tracking response and extract last checkpoint
 */
function processTrackingResponse(tracking: TrackingMoreTracking): TrackingResult {
  // Get all checkpoints from origin and destination info
  const checkpoints: TrackingMoreCheckpoint[] = []

  if (tracking.origin_info?.trackinfo) {
    checkpoints.push(...tracking.origin_info.trackinfo)
  }
  if (tracking.destination_info?.trackinfo) {
    checkpoints.push(...tracking.destination_info.trackinfo)
  }

  // Sort by checkpoint_date descending to get most recent first
  checkpoints.sort((a, b) =>
    new Date(b.checkpoint_date).getTime() - new Date(a.checkpoint_date).getTime()
  )

  const lastCheckpoint = checkpoints.length > 0 ? checkpoints[0] : null

  return {
    success: true,
    tracking,
    lastCheckpoint: lastCheckpoint ? {
      date: new Date(lastCheckpoint.checkpoint_date),
      message: lastCheckpoint.tracking_detail,
      location: buildLocationString(lastCheckpoint),
    } : undefined,
  }
}

/**
 * Check if a tracking shows the package as delivered
 * Checks both the status field AND the latest event description
 * (TrackingMore sometimes doesn't set status='delivered' immediately after create)
 */
export function isDelivered(tracking: TrackingMoreTracking): boolean {
  // Check official status field
  if (tracking.status === 'delivered') return true

  // Also check latest_event for delivery keywords
  // This catches cases where status isn't updated but checkpoint shows delivered
  const latestEvent = (tracking.latest_event || '').toLowerCase()
  if (latestEvent.includes('delivered') && !latestEvent.includes('undelivered')) {
    return true
  }
  // DHL third-party delivery pattern (handed off to local delivery service)
  if (latestEvent.includes('delivery has been arranged')) {
    return true
  }

  // Check checkpoints for delivery status
  const checkpoints = [
    ...(tracking.origin_info?.trackinfo || []),
    ...(tracking.destination_info?.trackinfo || []),
  ]

  for (const checkpoint of checkpoints) {
    const status = (checkpoint.checkpoint_delivery_status || '').toLowerCase()
    const detail = (checkpoint.tracking_detail || '').toLowerCase()

    if (status === 'delivered') return true
    if (detail.includes('delivered') && !detail.includes('undelivered')) return true
    // DHL third-party delivery pattern
    if (detail.includes('delivery has been arranged')) return true
  }

  return false
}

/**
 * Check if a tracking shows the package was returned to sender
 * Returned packages are NOT lost in transit - they were sent back
 */
export function isReturned(tracking: TrackingMoreTracking): boolean {
  // Check latest_event for return keywords
  const latestEvent = (tracking.latest_event || '').toLowerCase()
  if (latestEvent.includes('returned') || latestEvent.includes('return to sender')) {
    return true
  }

  // Check checkpoints for return status
  const checkpoints = [
    ...(tracking.origin_info?.trackinfo || []),
    ...(tracking.destination_info?.trackinfo || []),
  ]

  for (const checkpoint of checkpoints) {
    const detail = (checkpoint.tracking_detail || '').toLowerCase()
    if (detail.includes('returned') || detail.includes('return to sender')) {
      return true
    }
  }

  return false
}

/**
 * Get the last checkpoint date as a Date object
 */
export function getLastCheckpointDate(tracking: TrackingMoreTracking): Date | null {
  // First check latest_checkpoint_time field
  if (tracking.latest_checkpoint_time) {
    return new Date(tracking.latest_checkpoint_time)
  }

  // Fallback to parsing checkpoints
  const checkpoints: TrackingMoreCheckpoint[] = []

  if (tracking.origin_info?.trackinfo) {
    checkpoints.push(...tracking.origin_info.trackinfo)
  }
  if (tracking.destination_info?.trackinfo) {
    checkpoints.push(...tracking.destination_info.trackinfo)
  }

  if (checkpoints.length === 0) {
    return null
  }

  // Sort by checkpoint_date descending
  checkpoints.sort((a, b) =>
    new Date(b.checkpoint_date).getTime() - new Date(a.checkpoint_date).getTime()
  )

  return new Date(checkpoints[0].checkpoint_date)
}

/**
 * Calculate days since last checkpoint
 */
export function daysSinceLastCheckpoint(tracking: TrackingMoreTracking): number | null {
  const lastDate = getLastCheckpointDate(tracking)
  if (!lastDate) return null

  const now = new Date()
  const diffMs = now.getTime() - lastDate.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Delete a tracking from TrackingMore
 * Used when a tracking was created with the wrong carrier
 */
export async function deleteTracking(
  trackingNumber: string,
  carrierCode: string
): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.TRACKINGMORE_API_KEY

  if (!apiKey) {
    return { success: false, error: 'TrackingMore API key not configured' }
  }

  try {
    const response = await fetchWithTimeout(
      `${TRACKINGMORE_API_BASE}/trackings/${carrierCode}/${trackingNumber}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Tracking-Api-Key': apiKey,
        },
      },
      15000 // 15 second timeout
    )

    const data = await response.json()
    console.log('[TrackingMore] Delete response:', data.meta)

    if (data.meta?.code === 200) {
      return { success: true }
    }

    return { success: false, error: data.meta?.message || 'Failed to delete tracking' }
  } catch (error) {
    console.error('[TrackingMore] Delete failed:', error)
    return { success: false, error: 'Failed to delete tracking' }
  }
}
