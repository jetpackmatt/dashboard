/**
 * Cron Job: Normalize Tracking Checkpoints
 *
 * Runs every 15 minutes to AI-normalize tracking checkpoints that only have
 * rule-based fallback titles. Gemini upgrades these to carrier-aware,
 * location-specific, human-quality titles.
 *
 * Processes 200 checkpoints per run (10 batches of 20).
 * At 96 runs/day = up to 19,200 checkpoints/day throughput.
 *
 * Schedule: Every 15 minutes
 */

import { NextRequest, NextResponse } from 'next/server'
import { processUnnormalizedCheckpoints } from '@/lib/ai/normalize-checkpoint'

export const maxDuration = 120 // 2 minutes

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  try {
    console.log('[Normalize Cron] Starting checkpoint normalization...')
    const result = await processUnnormalizedCheckpoints(200)
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`[Normalize Cron] Completed in ${duration}s: ${result.processed} normalized, ${result.errors} errors`)

    return NextResponse.json({
      success: true,
      checkpoints_normalized: result.processed,
      checkpoints_errors: result.errors,
      duration_seconds: parseFloat(duration),
    })
  } catch (error) {
    console.error('[Normalize Cron] Fatal error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
