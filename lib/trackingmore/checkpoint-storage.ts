/**
 * Checkpoint Storage for Delivery Intelligence Engine
 *
 * Permanently stores TrackingMore checkpoints in our database.
 * This is Tier 2 data for survival analysis - granular carrier scan data.
 *
 * IMPORTANT: TrackingMore data expires after ~4 months, but our stored data persists forever.
 * We store ALL checkpoints from every TrackingMore fetch, deduplicated by content hash.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createHash } from 'crypto'
import type { TrackingMoreCheckpoint, TrackingMoreTracking } from './client'

export interface StoredCheckpoint {
  id: string
  shipment_id: string
  tracking_number: string
  carrier: string
  carrier_code: string | null
  checkpoint_date: string
  raw_description: string
  raw_location: string | null
  raw_status: string | null
  raw_substatus: string | null
  normalized_type: string | null
  display_title: string | null
  sentiment: string | null
  content_hash: string
  source: string
  fetched_at: string
  normalized_at: string | null
}

/**
 * Calculate SHA256 content hash for checkpoint deduplication
 * Same carrier + date (day only) + description + location = same checkpoint
 *
 * IMPORTANT: We normalize the date to day-only (YYYY-MM-DD) because TrackingMore
 * often returns the same event in both origin_info and destination_info with
 * slightly different timestamps (e.g., different time zones or precision).
 * The actual time-of-day is not meaningful for deduplication.
 */
export function calculateCheckpointHash(
  carrier: string,
  checkpointDate: string,
  description: string,
  location: string | null
): string {
  // Normalize date to day-only (YYYY-MM-DD) to catch duplicates with different times
  const dateOnly = checkpointDate.split('T')[0]

  // Normalize description: trim, lowercase, collapse whitespace
  const normalizedDesc = description.trim().toLowerCase().replace(/\s+/g, ' ')

  // Normalize location: trim, lowercase
  const normalizedLocation = (location || '').trim().toLowerCase()

  const content = [
    carrier.toLowerCase().trim(),
    dateOnly,
    normalizedDesc,
    normalizedLocation,
  ].join('|')

  return createHash('sha256').update(content).digest('hex')
}

/**
 * Build location string from checkpoint data
 * Combines location field with city/state/country if available
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
 * Store all checkpoints from a TrackingMore response
 *
 * This extracts ALL checkpoints from origin_info and destination_info
 * and stores them permanently in tracking_checkpoints table.
 *
 * Deduplication: Uses content_hash to avoid storing duplicates.
 * If a checkpoint with the same hash already exists, it's skipped.
 *
 * @param shipmentId - Our internal shipment ID
 * @param tracking - TrackingMore tracking response
 * @param carrier - Carrier name (e.g., "USPS", "FedEx")
 * @returns Number of new checkpoints stored
 */
export async function storeCheckpoints(
  shipmentId: string,
  tracking: TrackingMoreTracking,
  carrier: string
): Promise<{ stored: number; skipped: number; error?: string }> {
  const supabase = createAdminClient()

  // Collect all checkpoints from origin and destination
  const allCheckpoints: TrackingMoreCheckpoint[] = []

  if (tracking.origin_info?.trackinfo) {
    allCheckpoints.push(...tracking.origin_info.trackinfo)
  }
  if (tracking.destination_info?.trackinfo) {
    allCheckpoints.push(...tracking.destination_info.trackinfo)
  }

  if (allCheckpoints.length === 0) {
    return { stored: 0, skipped: 0 }
  }

  // Prepare records for upsert
  const records = allCheckpoints.map((cp) => {
    const location = buildLocationString(cp)
    const hash = calculateCheckpointHash(
      carrier,
      cp.checkpoint_date,
      cp.tracking_detail,
      location
    )

    return {
      shipment_id: shipmentId,
      tracking_number: tracking.tracking_number,
      carrier: carrier,
      carrier_code: tracking.carrier_code || null,
      checkpoint_date: cp.checkpoint_date,
      raw_description: cp.tracking_detail,
      raw_location: location,
      raw_status: cp.checkpoint_delivery_status || null,
      raw_substatus: cp.checkpoint_delivery_substatus || null,
      content_hash: hash,
      source: 'trackingmore',
      fetched_at: new Date().toISOString(),
    }
  })

  try {
    // Use upsert with onConflict to skip duplicates
    // content_hash is unique, so duplicates are ignored
    const { data, error } = await supabase
      .from('tracking_checkpoints')
      .upsert(records, {
        onConflict: 'content_hash',
        ignoreDuplicates: true,
      })
      .select('id')

    if (error) {
      console.error('[CheckpointStorage] Failed to store checkpoints:', error)
      return { stored: 0, skipped: allCheckpoints.length, error: error.message }
    }

    const stored = data?.length || 0
    const skipped = allCheckpoints.length - stored

    console.log(`[CheckpointStorage] Stored ${stored} new checkpoints, skipped ${skipped} duplicates for shipment ${shipmentId}`)

    return { stored, skipped }
  } catch (err) {
    console.error('[CheckpointStorage] Error storing checkpoints:', err)
    return {
      stored: 0,
      skipped: allCheckpoints.length,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Get all stored checkpoints for a shipment
 * Returns checkpoints ordered by date (newest first)
 */
export async function getCheckpoints(
  shipmentId: string
): Promise<StoredCheckpoint[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('tracking_checkpoints')
    .select('*')
    .eq('shipment_id', shipmentId)
    .order('checkpoint_date', { ascending: false })

  if (error) {
    console.error('[CheckpointStorage] Failed to get checkpoints:', error)
    return []
  }

  return data || []
}

/**
 * Get all stored checkpoints for a tracking number
 * Useful when we don't have shipment_id yet
 */
export async function getCheckpointsByTracking(
  trackingNumber: string
): Promise<StoredCheckpoint[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('tracking_checkpoints')
    .select('*')
    .eq('tracking_number', trackingNumber)
    .order('checkpoint_date', { ascending: false })

  if (error) {
    console.error('[CheckpointStorage] Failed to get checkpoints by tracking:', error)
    return []
  }

  return data || []
}

/**
 * Get unnormalized checkpoints that need AI processing
 * Returns checkpoints where normalized_type is NULL
 *
 * @param limit - Maximum number to return (for batch processing)
 */
export async function getUnnormalizedCheckpoints(
  limit: number = 100
): Promise<StoredCheckpoint[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('tracking_checkpoints')
    .select('*')
    .is('normalized_type', null)
    .order('checkpoint_date', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[CheckpointStorage] Failed to get unnormalized checkpoints:', error)
    return []
  }

  return data || []
}

/**
 * Update checkpoint with AI normalization results
 */
export async function updateCheckpointNormalization(
  checkpointId: string,
  normalization: {
    normalized_type: string
    display_title: string
    sentiment: string
  }
): Promise<boolean> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('tracking_checkpoints')
    .update({
      normalized_type: normalization.normalized_type,
      display_title: normalization.display_title,
      sentiment: normalization.sentiment,
      normalized_at: new Date().toISOString(),
    })
    .eq('id', checkpointId)

  if (error) {
    console.error('[CheckpointStorage] Failed to update normalization:', error)
    return false
  }

  return true
}

/**
 * Batch update checkpoints with AI normalization results
 * More efficient than updating one by one
 */
export async function batchUpdateNormalization(
  updates: Array<{
    id: string
    normalized_type: string
    display_title: string
    sentiment: string
  }>
): Promise<{ success: number; failed: number }> {
  const supabase = createAdminClient()
  let success = 0
  let failed = 0

  // Process in batches of 50
  const batchSize = 50
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize)

    // Use Promise.all for parallel updates within batch
    const results = await Promise.all(
      batch.map(async (update) => {
        const { error } = await supabase
          .from('tracking_checkpoints')
          .update({
            normalized_type: update.normalized_type,
            display_title: update.display_title,
            sentiment: update.sentiment,
            normalized_at: new Date().toISOString(),
          })
          .eq('id', update.id)

        return !error
      })
    )

    success += results.filter(Boolean).length
    failed += results.filter((r) => !r).length
  }

  return { success, failed }
}

