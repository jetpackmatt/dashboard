import { NextRequest, NextResponse } from 'next/server'
import { syncBillingAwareTimelines } from '@/lib/shipbob/sync'

export const maxDuration = 300

/**
 * Dedicated timeline backfill endpoint.
 *
 * Runs syncBillingAwareTimelines in a loop until the backlog is cleared
 * or we hit a safety cap. Useful when the regular sync-reconcile cron
 * times out before reaching the timeline backfill step (which it does
 * when the 45-day order/shipment sync eats all the time budget).
 *
 * Trigger manually: curl -H "Authorization: Bearer $CRON_SECRET" \
 *   https://dashboard/api/cron/backfill-timelines
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const PASS_SIZE = 200
  const MAX_PASSES = 20  // 20 * 200 = 4000 shipments max per run
  const TIMEOUT_BUDGET_MS = (300 - 15) * 1000  // leave 15s buffer

  let totalUpdated = 0
  let totalSkipped = 0
  let totalErrors = 0
  let passesRun = 0

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (Date.now() - startTime > TIMEOUT_BUDGET_MS) {
      console.log(`[backfill-timelines] timeout budget reached after ${passesRun} passes`)
      break
    }
    const result = await syncBillingAwareTimelines(PASS_SIZE)
    passesRun++
    totalUpdated += result.updated
    totalSkipped += result.skipped
    totalErrors += result.errors.length
    console.log(`[backfill-timelines] pass ${pass + 1}: total=${result.totalShipments}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors.length}`)
    // Backlog cleared
    if (result.totalShipments < PASS_SIZE) break
  }

  return NextResponse.json({
    success: true,
    duration: Date.now() - startTime,
    passes: passesRun,
    totalUpdated,
    totalSkipped,
    totalErrors,
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
