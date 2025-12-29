import { NextRequest, NextResponse } from 'next/server'
import { syncAllTransactions } from '@/lib/shipbob/sync'

// Allow up to 5 minutes for tracking backfill which processes ALL missing transactions
export const maxDuration = 300

/**
 * Cron endpoint for ALL transactions sync
 *
 * Unlike the main sync (which only gets shipment-linked transactions),
 * this fetches ALL transactions including:
 * - Storage fees (FC)
 * - Receiving fees (WRO)
 * - Return fees (Return)
 * - Credits/adjustments (Default, TicketNumber)
 * - All other reference types
 *
 * Runs every 1 minute, syncing last 3 minutes of transactions.
 * Near real-time billing data capture.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel automatically includes this header)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Allow access if:
  // 1. CRON_SECRET not set (development)
  // 2. Authorization header matches
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron TransactionSync] Starting transaction sync...')
  const startTime = Date.now()

  try {
    // Sync last 3 minutes of transactions (with overlap for safety)
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMinutes(startDate.getMinutes() - 3)

    const result = await syncAllTransactions(startDate, endDate)

    const duration = Date.now() - startTime

    console.log(`[Cron TransactionSync] Completed in ${duration}ms`)
    console.log(
      `[Cron TransactionSync] ${result.transactionsFetched} fetched, ${result.transactionsUpserted} upserted`
    )

    return NextResponse.json({
      success: result.success,
      duration: `${duration}ms`,
      transactionsFetched: result.transactionsFetched,
      transactionsUpserted: result.transactionsUpserted,
      attributed: result.attributed,
      unattributed: result.unattributed,
      errors: result.errors.slice(0, 20), // Limit error output
    })
  } catch (error) {
    console.error('[Cron TransactionSync] Error:', error)
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

// Vercel Cron requires GET, but also support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