/**
 * Get checkpoint count for a shipment
 */
export async function getCheckpointCount(shipmentId: string): Promise<number> {
  const supabase = createAdminClient()

  const { count, error } = await supabase
    .from('tracking_checkpoints')
    .select('*', { count: 'exact', head: true })
    .eq('shipment_id', shipmentId)

  if (error) {
    console.error('[CheckpointStorage] Failed to get checkpoint count:', error)
    return 0
  }

  return count || 0
}

/**
 * Check if we have any checkpoints for a shipment
 */
export async function hasCheckpoints(shipmentId: string): Promise<boolean> {
  const count = await getCheckpointCount(shipmentId)
  return count > 0
}

/**
 * Get the latest checkpoint for a shipment
 */
export async function getLatestCheckpoint(
  shipmentId: string
): Promise<StoredCheckpoint | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('tracking_checkpoints')
    .select('*')
    .eq('shipment_id', shipmentId)
    .order('checkpoint_date', { ascending: false })
    .limit(1)
    .single()

  if (error) {
    // PGRST116 = no rows returned, which is expected
    if (error.code !== 'PGRST116') {
      console.error('[CheckpointStorage] Failed to get latest checkpoint:', error)
    }
    return null
  }

  return data
}

/**
 * Calculate time-in-state for survival analysis
 * Groups checkpoints by normalized_type and calculates duration at each state
 */
export function calculateTimeInStates(
  checkpoints: StoredCheckpoint[]
): Array<{ state: string; enteredAt: Date; durationHours: number }> {
  if (checkpoints.length === 0) return []

  // Sort by date ascending (oldest first) for proper duration calculation
  const sorted = [...checkpoints].sort(
    (a, b) => new Date(a.checkpoint_date).getTime() - new Date(b.checkpoint_date).getTime()
  )

  const states: Array<{ state: string; enteredAt: Date; durationHours: number }> = []

  for (let i = 0; i < sorted.length; i++) {
    const cp = sorted[i]
    const state = cp.normalized_type || 'UNKNOWN'
    const enteredAt = new Date(cp.checkpoint_date)

    // Calculate duration until next checkpoint (or now if last)
    const nextCp = sorted[i + 1]
    const exitedAt = nextCp ? new Date(nextCp.checkpoint_date) : new Date()
    const durationMs = exitedAt.getTime() - enteredAt.getTime()
    const durationHours = durationMs / (1000 * 60 * 60)

    states.push({ state, enteredAt, durationHours })
  }

  return states
}

/**
 * Get current state and time-in-state for a shipment
 * Used for survival analysis probability calculation
 */
export async function getCurrentState(
  shipmentId: string
): Promise<{ state: string; hoursInState: number } | null> {
  const latest = await getLatestCheckpoint(shipmentId)
  if (!latest) return null

  const state = latest.normalized_type || 'UNKNOWN'
  const enteredAt = new Date(latest.checkpoint_date)
  const now = new Date()
  const hoursInState = (now.getTime() - enteredAt.getTime()) / (1000 * 60 * 60)

  return { state, hoursInState }
}
