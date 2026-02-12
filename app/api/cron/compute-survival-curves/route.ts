/**
 * Cron Job: Compute Survival Curves
 *
 * Runs daily to:
 * 1. Sync new shipments to delivery_outcomes (incremental)
 * 2. AI-normalize pending TrackingMore checkpoints (Tier 2 data)
 * 3. Recompute Kaplan-Meier survival curves from delivery_outcomes
 *
 * This keeps training data and curves up-to-date as new shipment data accumulates.
 *
 * Schedule: Daily at 4:00 AM UTC (after nightly sync)
 */

import { NextRequest, NextResponse } from 'next/server'
import { computeAllSurvivalCurves } from '@/lib/delivery-intelligence/survival-analysis'
import { syncNewDeliveryOutcomes } from '@/lib/delivery-intelligence/feature-extraction'
import { processUnnormalizedCheckpoints } from '@/lib/ai/normalize-checkpoint'

export const maxDuration = 300 // 5 minutes - sync + curve computation can take time

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Step 1: Sync new shipments to delivery_outcomes
    console.log('[Survival Cron] Step 1: Syncing new delivery outcomes...')
    const syncResult = await syncNewDeliveryOutcomes()
    console.log(`[Survival Cron] Sync complete: ${syncResult.added} new records`)

    // Step 2: AI-normalize pending TrackingMore checkpoints
    // Process up to 200 per run to avoid API rate limits while clearing backlog
    console.log('[Survival Cron] Step 2: Normalizing pending checkpoints...')
    const normalizeResult = await processUnnormalizedCheckpoints(200)
    console.log(`[Survival Cron] Normalize complete: ${normalizeResult.processed} processed, ${normalizeResult.errors} errors`)

    // Step 3: Compute survival curves
    console.log('[Survival Cron] Step 3: Computing survival curves...')
    const curveResult = await computeAllSurvivalCurves()

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`[Survival Cron] Completed in ${duration}s: ${syncResult.added} synced, ${normalizeResult.processed} normalized, ${curveResult.computed} curves`)

    return NextResponse.json({
      success: true,
      outcomes_synced: syncResult.added,
      outcomes_errors: syncResult.errors,
      checkpoints_normalized: normalizeResult.processed,
      checkpoints_errors: normalizeResult.errors,
      curves_computed: curveResult.computed,
      curves_errors: curveResult.errors,
      duration_seconds: parseFloat(duration),
    })
  } catch (error) {
    console.error('[Survival Cron] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
