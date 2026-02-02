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
- Keep it SHORT (2-5 words)
- Remove carrier branding (no "USPS", "FedEx", etc.)
- Remove redundant words
- Use sentence case
- Examples:
  - "Arrived at USPS Regional Destination Facility" → "At regional hub"
  - "Departed FedEx location MEMPHIS, TN" → "Departed hub"
  - "Out For Delivery Today" → "Out for delivery"
  - "Delivered, In/At Mailbox" → "Delivered to mailbox"

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
 * Use this when Gemini is unavailable or for cost savings.
 * Less accurate but works offline.
 */
export function normalizeCheckpointFallback(
  description: string,
  status: string | null
): { normalized_type: NormalizedCheckpointType; display_title: string; sentiment: CheckpointSentiment } {
  const desc = description.toLowerCase()
  const stat = (status || '').toLowerCase()

  // DELIVERED
  if (desc.includes('delivered') || stat === 'delivered') {
    return {
      normalized_type: 'DELIVERED',
      display_title: 'Delivered',
      sentiment: 'positive',
    }
  }

  // OUT FOR DELIVERY
  if (desc.includes('out for delivery') || stat === 'outfordelivery') {
    return {
      normalized_type: 'OFD',
      display_title: 'Out for delivery',
      sentiment: 'positive',
    }
  }

  // DELIVERY ATTEMPT
  if (desc.includes('delivery attempt') || desc.includes('notice left') || desc.includes('no access')) {
    return {
      normalized_type: 'ATTEMPT',
      display_title: 'Delivery attempted',
      sentiment: 'concerning',
    }
  }

  // EXCEPTION / LOST
  if (desc.includes('unable to locate') || desc.includes('lost') || desc.includes('cannot be found') ||
      stat === 'exception' || stat === 'undelivered') {
    return {
      normalized_type: 'EXCEPTION',
      display_title: 'Exception',
      sentiment: 'critical',
    }
  }

  // RETURN
  if (desc.includes('return') || desc.includes('rts') || desc.includes('refused')) {
    return {
      normalized_type: 'RETURN',
      display_title: 'Returning to sender',
      sentiment: 'critical',
    }
  }

  // CUSTOMS
  if (desc.includes('customs') || desc.includes('import') || desc.includes('export')) {
    return {
      normalized_type: 'CUSTOMS',
      display_title: 'In customs',
      sentiment: 'neutral',
    }
  }

  // HOLD
  if (desc.includes('held') || desc.includes('available for pickup') || desc.includes('will call')) {
    return {
      normalized_type: 'HOLD',
      display_title: 'Held at facility',
      sentiment: 'concerning',
    }
  }

  // LABEL CREATED
  if (desc.includes('label created') || desc.includes('shipping label') || desc.includes('electronic info') ||
      stat === 'inforeceived') {
    return {
      normalized_type: 'LABEL',
      display_title: 'Label created',
      sentiment: 'neutral',
    }
  }

  // PICKUP
  if (desc.includes('picked up') || desc.includes('accepted') || desc.includes('origin scan')) {
    return {
      normalized_type: 'PICKUP',
      display_title: 'Picked up',
      sentiment: 'positive',
    }
  }

  // LOCAL FACILITY
  if (desc.includes('local') || desc.includes('post office') || desc.includes('destination')) {
    return {
      normalized_type: 'LOCAL',
      display_title: 'At local facility',
      sentiment: 'positive',
    }
  }

  // HUB (arrived at facility)
  if (desc.includes('arrived') || desc.includes('facility') || desc.includes('hub') ||
      desc.includes('distribution')) {
    return {
      normalized_type: 'HUB',
      display_title: 'At hub',
      sentiment: 'neutral',
    }
  }

  // IN TRANSIT (default for movement)
  if (desc.includes('transit') || desc.includes('departed') || desc.includes('processed') ||
      stat === 'transit') {
    return {
      normalized_type: 'INTRANSIT',
      display_title: 'In transit',
      sentiment: 'neutral',
    }
  }

  // Default fallback
  return {
    normalized_type: 'INTRANSIT',
    display_title: 'In transit',
    sentiment: 'neutral',
  }
}
