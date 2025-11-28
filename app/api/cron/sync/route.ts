import { NextRequest, NextResponse } from 'next/server'
import { syncAll } from '@/lib/shipbob/sync'

/**
 * Cron endpoint for scheduled data sync
 *
 * Vercel Cron calls this endpoint on schedule.
 * Protected by CRON_SECRET to prevent unauthorized access.
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

  console.log('[Cron Sync] Starting scheduled sync...')
  const startTime = Date.now()

  try {
    // Sync last 7 days of data (webhooks should handle real-time, this is backup)
    const results = await syncAll(7)

    const duration = Date.now() - startTime

    // Summarize results
    const ordersSummary = results.orders.map(r => ({
      clientId: r.clientId,
      found: r.ordersFound,
      inserted: r.ordersInserted,
      updated: r.ordersUpdated,
      errors: r.errors.length,
    }))

    const totalOrders = results.orders.reduce((sum, r) => sum + r.ordersFound, 0)
    const totalInserted = results.orders.reduce((sum, r) => sum + r.ordersInserted, 0)
    const totalUpdated = results.orders.reduce((sum, r) => sum + r.ordersUpdated, 0)

    console.log(`[Cron Sync] Completed in ${duration}ms`)
    console.log(`[Cron Sync] Orders: ${totalOrders} found, ${totalInserted} inserted, ${totalUpdated} updated`)
    console.log(`[Cron Sync] Billing: ${results.billing.transactionsFound} tx, ${results.billing.invoicesFound} invoices`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      summary: {
        orders: {
          total: totalOrders,
          inserted: totalInserted,
          updated: totalUpdated,
        },
        billing: {
          transactions: results.billing.transactionsFound,
          invoices: results.billing.invoicesFound,
        },
      },
      details: {
        orders: ordersSummary,
        billing: {
          transactionsInserted: results.billing.transactionsInserted,
          invoicesInserted: results.billing.invoicesInserted,
          errors: results.billing.errors.slice(0, 10), // Limit error output
        },
      },
    })
  } catch (error) {
    console.error('[Cron Sync] Error:', error)
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
