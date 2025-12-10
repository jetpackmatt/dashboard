import { NextRequest, NextResponse } from 'next/server'
import { syncAll } from '@/lib/shipbob/sync'

/**
 * Hourly reconciliation sync
 *
 * Runs every hour to:
 * 1. Catch any orders/shipments/transactions missed by per-minute sync
 * 2. Run soft-delete reconciliation (detect deleted records in ShipBob)
 *
 * Uses a 20-day lookback window to catch orders that get cancelled/deleted.
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

  console.log('[Cron Reconcile] Starting hourly reconciliation sync...')
  const startTime = Date.now()

  try {
    // Hourly sync: 20-day lookback to catch cancelled/deleted orders
    // Note: daysBack triggers reconciliation, minutesBack skips it
    // Uses StartDate filter to fetch orders created in the last 20 days
    const results = await syncAll({ daysBack: 20 })

    const duration = Date.now() - startTime

    console.log(`[Cron Reconcile] Completed in ${duration}ms`)
    console.log(`[Cron Reconcile] Total: ${results.totalOrders} orders, ${results.totalShipments} shipments`)

    // Build per-client summary
    const clientSummary = results.clients.map((c) => ({
      client: c.clientName,
      ordersFound: c.ordersFound,
      ordersUpserted: c.ordersUpserted,
      shipmentsUpserted: c.shipmentsUpserted,
      orderItemsUpserted: c.orderItemsUpserted,
      transactionsUpserted: c.transactionsUpserted,
      ordersDeleted: c.ordersDeleted,
      shipmentsDeleted: c.shipmentsDeleted,
      errors: c.errors.length,
      duration: `${c.duration}ms`,
    }))

    return NextResponse.json({
      success: results.success,
      type: 'reconciliation',
      duration: `${duration}ms`,
      summary: {
        totalOrders: results.totalOrders,
        totalShipments: results.totalShipments,
        clientsProcessed: results.clients.length,
      },
      clients: clientSummary,
      errors: results.errors.slice(0, 20),
    })
  } catch (error) {
    console.error('[Cron Reconcile] Error:', error)
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
