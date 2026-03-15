import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 120

/**
 * Cron endpoint to refresh pre-aggregated analytics summaries.
 *
 * Processes the analytics_refresh_queue — each entry is a (client_id, date)
 * pair enqueued by DB triggers on shipments/transactions.
 *
 * For each queued pair, the PG function:
 *   1. Deletes existing summary rows for that (client, date)
 *   2. Re-aggregates from raw tables (shipments + orders + transactions + items)
 *   3. Inserts fresh summary rows into analytics_daily/billing/city_summaries
 *
 * Runs every 5 minutes.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  console.log('[Cron RefreshAnalytics] Starting...')

  try {
    const supabase = createAdminClient()

    // Check queue depth first
    const { count, error: countError } = await supabase
      .from('analytics_refresh_queue')
      .select('*', { count: 'exact', head: true })
      .is('processed_at', null)

    if (countError) {
      console.error('[Cron RefreshAnalytics] Error checking queue:', countError.message)
      return NextResponse.json({ error: countError.message }, { status: 500 })
    }

    const queueDepth = count || 0
    console.log(`[Cron RefreshAnalytics] Queue depth: ${queueDepth}`)

    if (queueDepth === 0) {
      return NextResponse.json({
        success: true,
        duration: `${Date.now() - startTime}ms`,
        processed: 0,
        queueDepth: 0,
      })
    }

    // Process in small batches to stay under Supabase statement timeout (8s)
    // Each batch of 10 takes ~2-4s depending on data volume
    const BATCH_SIZE = 10
    const MAX_BATCHES = 20  // Cap at 200 total per cron run
    let totalProcessed = 0

    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await supabase.rpc('refresh_analytics_summaries', {
        p_batch_size: BATCH_SIZE,
      })

      if (error) {
        console.error(`[Cron RefreshAnalytics] Error on batch ${i + 1}:`, error.message)
        // If we already processed some, report partial success
        if (totalProcessed > 0) break
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const batchProcessed = data?.processed ?? 0
      totalProcessed += batchProcessed

      // If batch returned fewer than requested, queue is empty
      if (batchProcessed < BATCH_SIZE) break
    }

    const duration = Date.now() - startTime
    console.log(`[Cron RefreshAnalytics] Completed in ${duration}ms: ${totalProcessed} (client, date) pairs refreshed`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      processed: totalProcessed,
      queueDepth,
    })
  } catch (error) {
    console.error('[Cron RefreshAnalytics] Error:', error)
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

export async function POST(request: NextRequest) {
  return GET(request)
}
