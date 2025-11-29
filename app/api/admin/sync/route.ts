import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncClientById, syncAll } from '@/lib/shipbob/sync'

/**
 * POST /api/admin/sync
 * Trigger a full sync of ShipBob data (orders, shipments, items, transactions)
 *
 * Body:
 *   - clientId: string (optional) - Sync specific client only
 *   - daysBack: number (optional) - How many days to sync (default 30)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated and is admin
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const isAdmin = user.user_metadata?.role === 'admin'
    if (!isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { clientId, daysBack = 30 } = body

    if (clientId) {
      // Sync specific client only
      const result = await syncClientById(clientId, daysBack)
      return NextResponse.json({
        success: result.success,
        client: result.clientName,
        ordersFound: result.ordersFound,
        ordersUpserted: result.ordersUpserted,
        shipmentsUpserted: result.shipmentsUpserted,
        orderItemsUpserted: result.orderItemsUpserted,
        shipmentItemsInserted: result.shipmentItemsInserted,
        cartonsInserted: result.cartonsInserted,
        transactionsUpserted: result.transactionsUpserted,
        errors: result.errors,
        duration: `${result.duration}ms`,
      })
    } else {
      // Full sync: all clients
      const results = await syncAll(daysBack)

      return NextResponse.json({
        success: results.success,
        summary: {
          totalOrders: results.totalOrders,
          totalShipments: results.totalShipments,
          clientsProcessed: results.clients.length,
        },
        clients: results.clients.map((c) => ({
          client: c.clientName,
          ordersFound: c.ordersFound,
          ordersUpserted: c.ordersUpserted,
          shipmentsUpserted: c.shipmentsUpserted,
          orderItemsUpserted: c.orderItemsUpserted,
          shipmentItemsInserted: c.shipmentItemsInserted,
          cartonsInserted: c.cartonsInserted,
          transactionsUpserted: c.transactionsUpserted,
          errors: c.errors.length,
          duration: `${c.duration}ms`,
        })),
        errors: results.errors.slice(0, 20),
      })
    }
  } catch (error) {
    console.error('Sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
