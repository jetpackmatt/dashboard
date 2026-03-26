/**
 * AI-Powered Checkpoint Normalization
 *
 * Uses Gemini to normalize raw carrier scan descriptions into standard types.
 * Results are cached permanently in tracking_checkpoints table.
 *
 * 12 Normalized Types:
 * - LABEL: Label created
 * - PICKUP: Carrier picked up
 * - INTRANSIT: Moving between facilities
 * - HUB: Arrived at sorting/distribution facility
 * - LOCAL: At local delivery facility
 * - OFD: Out for delivery
 * - DELIVERED: Delivered
 * - ATTEMPT: Delivery attempt failed
 * - EXCEPTION: Problem occurred
 * - RETURN: Being returned
 * - CUSTOMS: International customs
 * - HOLD: Held for pickup/action
 */

import { geminiModel } from './client'
import type { StoredCheckpoint } from '@/lib/trackingmore/checkpoint-storage'
import { batchUpdateNormalization } from '@/lib/trackingmore/checkpoint-storage'

export type NormalizedCheckpointType =
  | 'LABEL'
  | 'PICKUP'
  | 'INTRANSIT'
  | 'HUB'
  | 'LOCAL'
  | 'OFD'
  | 'DELIVERED'
  | 'ATTEMPT'
  | 'EXCEPTION'
  | 'RETURN'
  | 'CUSTOMS'
  | 'HOLD'

export type CheckpointSentiment = 'positive' | 'neutral' | 'concerning' | 'critical'

export interface NormalizedCheckpoint {
  id: string
  normalized_type: NormalizedCheckpointType
  display_title: string
  sentiment: CheckpointSentiment
}

/**
 * Normalize a batch of checkpoints using Gemini
 *
 * Batching is more efficient and reduces API calls.
 * Each checkpoint gets a normalized_type, display_title, and sentiment.
 */
export async function normalizeCheckpointsBatch(
  checkpoints: StoredCheckpoint[]
): Promise<NormalizedCheckpoint[]> {
  if (checkpoints.length === 0) return []

  // Format checkpoints for the prompt
  const checkpointList = checkpoints.map((cp, idx) => ({
    index: idx,
    id: cp.id,
    carrier: cp.carrier,
    description: cp.raw_description,
    location: cp.raw_location,
    status: cp.raw_status,
  }))

  const prompt = `You are an expert at classifying shipping carrier tracking events into standard categories.

## TASK
Normalize each carrier scan description into a standard type with a clean display title and sentiment.

## INPUT CHECKPOINTS
${JSON.stringify(checkpointList, null, 2)}

## NORMALIZED TYPES (choose ONE per checkpoint)
- LABEL: Label created, shipping info sent (pre-shipment)
- PICKUP: Carrier picked up, origin scan, accepted at facility
- INTRANSIT: In transit, departed facility, en route between locations
- HUB: Arrived at sorting/distribution facility, processed at hub
- LOCAL: Arrived at local delivery facility, at destination post office
- OFD: Out for delivery, with delivery courier
- DELIVERED: Delivered, left with resident, handed off
- ATTEMPT: Delivery attempt failed, no access, business closed
- EXCEPTION: Problem occurred - unable to locate, address issue, damaged
- RETURN: Return to sender, being returned
- CUSTOMS: Customs clearance, import/export scan
- HOLD: Held at facility, available for pickup, awaiting action

## SENTIMENT (choose ONE per checkpoint)
- positive: Good news - delivered, picked up, moving forward
- neutral: Normal progress - in transit, at hub
- concerning: Attention needed - attempt failed, delayed
- critical: Urgent issue - exception, lost, return

## DISPLAY TITLE RULES
- Keep it SHORT but SPECIFIC (2-6 words)
- KEEP carrier branding — users need to know which carrier handled the scan (e.g., "Arrived at DHL Hub", "Departed USPS Facility", "FedEx Out for Delivery")
- KEEP the city/location when it's embedded in the description (e.g., "Processed at Cincinnati Hub", "Departed Singapore")
- Preserve delivery method details (e.g., "Delivered to Mailbox", "Delivered to Door/Yard", "Picked Up at Post Office")
- Remove verbose filler text ("Your package has been...", "The item is currently...")
- Use sentence case
- The goal is NORMALIZED LANGUAGE across carriers while preserving WHO (carrier) and WHERE (city)
- Examples:
  - "Arrived at USPS Regional Destination Facility" → "Arrived at USPS Regional Facility"
  - "Departed FedEx location MEMPHIS, TN" → "Departed FedEx Memphis"
  - "Shipment has departed from a DHL facility CINCINNATI HUB,OH-UNITED STATES OF AMERICA" → "Departed DHL Cincinnati Hub"
  - "Out For Delivery Today" → "Out for Delivery"
  - "Delivered, In/At Mailbox" → "Delivered to Mailbox"
  - "Processed at JOHANNESBURG-SOUTH AFRICA" → "Processed at Johannesburg"
  - "Arrived at DHL Sort Facility  SINGAPORE-SINGAPORE" → "Arrived at DHL Singapore Hub"
  - "Delivered, Individual Picked Up at Post Office" → "Picked Up at Post Office"
  - "Delivered, Mail Room." → "Delivered to Mail Room"
  - "Clearance processing complete at BANGKOK-THAILAND" → "Customs Cleared in Bangkok"

## RESPONSE FORMAT
Respond ONLY with a JSON array (no markdown, no explanation):
[
  {
    "index": 0,
    "id": "checkpoint-uuid",
    "normalized_type": "HUB",
    "display_title": "At regional hub",
    "sentiment": "neutral"
  },
  ...
]`

  try {
    const result = await geminiModel.generateContent(prompt)
    const response = result.response
    const text = response.text()

    // Parse JSON response, removing any markdown
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const normalized = JSON.parse(jsonText) as Array<{
      index: number
      id: string
      normalized_type: NormalizedCheckpointType
      display_title: string
      sentiment: CheckpointSentiment
    }>

    // Map back to our return format
    return normalized.map((n) => ({
      id: n.id,
      normalized_type: n.normalized_type,
      display_title: n.display_title,
      sentiment: n.sentiment,
    }))
  } catch (error) {
    console.error('[AI Normalize] Error normalizing checkpoints:', error)
    return []
  }
}

