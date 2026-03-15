import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

    // Process queue in batches of 200
    const { data, error } = await supabase.rpc('refresh_analytics_summaries', {
      p_batch_size: 200,
    })

    if (error) {
      console.error('[Cron RefreshAnalytics] Error processing queue:', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const processed = data?.processed ?? 0
    const duration = Date.now() - startTime
    console.log(`[Cron RefreshAnalytics] Completed in ${duration}ms: ${processed} (client, date) pairs refreshed`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      processed,
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
