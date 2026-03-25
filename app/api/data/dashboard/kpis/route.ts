import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

/**
 * GET /api/data/dashboard/kpis
 *
 * Returns homepage KPI data + daily order volume from pre-aggregated summaries.
 * Accepts datePreset (7d, 14d, 30d, 60d, 90d, 6mo, 1yr, all) to control the window.
 *
 * Uses cursor-based pagination because analytics_daily_summaries has many rows
 * per client/day (one per carrier/state/fc combination), easily exceeding the
 * Supabase 1000-row limit for longer date ranges.
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

    // Cursor-paginated fetch — handles >1000 rows from analytics_daily_summaries
    async function paginatedFetch(
      selectCols: string,
      s: string,
      e: string,
      orderBy?: { column: string; ascending: boolean },
    ) {
      const PAGE_SIZE = 1000
      const allRows: any[] = []
      let lastId: string | undefined

      while (true) {
        let q = supabase
          .from('analytics_daily_summaries')
          .select(`id, ${selectCols}`)
        if (!isAll) q = q.eq('client_id', clientId!)
        q = q.gte('summary_date', s).lte('summary_date', e)
        if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending })
        q = q.order('id', { ascending: true }).limit(PAGE_SIZE)
        if (lastId) q = q.gt('id', lastId)

        const { data, error } = await q
        if (error) throw error
        if (!data || data.length === 0) break

        allRows.push(...data)
        lastId = data[data.length - 1].id

        if (data.length < PAGE_SIZE) break
      }
      return allRows
    }

    const aggCols = 'shipment_count, total_charge, total_transit_days, delivered_count, on_time_count, breached_count, total_fulfill_business_hours, fulfill_count, delay_count, delay_fulfill_biz_hours, delay_on_time_count, delay_breached_count'
    const volCols = 'summary_date, shipment_count, total_charge, total_transit_days, delivered_count, on_time_count, breached_count, delay_on_time_count, delay_breached_count'

    const [currentRows, previousRows, volumeRows] = await Promise.all([
      paginatedFetch(aggCols, start, end),
      paginatedFetch(aggCols, prevStart, prevEnd),
      paginatedFetch(volCols, start, end, { column: 'summary_date', ascending: true }),
    ])

    // Aggregate current period
    const cur = currentRows.reduce((acc, row) => {
      acc.shipments += row.shipment_count || 0
      acc.totalCharge += row.total_charge || 0
      acc.transitDays += row.total_transit_days || 0
      acc.deliveredCount += row.delivered_count || 0
      acc.onTime += row.on_time_count || 0
      acc.breached += row.breached_count || 0
      acc.fulfillHours += row.total_fulfill_business_hours || 0
      acc.fulfillCount += row.fulfill_count || 0
      acc.delayCount += row.delay_count || 0
      acc.delayFulfillHours += row.delay_fulfill_biz_hours || 0
      acc.delayOnTime += row.delay_on_time_count || 0
      acc.delayBreached += row.delay_breached_count || 0
      return acc
    }, { shipments: 0, totalCharge: 0, transitDays: 0, deliveredCount: 0, onTime: 0, breached: 0, fulfillHours: 0, fulfillCount: 0, delayCount: 0, delayFulfillHours: 0, delayOnTime: 0, delayBreached: 0 })

    // Aggregate previous period
    const prev = previousRows.reduce((acc, row) => {
      acc.shipments += row.shipment_count || 0
      acc.totalCharge += row.total_charge || 0
      acc.transitDays += row.total_transit_days || 0
      acc.deliveredCount += row.delivered_count || 0
      acc.onTime += row.on_time_count || 0
      acc.breached += row.breached_count || 0
      acc.fulfillHours += row.total_fulfill_business_hours || 0
      acc.fulfillCount += row.fulfill_count || 0
      acc.delayCount += row.delay_count || 0
      acc.delayFulfillHours += row.delay_fulfill_biz_hours || 0
      return acc
    }, { shipments: 0, totalCharge: 0, transitDays: 0, deliveredCount: 0, onTime: 0, breached: 0, fulfillHours: 0, fulfillCount: 0, delayCount: 0, delayFulfillHours: 0 })

    // Compute KPIs (exclude delay-affected from SLA)
    const cleanOnTime = cur.onTime - (cur.delayOnTime || 0)
    const cleanBreached = cur.breached - (cur.delayBreached || 0)
    const cleanSlaTotal = cleanOnTime + cleanBreached
    const cleanFulfillHours = cur.fulfillHours - (cur.delayFulfillHours || 0)
    const cleanFulfillCount = cur.fulfillCount - (cur.delayCount || 0)

    const avgCostPerOrder = cur.shipments > 0 ? (cur.totalCharge / 100) / cur.shipments : 0
    const avgTransitTime = cur.deliveredCount > 0 ? cur.transitDays / cur.deliveredCount : 0
    const slaPercent = cleanSlaTotal > 0 ? (cleanOnTime / cleanSlaTotal) * 100 : 0
    const avgFulfillHours = cleanFulfillCount > 0 ? cleanFulfillHours / cleanFulfillCount : 0

    // Previous period KPIs for % change
    const prevAvgCost = prev.shipments > 0 ? (prev.totalCharge / 100) / prev.shipments : 0
    const prevAvgTransit = prev.deliveredCount > 0 ? prev.transitDays / prev.deliveredCount : 0
    const prevCleanOnTime = prev.onTime - (prev.delayCount || 0) // approximate
    const prevCleanBreached = prev.breached
    const prevSlaTotal = prevCleanOnTime + prevCleanBreached
    const prevSlaPercent = prevSlaTotal > 0 ? (prevCleanOnTime / prevSlaTotal) * 100 : 0
    const prevFulfillHours = prev.fulfillHours - (prev.delayFulfillHours || 0)
    const prevFulfillCount = prev.fulfillCount - (prev.delayCount || 0)
    const prevAvgFulfill = prevFulfillCount > 0 ? prevFulfillHours / prevFulfillCount : 0

    function pctChange(cur: number, prev: number): number {
      if (prev === 0) return cur > 0 ? 100 : 0
      return ((cur - prev) / prev) * 100
    }

    // Aggregate daily volumes + trends (aggregate across dimension rows per date)
    const dayAgg = new Map<string, { shipments: number; charge: number; transitDays: number; delivered: number; onTime: number; breached: number; delayOnTime: number; delayBreached: number }>()
    for (const row of volumeRows) {
      const d = row.summary_date
      const existing = dayAgg.get(d) || { shipments: 0, charge: 0, transitDays: 0, delivered: 0, onTime: 0, breached: 0, delayOnTime: 0, delayBreached: 0 }
      existing.shipments += row.shipment_count || 0
      existing.charge += row.total_charge || 0
      existing.transitDays += row.total_transit_days || 0
      existing.delivered += row.delivered_count || 0
      existing.onTime += row.on_time_count || 0
      existing.breached += row.breached_count || 0
      existing.delayOnTime += row.delay_on_time_count || 0
      existing.delayBreached += row.delay_breached_count || 0
      dayAgg.set(d, existing)
    }
    const sortedDates = Array.from(dayAgg.entries()).sort(([a], [b]) => a.localeCompare(b))

    // Order volume: use purchase_date RPC for single client (matches analytics page),
    // fall back to summary table shipment_count for "all clients" (RPC doesn't support all)
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
        // Fall back to summary data
        dailyVolume = sortedDates.map(([date, agg]) => ({ date, orders: agg.shipments }))
      } else {
        const byDate: { purchase_day: string; order_count: number }[] = ovData?.by_date || []
        dailyVolume = byDate.map(r => ({ date: r.purchase_day, orders: r.order_count }))
      }
    } else {
      dailyVolume = sortedDates.map(([date, agg]) => ({ date, orders: agg.shipments }))
    }

    // Daily trend data for sparklines
    const dailyTrends = {
      cost: sortedDates.map(([, agg]) => ({ value: agg.shipments > 0 ? (agg.charge / 100) / agg.shipments : 0 })),
      transit: sortedDates.map(([, agg]) => ({ value: agg.delivered > 0 ? agg.transitDays / agg.delivered : 0 })),
      sla: sortedDates.map(([, agg]) => {
        const cleanOn = agg.onTime - agg.delayOnTime
        const cleanBr = agg.breached - agg.delayBreached
        const total = cleanOn + cleanBr
        return { value: total > 0 ? (cleanOn / total) * 100 : 0 }
      }),
      orders: dailyVolume.map(d => ({ value: d.orders })),
    }

    // Use RPC-based order count when available (matches analytics page)
    const orderCount = dailyVolume.reduce((sum, d) => sum + d.orders, 0) || cur.shipments

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
          orderCount: pctChange(cur.shipments, prev.shipments),
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
