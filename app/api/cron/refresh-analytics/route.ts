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
 * Poison pill protection: if a batch fails (e.g. statement timeout), the oldest
 * entry is skipped by marking it processed with a failure reason. This prevents
 * a single bad entry from blocking the entire queue indefinitely.
 *
 * Runs every 5 minutes. Function has statement_timeout=120s via ALTER FUNCTION.
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

    // Process in small batches — function has 120s statement_timeout.
    // Busy dates can have 300-400 shipments with complex JOINs, so keep batches small.
    const BATCH_SIZE = 5
    const MAX_BATCHES = 20  // Cap at 100 total per cron run
    let totalProcessed = 0
    let skippedEntries = 0
    let consecutiveErrors = 0

    for (let i = 0; i < MAX_BATCHES; i++) {
      // Guard: don't exceed Vercel function timeout (leave 10s buffer)
      if (Date.now() - startTime > (maxDuration - 10) * 1000) {
        console.log(`[Cron RefreshAnalytics] Approaching timeout, stopping after ${totalProcessed} processed`)
        break
      }

      const { data, error } = await supabase.rpc('refresh_analytics_summaries', {
        p_batch_size: BATCH_SIZE,
      })

      if (error) {
        console.error(`[Cron RefreshAnalytics] Error on batch ${i + 1}:`, error.message)
        consecutiveErrors++

        // Find the oldest unprocessed entry that likely caused the failure
        const { data: stuckEntries } = await supabase
          .from('analytics_refresh_queue')
          .select('id, client_id, summary_date, reason, retry_count')
          .is('processed_at', null)
          .order('created_at', { ascending: true })
          .limit(1)

        if (stuckEntries && stuckEntries.length > 0) {
          const stuck = stuckEntries[0]
          const retries = (stuck.retry_count || 0) + 1

          if (retries >= 5) {
            // Permanently skip after 5 failures — this is a true poison pill
            console.error(`[Cron RefreshAnalytics] Permanently skipping after ${retries} retries: client=${stuck.client_id} date=${stuck.summary_date}`)
            await supabase
              .from('analytics_refresh_queue')
              .update({
                processed_at: new Date().toISOString(),
                reason: `SKIPPED(${retries}x): ${error.message.substring(0, 80)} (was: ${stuck.reason || 'trigger'})`,
                retry_count: retries,
              })
              .eq('id', stuck.id)
            skippedEntries++
          } else {
            // Transient error — bump retry count and move to back of queue
            console.warn(`[Cron RefreshAnalytics] Retry ${retries}/5 for: client=${stuck.client_id} date=${stuck.summary_date}`)
            await supabase
              .from('analytics_refresh_queue')
              .update({
                retry_count: retries,
                created_at: new Date().toISOString(), // Move to back of queue
                reason: `retry(${retries}): ${stuck.reason || 'trigger'}`,
              })
              .eq('id', stuck.id)
          }
        }

        // After 3 consecutive errors, give up for this run
        if (consecutiveErrors >= 3) {
          console.error(`[Cron RefreshAnalytics] 3 consecutive errors, aborting run`)
          break
        }

        continue // Try next batch
      }

      consecutiveErrors = 0 // Reset on success
      const batchProcessed = data?.processed ?? 0
      totalProcessed += batchProcessed

      // If batch returned fewer than requested, queue is empty
      if (batchProcessed < BATCH_SIZE) break
    }

    const duration = Date.now() - startTime
    console.log(`[Cron RefreshAnalytics] Completed in ${duration}ms: ${totalProcessed} processed, ${skippedEntries} skipped`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      processed: totalProcessed,
      skipped: skippedEntries,
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
