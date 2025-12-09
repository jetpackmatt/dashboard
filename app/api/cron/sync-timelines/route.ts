import { NextRequest, NextResponse } from 'next/server'
import { syncAllUndeliveredTimelines } from '@/lib/shipbob/sync'

/**
 * Dedicated cron endpoint for timeline event sync
 *
 * Runs every minute to update timeline events (event_created, event_picked,
 * event_packed, event_labeled, event_intransit, event_delivered, etc.)
 * for undelivered shipments.
 *
 * Separate from main sync to:
 * - Avoid competing for execution time with order/shipment sync
 * - Allow independent scaling (can process more shipments)
 * - Provide cleaner monitoring and fault isolation
 *
 * Vercel Pro plan has 300s timeout - we process 1000 shipments (~100s)
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
    // Process 1000 undelivered shipments per run
    // At ~100ms per API call, this takes ~100 seconds (well within 300s Pro timeout)
    // 14 days max age (336 hours) to focus on recent shipments
    const result = await syncAllUndeliveredTimelines(1000, 336)

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
