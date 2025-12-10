import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface HealthMetric {
  label: string
  description: string
  value: number
  total: number
  percentage: number
  status: 'good' | 'warning' | 'critical'
}

// GET /api/admin/sync-health - Get sync health metrics
export async function GET() {
  try {
    // Verify admin access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user || user.user_metadata?.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminClient = createAdminClient()

    // Run all queries in parallel
    const [
      transactionsWithTracking,
      totalShipmentTransactions,
      shipmentsWithTimeline,
      totalCompletedShipments,
      unattributedTransactions,
      transactionsWithBaseCost,
      totalShippingTransactions,
      recentSyncStats,
    ] = await Promise.all([
      // 1. Transactions with tracking_id (for shipment type)
      adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('reference_type', 'Shipment')
        .not('tracking_id', 'is', null),

      // 2. Total shipment transactions
      adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('reference_type', 'Shipment'),

      // 3. Completed shipments with any timeline data (event_created populated)
      adminClient
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Completed')
        .not('event_created', 'is', null)
        .is('deleted_at', null),

      // 4. Total completed shipments
      adminClient
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'Completed')
        .is('deleted_at', null),

      // 5. Unattributed transactions (no merchant_id linkage)
      adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .is('merchant_id', null),

      // 6. Transactions with base_cost (SFTP data)
      adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('reference_type', 'Shipment')
        .not('base_cost', 'is', null),

      // 7. Total shipping transactions for base_cost percentage
      adminClient
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('reference_type', 'Shipment'),

      // 8. Recent sync stats (orders/shipments created in last 24h)
      Promise.all([
        adminClient
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        adminClient
          .from('shipments')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        adminClient
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ]),
    ])

    // Build metrics
    const trackingCount = transactionsWithTracking.count || 0
    const trackingTotal = totalShipmentTransactions.count || 0
    const trackingPct = trackingTotal > 0 ? Math.round((trackingCount / trackingTotal) * 1000) / 10 : 0

    const timelineCount = shipmentsWithTimeline.count || 0
    const timelineTotal = totalCompletedShipments.count || 0
    const timelinePct = timelineTotal > 0 ? Math.round((timelineCount / timelineTotal) * 1000) / 10 : 0

    const baseCostCount = transactionsWithBaseCost.count || 0
    const baseCostTotal = totalShippingTransactions.count || 0
    const baseCostPct = baseCostTotal > 0 ? Math.round((baseCostCount / baseCostTotal) * 1000) / 10 : 0

    const unattributedCount = unattributedTransactions.count || 0

    const metrics: HealthMetric[] = [
      {
        label: 'Tracking ID Coverage',
        description: 'Shipment transactions with tracking_id populated',
        value: trackingCount,
        total: trackingTotal,
        percentage: trackingPct,
        status: trackingPct >= 95 ? 'good' : trackingPct >= 80 ? 'warning' : 'critical',
      },
      {
        label: 'Timeline Events',
        description: 'Completed shipments with timeline data',
        value: timelineCount,
        total: timelineTotal,
        percentage: timelinePct,
        status: timelinePct >= 90 ? 'good' : timelinePct >= 70 ? 'warning' : 'critical',
      },
      {
        label: 'Base Cost (SFTP)',
        description: 'Shipping transactions with base_cost from SFTP',
        value: baseCostCount,
        total: baseCostTotal,
        percentage: baseCostPct,
        status: baseCostPct >= 80 ? 'good' : baseCostPct >= 50 ? 'warning' : 'critical',
      },
      {
        label: 'Attributed Transactions',
        description: 'Transactions linked to a merchant',
        value: (trackingTotal || 0) - unattributedCount,
        total: trackingTotal || 0,
        percentage: trackingTotal ? Math.round(((trackingTotal - unattributedCount) / trackingTotal) * 1000) / 10 : 100,
        status: (() => {
          const pct = trackingTotal ? ((trackingTotal - unattributedCount) / trackingTotal) * 100 : 100
          return pct >= 99.5 ? 'good' : pct >= 95 ? 'warning' : 'critical'
        })(),
      },
    ]

    // Recent sync stats
    const [ordersLast24h, shipmentsLast24h, transactionsLast24h] = recentSyncStats
    const recentActivity = {
      ordersLast24h: ordersLast24h.count || 0,
      shipmentsLast24h: shipmentsLast24h.count || 0,
      transactionsLast24h: transactionsLast24h.count || 0,
    }

    return NextResponse.json({
      metrics,
      clientHealth: [], // Per-client breakdown not implemented yet
      recentActivity,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error in sync-health GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
