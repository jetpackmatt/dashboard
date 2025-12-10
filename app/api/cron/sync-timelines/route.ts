import { NextRequest, NextResponse } from 'next/server'
import { syncAllUndeliveredTimelines } from '@/lib/shipbob/sync'

/**
 * Dedicated cron endpoint for timeline event sync
 *
 * Runs every minute to update timeline events (event_created, event_picked,
 * event_packed, event_labeled, event_intransit, event_delivered, etc.)
 * for in-transit shipments (Completed status = shipped from warehouse, not yet delivered).
 *
 * Tiered check frequency:
 * - Fresh shipments (0-3 days): Check every 15 minutes - actively moving
 * - Older shipments (3-14 days): Check every 2 hours - likely delivered or stuck
 *
 * Per-client scaling: Each client gets 100 shipments/run (70 fresh + 30 older).
 * Clients are auto-detected and processed in parallel (each has own 150 req/min budget).
 * Example: 3 clients = 300 shipments/run, 10 clients = 1000 shipments/run.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron Timeline] Starting timeline sync...')
  const startTime = Date.now()

  try {
    // Process up to 100 shipments PER CLIENT with tiered check frequency
    // Fresh (0-3d) checked every 15 min, older (3-14d) every 2 hours
    // 14 days max age (336 hours) for regular sync
    // Auto-scales: 3 clients = 300 shipments, 10 clients = 1000 shipments
    const result = await syncAllUndeliveredTimelines(100, 336)

    const duration = Date.now() - startTime

    console.log(`[Cron Timeline] Completed in ${duration}ms`)
    console.log(`[Cron Timeline] Checked: ${result.totalShipments}, Updated: ${result.updated}, Skipped: ${result.skipped}`)

    return NextResponse.json({
      success: result.success,
      duration: `${duration}ms`,
      summary: {
        shipmentsChecked: result.totalShipments,
        timelinesUpdated: result.updated,
        skipped: result.skipped,
        errors: result.errors.length,
      },
      errors: result.errors.slice(0, 10), // Limit error output
    })
  } catch (error) {
    console.error('[Cron Timeline] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      },
      { status: 500 }
    )
  }
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
