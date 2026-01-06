import { NextRequest, NextResponse } from 'next/server'
import { syncAll, syncReturns, syncReceivingOrders } from '@/lib/shipbob/sync'

// Allow up to 2 minutes for per-minute sync (multiple clients + receiving orders)
export const maxDuration = 120

/**
 * Cron endpoint for scheduled data sync
 *
 * Vercel Cron calls this endpoint every minute.
 * Protected by CRON_SECRET to prevent unauthorized access.
 *
 * Syncs: orders, shipments, order_items, shipment_items, shipment_cartons, transactions, returns, receiving_orders
 * NOTE: Timeline events are synced by separate /api/cron/sync-timelines endpoint
 *
 * Per-minute sync strategy:
 * - Fetch only last 5 minutes of data (with overlap for safety)
 * - Skip reconciliation (soft-delete detection) - run that daily instead
 * - This replaces webhooks for near-real-time updates
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

  console.log('[Cron Sync] Starting per-minute sync...')
  const startTime = Date.now()

  try {
    // Per-minute sync: only fetch last 5 minutes of data (with overlap)
    // This is fast and keeps data fresh without relying on webhooks
    const results = await syncAll({ minutesBack: 5 })

    // Sync returns: fetch any return IDs from transactions that are missing from returns table
    // This ensures we have return data (including insert_date) for all billed returns
    const returnsResult = await syncReturns()

    // Sync receiving orders (WROs): fetch from /receiving API with 60 min lookback
    // This captures status_history timeline for receiving analytics
    const receivingResult = await syncReceivingOrders(60)

    // NOTE: Timeline events are synced by /api/cron/sync-timelines (separate cron)

    const duration = Date.now() - startTime

    console.log(`[Cron Sync] Completed in ${duration}ms`)
    console.log(`[Cron Sync] Total: ${results.totalOrders} orders, ${results.totalShipments} shipments`)
    if (returnsResult.synced > 0) {
      console.log(`[Cron Sync] Returns synced: ${returnsResult.synced}`)
    }
    if (receivingResult.wrosUpserted > 0) {
      console.log(`[Cron Sync] WROs synced: ${receivingResult.wrosUpserted}`)
    }

    // Build per-client summary
    const clientSummary = results.clients.map((c) => ({
      client: c.clientName,
      ordersFound: c.ordersFound,
      ordersUpserted: c.ordersUpserted,
      shipmentsUpserted: c.shipmentsUpserted,
      orderItemsUpserted: c.orderItemsUpserted,
      shipmentItemsInserted: c.shipmentItemsInserted,
      transactionsUpserted: c.transactionsUpserted,
      errors: c.errors.length,
      duration: `${c.duration}ms`,
    }))

    return NextResponse.json({
      success: results.success,
      duration: `${duration}ms`,
      summary: {
        totalOrders: results.totalOrders,
        totalShipments: results.totalShipments,
        clientsProcessed: results.clients.length,
        returnsSynced: returnsResult.synced,
        wrosSynced: receivingResult.wrosUpserted,
      },
      clients: clientSummary,
      errors: results.errors.slice(0, 20), // Limit error output
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
