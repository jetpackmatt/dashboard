import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncClientOrders, syncAll } from '@/lib/shipbob/sync'

/**
 * POST /api/admin/sync
 * Trigger a full sync of ShipBob data (orders + billing)
 *
 * Body:
 *   - clientId: string (optional) - Sync specific client orders only
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
      // Sync specific client orders only
      const result = await syncClientOrders(clientId, daysBack)
      return NextResponse.json(result)
    } else {
      // Full sync: all clients + billing
      const { orders, billing } = await syncAll(daysBack)

      return NextResponse.json({
        success: orders.every(r => r.success) && billing.success,
        orders: {
          results: orders,
          summary: {
            totalClients: orders.length,
            totalOrdersFound: orders.reduce((sum, r) => sum + r.ordersFound, 0),
            totalOrdersInserted: orders.reduce((sum, r) => sum + r.ordersInserted, 0),
            totalOrdersUpdated: orders.reduce((sum, r) => sum + r.ordersUpdated, 0),
            totalErrors: orders.reduce((sum, r) => sum + r.errors.length, 0),
          },
        },
        billing: {
          ...billing,
        },
        // Legacy summary for backward compatibility
        summary: {
          totalClients: orders.length,
          totalOrdersFound: orders.reduce((sum, r) => sum + r.ordersFound, 0),
          totalOrdersInserted: orders.reduce((sum, r) => sum + r.ordersInserted, 0),
          totalOrdersUpdated: orders.reduce((sum, r) => sum + r.ordersUpdated, 0),
          totalErrors: orders.reduce((sum, r) => sum + r.errors.length, 0) + billing.errors.length,
          // New billing fields
          totalInvoicesFound: billing.invoicesFound,
          totalInvoicesInserted: billing.invoicesInserted,
          totalTransactionsFound: billing.transactionsFound,
          totalTransactionsInserted: billing.transactionsInserted,
          totalTransactionsUpdated: billing.transactionsUpdated,
        },
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
