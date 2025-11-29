import { NextRequest, NextResponse } from 'next/server'
import { syncAll } from '@/lib/shipbob/sync'

/**
 * Cron endpoint for scheduled data sync
 *
 * Vercel Cron calls this endpoint on schedule.
 * Protected by CRON_SECRET to prevent unauthorized access.
 *
 * Syncs all tables: orders, shipments, order_items, shipment_items, shipment_cartons, transactions
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

    console.log(`[Cron Sync] Completed in ${duration}ms`)
    console.log(`[Cron Sync] Total: ${results.totalOrders} orders, ${results.totalShipments} shipments`)

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