/**
 * Normalize a single checkpoint (convenience wrapper)
 */
export async function normalizeCheckpoint(
  checkpoint: StoredCheckpoint
): Promise<NormalizedCheckpoint | null> {
  const results = await normalizeCheckpointsBatch([checkpoint])
  return results[0] || null
}

/**
 * Process and update unnormalized checkpoints in the database
 *
 * Call this periodically to normalize any checkpoints that haven't been processed yet.
 * Processes in batches of 20 to avoid overwhelming the API.
 *
 * @param maxCheckpoints Maximum number of checkpoints to process
 * @returns Number of checkpoints successfully normalized
 */
export async function processUnnormalizedCheckpoints(
  maxCheckpoints: number = 100
): Promise<{ processed: number; errors: number }> {
  // Import dynamically to avoid circular dependency
  const { getUnnormalizedCheckpoints } = await import('@/lib/trackingmore/checkpoint-storage')

  const batchSize = 20 // Process 20 at a time for efficiency
  let processed = 0
  let errors = 0

  // Get unnormalized checkpoints
  const checkpoints = await getUnnormalizedCheckpoints(maxCheckpoints)

  if (checkpoints.length === 0) {
    return { processed: 0, errors: 0 }
  }

  console.log(`[AI Normalize] Processing ${checkpoints.length} unnormalized checkpoints...`)

  // Process in batches
  for (let i = 0; i < checkpoints.length; i += batchSize) {
    const batch = checkpoints.slice(i, i + batchSize)

    try {
      // Normalize the batch
      const normalized = await normalizeCheckpointsBatch(batch)

      if (normalized.length > 0) {
        // Update the database
        const result = await batchUpdateNormalization(
          normalized.map((n) => ({
            id: n.id,
            normalized_type: n.normalized_type,
            display_title: n.display_title,
            sentiment: n.sentiment,
          }))
        )

        processed += result.success
        errors += result.failed
      }
    } catch (err) {
      console.error('[AI Normalize] Error processing batch:', err)
      errors += batch.length
    }

    // Small delay between batches to be polite to the API
    if (i + batchSize < checkpoints.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  console.log(`[AI Normalize] Completed: ${processed} normalized, ${errors} errors`)
  return { processed, errors }
}

/**
 * Rule-based fallback normalization (no API call)
 *
 * Used inline at checkpoint storage time so every checkpoint has at least
 * a basic normalized_type, display_title, and sentiment immediately.
 * Gemini later upgrades these with carrier-aware, location-specific titles.
 *
 * This extracts a clean title from the raw description while preserving
 * carrier names and delivery details where present.
 */
export function normalizeCheckpointFallback(
  description: string,
  status: string | null
): { normalized_type: NormalizedCheckpointType; display_title: string; sentiment: CheckpointSentiment } {
  const desc = description.toLowerCase()
  const stat = (status || '').toLowerCase()

  // Helper: extract a short title from verbose descriptions
  // Strips "Your package...", "The item...", contact info, etc.
  function extractTitle(raw: string, maxLen: number = 50): string {
    // Remove contact info (GOFO, carrier support lines)
    let clean = raw.replace(/\s*For Delivery Issues.*$/i, '')
    // Remove "Your item/package..." verbose tails
    clean = clean.replace(/,?\s*Your (item|package|shipment)\b.*$/i, '')
    // Remove ", see Estimated..." tails
    clean = clean.replace(/,?\s*see Estimated.*$/i, '')
    // Remove ", Expected Delivery by..." tails
    clean = clean.replace(/,?\s*Expected Delivery.*$/i, '')
    clean = clean.trim()
    if (clean.length > maxLen) clean = clean.slice(0, maxLen).replace(/\s+\S*$/, '')
    return clean || raw.slice(0, maxLen)
  }

  // DELIVERED — preserve delivery method details
  if (desc.startsWith('delivered') || stat === 'delivered') {
    const title = extractTitle(description)
    return { normalized_type: 'DELIVERED', display_title: title, sentiment: 'positive' }
  }

  // OUT FOR DELIVERY
  if (desc.includes('out for delivery') || desc.includes('out with courier') || stat === 'outfordelivery') {
    return { normalized_type: 'OFD', display_title: 'Out for Delivery', sentiment: 'positive' }
  }

  // DELIVERY ATTEMPT
  if (desc.includes('delivery attempt') || desc.includes('delivery exception') || desc.includes('notice left') ||
      desc.includes('no access') || desc.includes('business closed') || desc.includes('attempting') || desc.includes('redelivery')) {
    const title = extractTitle(description)
    return { normalized_type: 'ATTEMPT', display_title: title, sentiment: 'concerning' }
  }

  // RETURN TO SENDER — check before generic exception
  if (desc.includes('return to sender') || desc.includes('returned to shipper') || desc.includes('being returned') ||
      desc.includes('unclaimed') || desc.includes('refused')) {
    const title = extractTitle(description)
    return { normalized_type: 'RETURN', display_title: title, sentiment: 'critical' }
  }

  // EXCEPTION / LOST
  if (desc.includes('unable to locate') || desc.includes('lost') || desc.includes('cannot be found') ||
      desc.includes('damaged') || desc.includes('missing') ||
      (stat === 'exception' && !desc.includes('hold') && !desc.includes('on hold'))) {
    const title = extractTitle(description)
    return { normalized_type: 'EXCEPTION', display_title: title, sentiment: 'critical' }
  }

  // HOLD
  if (desc.includes('on hold') || desc.includes('hold for') || desc.includes('held') ||
      desc.includes('available for pickup') || desc.includes('awaiting collection') || desc.includes('will call')) {
    let title = extractTitle(description)
    if (desc.includes('hold for instructions') || desc.includes('awaiting instructions')) {
      title = 'Held at Facility — Awaiting Instructions'
    }
    return { normalized_type: 'HOLD', display_title: title, sentiment: 'concerning' }
  }

  // CUSTOMS — check clearance complete for positive sentiment
  if (desc.includes('customs') || desc.includes('clearance') || desc.includes('import') || desc.includes('export')) {
    const title = extractTitle(description)
    const sentiment: CheckpointSentiment = desc.includes('complete') || desc.includes('cleared') ? 'positive' : 'neutral'
    return { normalized_type: 'CUSTOMS', display_title: title, sentiment }
  }

  // LABEL CREATED
  if (desc.includes('label created') || desc.includes('shipping label') || desc.includes('electronic info') ||
      desc.includes('info received') || stat === 'inforeceived') {
    return { normalized_type: 'LABEL', display_title: 'Shipping Label Created', sentiment: 'neutral' }
  }

  // PICKUP
  if (desc.includes('picked up') || desc.includes('shipment picked') || desc.includes('origin scan') ||
      desc.includes('accepted at')) {
    const title = extractTitle(description)
    return { normalized_type: 'PICKUP', display_title: title, sentiment: 'positive' }
  }

  // LOCAL FACILITY — at destination / post office / delivery facility
  if (desc.includes('delivery facility') || desc.includes('delivery station') ||
      desc.includes('post office') || desc.includes('destination sort')) {
    const title = extractTitle(description)
    return { normalized_type: 'LOCAL', display_title: title, sentiment: 'positive' }
  }

  // HUB — sort facility, distribution center, regional facility
  if (desc.includes('sort facility') || desc.includes('distribution') || desc.includes('regional') ||
      (desc.includes('arrived') && (desc.includes('facility') || desc.includes('hub')))) {
    const title = extractTitle(description)
    return { normalized_type: 'HUB', display_title: title, sentiment: 'neutral' }
  }

  // DEPARTED
  if (desc.includes('departed') || desc.includes('has departed')) {
    const title = extractTitle(description)
    return { normalized_type: 'INTRANSIT', display_title: title, sentiment: 'neutral' }
  }

  // ARRIVED (generic)
  if (desc.includes('arrived')) {
    const title = extractTitle(description)
    return { normalized_type: 'HUB', display_title: title, sentiment: 'neutral' }
  }

  // PROCESSED
  if (desc.includes('processed') || desc.includes('sorted')) {
    const title = extractTitle(description)
    return { normalized_type: 'HUB', display_title: title, sentiment: 'neutral' }
  }

  // IN TRANSIT (default for movement)
  if (desc.includes('transit') || desc.includes('in transit') || stat === 'transit') {
    const title = extractTitle(description)
    return { normalized_type: 'INTRANSIT', display_title: title, sentiment: 'neutral' }
  }

  // Default fallback
  const title = extractTitle(description)
  return { normalized_type: 'INTRANSIT', display_title: title, sentiment: 'neutral' }
}
