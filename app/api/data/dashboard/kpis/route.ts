import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/dashboard/kpis
 *
 * Returns homepage KPI data + daily order volume from pre-aggregated summaries.
 * Uses SQL aggregation RPCs for speed (1 row per period instead of thousands).
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const preset = searchParams.get('datePreset') || '90d'

  // Compute date ranges
  const now = new Date()
  // Never include today (charges may not be fully synced)
  const endDate = new Date(now)
  endDate.setDate(endDate.getDate() - 1)
  const end = endDate.toISOString().split('T')[0]

  let days: number
  switch (preset) {
    case '7d': days = 7; break
    case '14d': days = 14; break
    case '30d': days = 30; break
    case '60d': days = 60; break
    case '90d': days = 90; break
    case '6mo': days = 180; break
    case '1yr': days = 365; break
    case 'all': days = 3650; break // ~10 years
    default: days = 90
  }

  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - days + 1)
  const start = startDate.toISOString().split('T')[0]

  // Previous period (same length, immediately before)
  const prevEndDate = new Date(startDate)
  prevEndDate.setDate(prevEndDate.getDate() - 1)
  const prevEnd = prevEndDate.toISOString().split('T')[0]
  const prevStartDate = new Date(prevEndDate)
  prevStartDate.setDate(prevStartDate.getDate() - days + 1)
  const prevStart = prevStartDate.toISOString().split('T')[0]

  try {
    const isAll = !clientId || clientId === 'all'
    const rpcClientId = isAll ? null : clientId

    // Three parallel RPC calls (each returns aggregated data, no pagination needed)
    const [curResult, prevResult, dailyResult] = await Promise.all([
      supabase.rpc('get_dashboard_kpi_totals', { p_client_id: rpcClientId, p_start: start, p_end: end }),
      supabase.rpc('get_dashboard_kpi_totals', { p_client_id: rpcClientId, p_start: prevStart, p_end: prevEnd }),
      supabase.rpc('get_dashboard_daily_aggregates', { p_client_id: rpcClientId, p_start: start, p_end: end }),
    ])

    if (curResult.error) throw curResult.error
    if (prevResult.error) throw prevResult.error
    if (dailyResult.error) throw dailyResult.error

    const cur = curResult.data || {}
    const prev = prevResult.data || {}
    const dailyRows: { day: string; shipments: number; total_charge: number; transit_days: number; delivered: number; on_time: number; breached: number; delay_on_time: number; delay_breached: number }[] = dailyResult.data || []

    // Compute KPIs (exclude delay-affected from SLA)
    const cleanOnTime = (cur.on_time_count || 0) - (cur.delay_on_time_count || 0)
    const cleanBreached = (cur.breached_count || 0) - (cur.delay_breached_count || 0)
    const cleanSlaTotal = cleanOnTime + cleanBreached
    const cleanFulfillHours = (cur.total_fulfill_business_hours || 0) - (cur.delay_fulfill_biz_hours || 0)
    const cleanFulfillCount = (cur.fulfill_count || 0) - (cur.delay_count || 0)

    const shipments = cur.shipments || 0
    const avgCostPerOrder = shipments > 0 ? (cur.total_charge / 100) / shipments : 0
    const avgTransitTime = (cur.delivered_count || 0) > 0 ? cur.total_transit_days / cur.delivered_count : 0
    const slaPercent = cleanSlaTotal > 0 ? (cleanOnTime / cleanSlaTotal) * 100 : 0
    const avgFulfillHours = cleanFulfillCount > 0 ? cleanFulfillHours / cleanFulfillCount : 0

    // Previous period KPIs for % change
    const prevShipments = prev.shipments || 0
    const prevAvgCost = prevShipments > 0 ? (prev.total_charge / 100) / prevShipments : 0
    const prevAvgTransit = (prev.delivered_count || 0) > 0 ? prev.total_transit_days / prev.delivered_count : 0
    const prevCleanOnTime = (prev.on_time_count || 0) - (prev.delay_on_time_count || 0)
    const prevCleanBreached = (prev.breached_count || 0) - (prev.delay_breached_count || 0)
    const prevSlaTotal = prevCleanOnTime + prevCleanBreached
    const prevSlaPercent = prevSlaTotal > 0 ? (prevCleanOnTime / prevSlaTotal) * 100 : 0
    const prevFulfillHours = (prev.total_fulfill_business_hours || 0) - (prev.delay_fulfill_biz_hours || 0)
    const prevFulfillCount = (prev.fulfill_count || 0) - (prev.delay_count || 0)
    const prevAvgFulfill = prevFulfillCount > 0 ? prevFulfillHours / prevFulfillCount : 0

    function pctChange(cur: number, prev: number): number {
      if (prev === 0) return cur > 0 ? 100 : 0
      return ((cur - prev) / prev) * 100
    }

    // Order volume: use purchase_date RPC for single client (matches analytics page),
    // fall back to summary table shipment_count for "all clients"
    let dailyVolume: { date: string; orders: number }[]
    if (!isAll && clientId) {
      const timezone = searchParams.get('timezone') || 'America/New_York'
      const { data: ovData, error: ovError } = await supabase.rpc('get_order_volume_by_purchase_date', {
        p_client_id: clientId,
        p_start: start,
        p_end: end,
        p_timezone: timezone,
        p_country: 'ALL',
      })
      if (ovError) {
        console.error('[Dashboard KPIs] Order volume RPC error:', ovError)
        dailyVolume = dailyRows.map(r => ({ date: r.day, orders: r.shipments }))
      } else {
        const byDate: { purchase_day: string; order_count: number }[] = ovData?.by_date || []
        dailyVolume = byDate.map(r => ({ date: r.purchase_day, orders: r.order_count }))
      }
    } else {
      dailyVolume = dailyRows.map(r => ({ date: r.day, orders: r.shipments }))
    }

    // Daily trend data for sparklines
    const dailyTrends = {
      cost: dailyRows.map(r => ({ value: r.shipments > 0 ? (r.total_charge / 100) / r.shipments : 0 })),
      transit: dailyRows.map(r => ({ value: r.delivered > 0 ? r.transit_days / r.delivered : 0 })),
      sla: dailyRows.map(r => {
        const cleanOn = r.on_time - r.delay_on_time
        const cleanBr = r.breached - r.delay_breached
        const total = cleanOn + cleanBr
        return { value: total > 0 ? (cleanOn / total) * 100 : 0 }
      }),
      orders: dailyVolume.map(d => ({ value: d.orders })),
    }

    // Use RPC-based order count when available (matches analytics page)
    const orderCount = dailyVolume.reduce((sum, d) => sum + d.orders, 0) || shipments

    return NextResponse.json({
      kpis: {
        avgCostPerOrder,
        avgTransitTime,
        slaPercent,
        orderCount,
        avgFulfillHours,
        periodChange: {
          avgCostPerOrder: pctChange(avgCostPerOrder, prevAvgCost),
          avgTransitTime: pctChange(avgTransitTime, prevAvgTransit),
          slaPercent: slaPercent - prevSlaPercent, // percentage points
          orderCount: pctChange(shipments, prevShipments),
          avgFulfillHours: pctChange(avgFulfillHours, prevAvgFulfill),
        },
      },
      dailyVolume,
      dailyTrends,
    })
  } catch (error) {
    console.error('[Dashboard KPIs] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
