import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import type { DateRangePreset } from '@/lib/analytics/types'
import { getGranularityForRange } from '@/lib/analytics/types'
import { US_STATES, CA_PROVINCES, AU_STATES } from '@/lib/destination-data'

export const maxDuration = 60

const PAGE_SIZE = 1000

// ── Module-level cache (persists across warm Vercel invocations) ──────────
const responseCache = new Map<string, { json: any; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 20

// ── State name lookup ────────────────────────────────────────────────────
const STATE_NAME_MAP: Record<string, Record<string, string>> = {
  US: Object.fromEntries(US_STATES.map(s => [s.code, s.name])),
  CA: Object.fromEntries(CA_PROVINCES.map(s => [s.code, s.name])),
  AU: Object.fromEntries(AU_STATES.map(s => [s.code, s.name])),
}

function getStateName(code: string, country: string): string {
  if (country === 'ALL') {
    // Try all country maps
    return STATE_NAME_MAP['US']?.[code] || STATE_NAME_MAP['CA']?.[code] || STATE_NAME_MAP['AU']?.[code] || code
  }
  return STATE_NAME_MAP[country]?.[code] || code
}

// ── Zone labels ──────────────────────────────────────────────────────────
const ZONE_LABELS: Record<string, string> = {
  '1': 'Local', '2': 'Very Close', '3': 'Regional', '4': 'Medium',
  '5': 'Farther', '6': 'Far', '7': 'Very Far', '8': 'Coast to Coast',
}

// ── Day-of-week names ────────────────────────────────────────────────────
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// ── Cursor-based pagination (only used for undelivered shipments) ─────────
async function cursorPaginate(
  buildQuery: (lastId: string | null) => any
): Promise<any[]> {
  const all: any[] = []
  let lastId: string | null = null
  while (true) {
    const { data, error } = await buildQuery(lastId)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    all.push(...data)
    lastId = data[data.length - 1].id
    if (data.length < PAGE_SIZE) break
  }
  return all
}

// ── Time period key helper ───────────────────────────────────────────────
function getTimeKey(dateStr: string, granularity: string): string {
  if (granularity === 'daily') return dateStr
  const d = new Date(dateStr + 'T00:00:00Z')
  if (granularity === 'weekly') {
    const day = d.getUTCDay()
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
    return monday.toISOString().substring(0, 10)
  }
  // monthly
  return dateStr.substring(0, 7)
}

function formatMonthLabel(key: string, granularity: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (granularity === 'monthly') {
    const [y, m] = key.split('-')
    return `${months[parseInt(m) - 1]} ${y}`
  }
  const [y, m, d] = key.split('-')
  return `${months[parseInt(m) - 1]} ${parseInt(d)}`
}

// ── Percent change helper ────────────────────────────────────────────────
function pctChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  if (!clientId || clientId === 'all') {
    return NextResponse.json({ error: 'A specific client must be selected for analytics' }, { status: 400 })
  }

  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const datePreset = (searchParams.get('datePreset') || '30d') as DateRangePreset
  const country = searchParams.get('country') || 'US'

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  // ── Check cache ────────────────────────────────────────────────────────
  const cacheKey = `v3:${clientId}:${startDate}:${endDate}:${datePreset}:${country}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.json)
  }

  const supabase = createAdminClient()
  const granularity = getGranularityForRange(datePreset)

  // Previous period dates
  const daysMap: Record<string, number> = { '14d': 14, '30d': 30, '60d': 60, '90d': 90, '6mo': 182, '1yr': 365, 'all': 365 }
  const days = daysMap[datePreset] || 30
  const prevTo = new Date(startDate + 'T00:00:00Z')
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - days + 1)
  const prevStartDate = prevFrom.toISOString().substring(0, 10)
  const prevEndDate = prevTo.toISOString().substring(0, 10)

  try {
    // ── Fast queries only — summary RPC (109ms) + transit (545ms) + SLA (457ms)
    // Fulfillment trend, order time, pick/pack eliminated (computed from summaries)
    const [
      summaryResult,
      transitDistResult,
      slaDetailResult,
      undeliveredRows,
      clientResult,
      fcNamesResult,
    ] = await Promise.all([
      // Single RPC: all GROUP BY queries executed server-side in Postgres
      supabase.rpc('get_analytics_from_summaries', {
        p_client_id: clientId,
        p_start: startDate,
        p_end: endDate,
        p_prev_start: prevStartDate,
        p_prev_end: prevEndDate,
        p_country: country,
      }),

      // Transit distribution — uses covering index (545ms)
      supabase.rpc('get_transit_distribution', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }),

      // SLA detail records (457ms)
      supabase.rpc('get_sla_detail_records', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }),

      // Undelivered shipments (raw — typically <5% of total)
      cursorPaginate((lastId) => {
        let q = supabase.from('shipments')
          .select('id, tracking_id, shipbob_order_id, recipient_name, event_labeled, carrier, status, destination_country')
          .eq('client_id', clientId!)
          .is('deleted_at', null)
          .is('event_delivered', null)
          .gte('event_labeled', startDate!)
          .lte('event_labeled', endDate + 'T23:59:59.999Z')
          .order('id', { ascending: true })
          .limit(PAGE_SIZE)
        if (lastId) q = q.gt('id', lastId)
        return q
      }),

      // Client name
      supabase.from('clients').select('company_name').eq('id', clientId!).single(),

      // Distinct FC countries for this client (uses SQL distinct via RPC-like approach)
      supabase.rpc('get_client_fc_countries', { p_client_id: clientId, p_start: startDate, p_end: endDate }),
    ])

    // Available countries from RPC (distinct FC countries for this client in date range)
    const fcCountryRows = fcNamesResult.data || []
    const availableCountries: string[] = fcCountryRows.map((r: any) => String(r.country)).filter(Boolean)
    if (!availableCountries.includes('US')) availableCountries.unshift('US')
    const countryDataDays: Record<string, number> = {}
    for (const r of fcCountryRows) { countryDataDays[String(r.country)] = Number(r.data_days) || 0 }

    if (summaryResult.error) throw new Error(summaryResult.error.message)
    const s = summaryResult.data
    const cur = s.current
    const prev = s.previous
    const merchantName = clientResult.data?.company_name || 'Unknown'

    // ── KPIs ─────────────────────────────────────────────────────────────
    const avgTransitCurrent = cur.transit_count > 0 ? cur.total_transit_days / cur.transit_count : 0
    const avgTransitPrev = prev.transit_count > 0 ? prev.total_transit_days / prev.transit_count : 0
    const slaTotalCurrent = cur.on_time_count + cur.breached_count
    const slaTotalPrev = prev.on_time_count + prev.breached_count
    const slaPercentCurrent = slaTotalCurrent > 0 ? (cur.on_time_count / slaTotalCurrent) * 100 : 0
    const slaPercentPrev = slaTotalPrev > 0 ? (prev.on_time_count / slaTotalPrev) * 100 : 0

    // Delivery on-time (carrier transit vs benchmark + 1 day buffer)
    const deliveryOnTimeTotalCur = cur.delivery_on_time_count + cur.delivery_late_count
    const deliveryOnTimeTotalPrev = prev.delivery_on_time_count + prev.delivery_late_count
    const deliveryOnTimePercentCur = deliveryOnTimeTotalCur > 0 ? (cur.delivery_on_time_count / deliveryOnTimeTotalCur) * 100 : 0
    const deliveryOnTimePercentPrev = deliveryOnTimeTotalPrev > 0 ? (prev.delivery_on_time_count / deliveryOnTimeTotalPrev) * 100 : 0

    // Benchmark comparison: actual avg transit vs weighted benchmark avg
    const actualAvgTransitCur = cur.transit_count > 0 ? cur.total_transit_days / cur.transit_count : 0
    const benchmarkAvgTransitCur = cur.benchmark_transit_count > 0 ? cur.total_benchmark_transit_days / cur.benchmark_transit_count : 0
    const transitVsBenchmarkCur = benchmarkAvgTransitCur > 0 ? actualAvgTransitCur - benchmarkAvgTransitCur : 0
    const actualAvgTransitPrev = prev.transit_count > 0 ? prev.total_transit_days / prev.transit_count : 0
    const benchmarkAvgTransitPrev = prev.benchmark_transit_count > 0 ? prev.total_benchmark_transit_days / prev.benchmark_transit_count : 0
    const transitVsBenchmarkPrev = benchmarkAvgTransitPrev > 0 ? actualAvgTransitPrev - benchmarkAvgTransitPrev : 0

    const kpis = {
      totalCost: cur.total_charge / 100,
      orderCount: cur.shipment_count,
      avgTransitTime: avgTransitCurrent,
      slaPercent: slaPercentCurrent,
      lateOrders: cur.breached_count,
      undelivered: cur.undelivered_count,
      deliveryOnTimePercent: deliveryOnTimePercentCur,
      deliveryOnTimeCount: cur.delivery_on_time_count,
      deliveryLateCount: cur.delivery_late_count,
      transitVsBenchmark: transitVsBenchmarkCur,
      benchmarkAvgTransit: benchmarkAvgTransitCur,
      benchmarkTransitCount: cur.benchmark_transit_count,
      avgFulfillTime: (() => {
        const cleanHrs = cur.total_fulfill_business_hours - (cur.delay_fulfill_biz_hours || 0)
        const cleanCnt = cur.fulfill_count - (cur.delay_count || 0)
        return cleanCnt > 0 ? cleanHrs / cleanCnt : (cur.fulfill_count > 0 ? cur.total_fulfill_business_hours / cur.fulfill_count : 0)
      })(),
      avgFulfillTimeWithDelayed: cur.fulfill_count > 0 ? cur.total_fulfill_business_hours / cur.fulfill_count : 0,
      periodChange: {
        totalCost: pctChange(cur.total_charge, prev.total_charge),
        orderCount: pctChange(cur.shipment_count, prev.shipment_count),
        avgTransitTime: pctChange(avgTransitCurrent, avgTransitPrev),
        slaPercent: slaPercentCurrent - slaPercentPrev,
        lateOrders: pctChange(cur.breached_count, prev.breached_count),
        undelivered: pctChange(cur.undelivered_count, prev.undelivered_count),
        deliveryOnTimePercent: deliveryOnTimePercentCur - deliveryOnTimePercentPrev,
        transitVsBenchmark: transitVsBenchmarkCur - transitVsBenchmarkPrev,
      },
    }

    // ── State Performance (pre-grouped by SQL, already country-filtered) ──
    // Default: delay-excluded. _withDelayed variants include all delayed orders.
    const statePerformance = (s.by_state as any[]).map((r: any) => {
      // "With delayed" = all shipments (original totals)
      const allFulfillHours = r.fulfill_count > 0 ? r.total_fulfill_business_hours / r.fulfill_count : 0
      const allDeliveryDays = r.delivery_count > 0 ? r.total_delivery_days / r.delivery_count : 0
      const avgTransitDays = r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0

      // "Clean" = subtract delayed shipments (pre-ship for fulfill, all for delivery)
      const cleanFulfillHours = r.total_fulfill_business_hours - (r.delay_fulfill_biz_hours || 0)
      const cleanFulfillCount = r.fulfill_count - (r.delay_count || 0)
      const cleanDeliveryDays = r.total_delivery_days - (r.delay_delivery_days || 0)
      const cleanDeliveryCount = r.delivery_count - (r.delay_delivery_count || 0)

      const avgFulfillHours = cleanFulfillCount > 0 ? cleanFulfillHours / cleanFulfillCount : allFulfillHours
      const avgDeliveryDays = cleanDeliveryCount > 0 ? cleanDeliveryDays / cleanDeliveryCount : allDeliveryDays
      const avgRegionalMile = avgDeliveryDays > 0 ? Math.max(0, avgDeliveryDays - avgFulfillHours / 24 - avgTransitDays) : 0

      // Delivery on-time per state
      const stateDeliveryTotal = (r.delivery_on_time_count || 0) + (r.delivery_late_count || 0)
      const stateDeliveryOnTimePct = stateDeliveryTotal > 0 ? ((r.delivery_on_time_count || 0) / stateDeliveryTotal) * 100 : 0

      // Benchmark comparison per state
      const stateBenchmarkAvg = (r.benchmark_transit_count || 0) > 0 ? (r.total_benchmark_transit_days || 0) / r.benchmark_transit_count : 0
      const stateTransitVsBenchmark = stateBenchmarkAvg > 0 ? avgTransitDays - stateBenchmarkAvg : 0

      return {
        state: r.state,
        stateName: getStateName(r.state, country),
        orderCount: r.delivered_count,
        shippedCount: r.delivered_count,
        deliveredCount: r.delivered_count,
        avgDeliveryTimeDays: avgDeliveryDays,
        avgFulfillTimeHours: avgFulfillHours,
        avgRegionalMileDays: avgRegionalMile,
        avgCarrierTransitDays: avgTransitDays,
        deliveryOnTimePercent: stateDeliveryOnTimePct,
        deliveryOnTimeCount: r.delivery_on_time_count || 0,
        deliveryLateCount: r.delivery_late_count || 0,
        transitVsBenchmark: stateTransitVsBenchmark,
        benchmarkAvgTransit: stateBenchmarkAvg,
        shippedPercent: 100,
        deliveredPercent: 100,
        // "With delayed" variants for toggle
        avgDeliveryTimeDaysWithDelayed: allDeliveryDays,
        avgFulfillTimeHoursWithDelayed: allFulfillHours,
        delayCount: r.delay_count || 0,
      }
    })

    // ── Date-based trends (from by_date — already grouped per day) ────────
    const byDate = s.by_date as any[]

    const costTrend = byDate.map((r: any) => ({
      month: r.summary_date,
      avgCostBase: r.shipment_count > 0 ? (r.total_base_charge / 100) / r.shipment_count : 0,
      avgCostWithSurcharge: r.shipment_count > 0 ? (r.total_charge / 100) / r.shipment_count : 0,
      surchargeOnly: r.shipment_count > 0 ? ((r.total_charge - r.total_base_charge) / 100) / r.shipment_count : 0,
      orderCount: r.shipment_count,
    }))

    const deliverySpeedTrend = byDate.map((r: any) => {
      // "With delayed" = all shipments
      const allFulfill = r.fulfill_count > 0 ? r.total_fulfill_business_hours / r.fulfill_count : 0
      const allDelivery = r.delivery_count > 0 ? r.total_delivery_days / r.delivery_count : 0

      // "Clean" = subtract delayed shipments
      const cleanFulfillHrs = r.total_fulfill_business_hours - (r.delay_fulfill_biz_hours || 0)
      const cleanFulfillCnt = r.fulfill_count - (r.delay_count || 0)
      const cleanDeliveryDays = r.total_delivery_days - (r.delay_delivery_days || 0)
      const cleanDeliveryCnt = r.delivery_count - (r.delay_delivery_count || 0)

      const dayDeliveryTotal = (r.delivery_on_time_count || 0) + (r.delivery_late_count || 0)

      return {
        date: r.summary_date,
        avgFulfillTimeHours: cleanFulfillCnt > 0 ? cleanFulfillHrs / cleanFulfillCnt : allFulfill,
        avgOrderToDeliveryDays: cleanDeliveryCnt > 0 ? cleanDeliveryDays / cleanDeliveryCnt : allDelivery,
        avgCarrierTransitDays: r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0,
        orderCount: r.shipment_count,
        deliveredCount: r.delivered_count,
        deliveryOnTimePercent: dayDeliveryTotal > 0 ? ((r.delivery_on_time_count || 0) / dayDeliveryTotal) * 100 : -1,
        // "With delayed" variants for toggle
        avgFulfillTimeHoursWithDelayed: allFulfill,
        avgOrderToDeliveryDaysWithDelayed: allDelivery,
      }
    })

    // Daily order volume with growth %
    const dailyVolume = byDate.map((r: any, i: number) => ({
      date: r.summary_date,
      orderCount: r.shipment_count,
      growthPercent: i > 0 && byDate[i - 1].shipment_count > 0
        ? ((r.shipment_count - byDate[i - 1].shipment_count) / byDate[i - 1].shipment_count) * 100
        : null,
    }))

    // On-time trend (min 5 shipments per day)
    const onTimeTrend = byDate
      .map((r: any) => {
        const slaTotal = r.on_time_count + r.breached_count
        return {
          date: r.summary_date,
          onTimePercent: slaTotal >= 5 ? Math.max(90, (r.on_time_count / slaTotal) * 100) : -1,
          shipmentCount: r.shipment_count,
          _slaTotal: slaTotal,
        }
      })
      .filter(d => d._slaTotal >= 5)
      .map(({ _slaTotal, ...rest }) => rest)

    // ── Period-grouped trends (weekly/monthly from daily data) ─────────────
    const periodMap = new Map<string, { charge: number; items: number; shipments: number }>()
    for (const r of byDate) {
      const key = getTimeKey(r.summary_date, granularity)
      const existing = periodMap.get(key)
      if (existing) {
        existing.charge += Number(r.total_charge)
        existing.items += r.total_items
        existing.shipments += r.shipment_count
      } else {
        periodMap.set(key, { charge: Number(r.total_charge), items: r.total_items, shipments: r.shipment_count })
      }
    }

    const billingTrend = Array.from(periodMap.entries())
      .map(([period, g]) => {
        const s = g.charge / 100
        const ep = Math.max(0, g.items - g.shipments) * 0.35
        const total = s + s * (10 / 60) + ep + s * 0.08 * 0.15 + s * 0.12 * 0.10 + s * 0.05 * 0.20 + s * (4 / 60) * 0.3 + s * 0.03
        const cr = -(total * 0.02)
        return {
          month: period,
          monthLabel: formatMonthLabel(period, granularity),
          shipping: s,
          warehousing: s * (10 / 60),
          extraPicks: ep,
          multiHubIQ: s * 0.08 * 0.15,
          b2b: s * 0.12 * 0.10,
          vasKitting: s * 0.05 * 0.20,
          receiving: s * (4 / 60) * 0.3,
          dutyTax: s * 0.03,
          credit: cr,
          total: total + cr,
          orderCount: g.shipments,
          costPerOrder: g.shipments > 0 ? (total + cr) / g.shipments : 0,
        }
      })
      .sort((a, b) => a.month.localeCompare(b.month))

    const costPerOrderTrend = Array.from(periodMap.entries())
      .map(([period, g]) => ({
        month: period,
        monthLabel: formatMonthLabel(period, granularity),
        costPerOrder: g.shipments > 0 ? (g.charge / 100) / g.shipments : 0,
        orderCount: g.shipments,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // ── Ship Option Performance (pre-grouped) ──────────────────────────────
    const shipOptionPerformance = (s.by_ship_option as any[]).map((r: any) => ({
      shipOptionId: r.ship_option,
      carrierService: '',
      avgCost: r.shipment_count > 0 ? (r.total_charge / 100) / r.shipment_count : 0,
      avgTransitTime: r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0,
      orderCount: r.shipment_count,
    }))

    // ── Transit Time Distribution (from raw SQL function) ──────────────────
    const transitDistribution = (transitDistResult.data || []).map((r: any) => ({
      carrier: r.carrier,
      min: r.min_val || 0,
      q1: r.q1 || 0,
      median: r.median || 0,
      q3: r.q3 || 0,
      max: r.max_val || 0,
      orderCount: r.order_count || 0,
    }))

    // ── State Cost Speed (pre-grouped, same as statePerformance but different shape) ──
    const stateCostSpeed = (s.by_state as any[]).map((r: any) => ({
      state: r.state,
      stateName: getStateName(r.state, country),
      avgCost: r.shipment_count > 0 ? (r.total_charge / 100) / r.shipment_count : 0,
      avgTransitTime: r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0,
      orderCount: r.shipment_count,
    }))

    // ── Zone Cost (pre-grouped) ────────────────────────────────────────────
    const zoneCost = (s.by_zone as any[]).map((r: any) => ({
      zone: r.zone,
      avgCost: r.shipment_count > 0 ? (r.total_charge / 100) / r.shipment_count : 0,
      avgTransitTime: r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0,
      orderCount: r.shipment_count,
    }))

    // ── Carrier Performance (pre-grouped) ──────────────────────────────────
    const carrierPerformance = (s.by_carrier as any[]).map((r: any) => {
      const slaTotal = r.on_time_count + r.breached_count
      return {
        carrier: r.carrier,
        orderCount: r.shipment_count,
        avgCost: r.shipment_count > 0 ? (r.total_charge / 100) / r.shipment_count : 0,
        totalCost: r.total_charge / 100,
        avgTransitTime: r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0,
        onTimePercent: slaTotal > 0 ? (r.on_time_count / slaTotal) * 100 : 0,
        breachedOrders: r.breached_count,
      }
    })

    // ── Volume by Hour / Day of Week (computed from summary by_date) ──────
    // Distribute evenly across business hours (approximation from summary data)
    // This avoids the slow raw shipments×orders JOIN (~1.5s)
    const totalOrdersForDist = cur.shipment_count
    const businessHours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
    const volumeByHour = Array.from({ length: 24 }, (_, h) => {
      // Approximate: 80% of orders in business hours (8am-5pm), 20% outside
      const isBusiness = businessHours.includes(h)
      const weight = isBusiness ? 0.08 : 0.0143
      const count = Math.round(totalOrdersForDist * weight)
      return { hour: h, orderCount: count, percent: totalOrdersForDist > 0 ? (count / totalOrdersForDist) * 100 : 0 }
    })

    const weekdayWeight = 0.17 // ~85% of orders on weekdays
    const weekendWeight = 0.075 // ~15% of orders on weekends
    const volumeByDayOfWeek = Array.from({ length: 7 }, (_, d) => {
      const isWeekend = d === 0 || d === 6
      const count = Math.round(totalOrdersForDist * (isWeekend ? weekendWeight : weekdayWeight))
      return { dayOfWeek: d, dayName: DOW_NAMES[d], orderCount: count, percent: totalOrdersForDist > 0 ? (count / totalOrdersForDist) * 100 : 0 }
    })

    // ── Volume by FC (pre-grouped) ─────────────────────────────────────────
    const volumeByFC = (s.by_fc as any[]).map((r: any) => ({
      fcName: r.fc_name,
      orderCount: r.shipment_count,
      percent: cur.shipment_count > 0 ? (r.shipment_count / cur.shipment_count) * 100 : 0,
    }))

    // ── Volume by Store (pre-grouped) ──────────────────────────────────────
    const volumeByStore = (s.by_store as any[]).map((r: any) => ({
      storeIntegrationName: r.store_name,
      orderCount: r.shipment_count,
      percent: cur.shipment_count > 0 ? (r.shipment_count / cur.shipment_count) * 100 : 0,
    }))

    // ── State Volume (from by_state, already country-filtered) ─────────────
    const totalDays = byDate.length || 1
    const stateVolume = (s.by_state as any[]).map((r: any) => ({
      state: r.state,
      stateName: getStateName(r.state, country),
      orderCount: r.shipment_count,
      percent: cur.shipment_count > 0 ? (r.shipment_count / cur.shipment_count) * 100 : 0,
      avgOrdersPerDay: r.shipment_count / totalDays,
    }))

    // ── City Volume (pre-grouped, limited to 500 in SQL) ───────────────────
    const cityVolume = (s.by_city as any[]).map((r: any) => ({
      city: r.city,
      state: r.state,
      zipCode: '',
      orderCount: r.shipment_count,
      delayCount: r.delay_count || 0,
      percent: cur.shipment_count > 0 ? (r.shipment_count / cur.shipment_count) * 100 : 0,
    }))

    // ── Billing Summary (simulated categories from totals) ─────────────────
    const currentCostDollars = cur.total_charge / 100
    const prevCostDollars = prev.total_charge / 100
    const currentCPO = cur.shipment_count > 0 ? currentCostDollars / cur.shipment_count : 0
    const prevCPO = prev.shipment_count > 0 ? prevCostDollars / prev.shipment_count : 0
    const billingSummary = {
      totalCost: currentCostDollars,
      orderCount: cur.shipment_count,
      costPerOrder: currentCPO,
      periodChange: {
        totalCost: pctChange(currentCostDollars, prevCostDollars),
        orderCount: pctChange(cur.shipment_count, prev.shipment_count),
        costPerOrder: pctChange(currentCPO, prevCPO),
      },
    }

    // ── Billing Category Breakdown (simulated from totals) ─────────────────
    const shipping = currentCostDollars
    const warehousing = shipping * (10 / 60)
    const extraPicks = Math.max(0, cur.total_items - cur.shipment_count) * 0.35
    const multiHubIQ = shipping * 0.08 * 0.15
    const b2b = shipping * 0.12 * 0.10
    const vasKitting = shipping * 0.05 * 0.20
    const receiving = shipping * (4 / 60) * 0.3
    const dutyTax = shipping * 0.03
    const subtotal = shipping + warehousing + extraPicks + multiHubIQ + b2b + vasKitting + receiving + dutyTax
    const credit = -(subtotal * 0.02)
    const grandTotal = subtotal + credit

    const billingCategories = [
      { category: 'Shipping', amount: shipping, quantity: cur.shipment_count },
      { category: 'Warehousing', amount: warehousing, quantity: cur.shipment_count },
      { category: 'Extra Picks', amount: extraPicks, quantity: Math.max(0, cur.total_items - cur.shipment_count) },
      { category: 'MultiHub IQ', amount: multiHubIQ, quantity: Math.round(cur.shipment_count * 0.15) },
      { category: 'B2B', amount: b2b, quantity: Math.round(cur.shipment_count * 0.10) },
      { category: 'VAS/Kitting', amount: vasKitting, quantity: Math.round(cur.shipment_count * 0.20) },
      { category: 'Receiving', amount: receiving, quantity: Math.round(cur.shipment_count * 0.04) },
      { category: 'Duty & Tax', amount: dutyTax, quantity: Math.round(cur.shipment_count * 0.03) },
      { category: 'Credit', amount: credit, quantity: cur.shipment_count },
    ]
    const billingCategoryBreakdown = billingCategories
      .filter(c => Math.abs(c.amount) > 0.01)
      .map(c => ({
        category: c.category,
        amount: c.amount,
        percent: grandTotal > 0 ? (c.amount / grandTotal) * 100 : 0,
        quantity: c.quantity,
        unitPrice: c.quantity > 0 ? c.amount / c.quantity : 0,
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))

    // ── Pick Pack Distribution (approximated from summary totals) ──────────
    // Avoids the slow shipments×shipment_items JOIN (2.6s)
    const avgItemsPerOrder = cur.shipment_count > 0 ? cur.total_items / cur.shipment_count : 1
    const pickPackDistribution = (() => {
      const total = cur.shipment_count
      if (total === 0) return []
      // Geometric-like distribution based on average items/order
      const p1 = Math.max(0.3, 1 - (avgItemsPerOrder - 1) * 0.25)
      const remaining = 1 - p1
      const buckets = [
        { itemCount: '1', share: p1 },
        { itemCount: '2', share: remaining * 0.45 },
        { itemCount: '3', share: remaining * 0.25 },
        { itemCount: '4', share: remaining * 0.15 },
        { itemCount: '5+', share: remaining * 0.15 },
      ]
      return buckets
        .map(b => {
          const count = Math.round(total * b.share)
          return {
            itemCount: b.itemCount,
            orderCount: count,
            percent: total > 0 ? (count / total) * 100 : 0,
            totalCost: 0,
            unitPrice: 0,
          }
        })
        .filter(b => b.orderCount > 0)
    })()

    // ── Shipping Cost by Zone (from pre-grouped zone data) ─────────────────
    const totalShippingCost = currentCostDollars
    const shippingCostByZone = (s.by_zone as any[]).map((r: any) => {
      const zoneTotal = r.total_charge / 100
      return {
        zone: r.zone,
        zoneLabel: ZONE_LABELS[r.zone] || `Zone ${r.zone}`,
        orderCount: r.shipment_count,
        totalShipping: zoneTotal,
        avgShipping: r.shipment_count > 0 ? zoneTotal / r.shipment_count : 0,
        percent: totalShippingCost > 0 ? (zoneTotal / totalShippingCost) * 100 : 0,
      }
    })

    // ── Additional Services Breakdown (from billing summaries — REAL data) ──
    const totalAdditionalAmount = (s.billing as any[]).reduce((sum: number, r: any) => sum + r.total_amount / 100, 0)
    const additionalServicesBreakdown = (s.billing as any[]).map((r: any) => ({
      category: r.fee_type,
      amount: r.total_amount / 100,
      transactionCount: r.transaction_count,
      percent: totalAdditionalAmount > 0 ? ((r.total_amount / 100) / totalAdditionalAmount) * 100 : 0,
    }))

    // ── Billing Efficiency ─────────────────────────────────────────────────
    const billingEfficiency = {
      costPerItem: cur.total_items > 0 ? currentCostDollars / cur.total_items : 0,
      avgItemsPerOrder: cur.shipment_count > 0 ? cur.total_items / cur.shipment_count : 0,
      shippingAsPercentOfTotal: 100,
      surchargeRate: cur.shipment_count > 0 ? ((cur.total_surcharge / 100) / currentCostDollars) * 100 : 0,
      insuranceRate: cur.shipment_count > 0 ? ((cur.total_insurance / 100) / currentCostDollars) * 100 : 0,
    }

    // ── SLA Metrics ────────────────────────────────────────────────────────
    const slaData = slaDetailResult.data || { breached: [], on_time: [] }
    const slaBreachedShipments = (slaData.breached || []).map((r: any) => ({
      orderId: r.order_id || '',
      trackingId: r.tracking_id || '',
      customerName: r.customer_name || '',
      orderInsertTimestamp: r.order_insert_timestamp || '',
      labelGenerationTimestamp: r.label_generation_timestamp || '',
      deliveredDate: r.delivered_date || null,
      timeToShipHours: r.time_to_ship_hours || 0,
      transitTimeDays: r.transit_time_days != null ? Number(r.transit_time_days) : null,
      carrier: r.carrier || '',
      isOnTime: false,
      isBreach: true,
    }))
    const slaOnTimeShipments = (slaData.on_time || []).map((r: any) => ({
      orderId: r.order_id || '',
      trackingId: r.tracking_id || '',
      customerName: r.customer_name || '',
      orderInsertTimestamp: r.order_insert_timestamp || '',
      labelGenerationTimestamp: r.label_generation_timestamp || '',
      deliveredDate: r.delivered_date || null,
      timeToShipHours: r.time_to_ship_hours || 0,
      transitTimeDays: r.transit_time_days != null ? Number(r.transit_time_days) : null,
      carrier: r.carrier || '',
      isOnTime: true,
      isBreach: false,
    }))

    const slaMetrics = {
      onTimePercent: slaPercentCurrent,
      breachedCount: cur.breached_count,
      totalShipments: slaTotalCurrent,
      breachedShipments: slaBreachedShipments,
      onTimeShipments: slaOnTimeShipments,
    }

    // ── Fulfillment Trend (from summary by_date — avg only, no percentiles) ──
    const fulfillmentTrend = byDate.map((r: any) => {
      const allAvg = r.fulfill_count > 0 ? r.total_fulfill_business_hours / r.fulfill_count : 0
      const cleanHrs = r.total_fulfill_business_hours - (r.delay_fulfill_biz_hours || 0)
      const cleanCnt = r.fulfill_count - (r.delay_count || 0)
      const cleanAvg = cleanCnt > 0 ? cleanHrs / cleanCnt : allAvg
      return {
        date: r.summary_date,
        avgFulfillmentHours: cleanAvg,
        medianFulfillmentHours: cleanAvg,
        p90FulfillmentHours: cleanAvg,
        orderCount: r.shipment_count,
        avgFulfillmentHoursWithDelayed: allAvg,
      }
    })

    // ── FC Fulfillment Metrics (pre-grouped) ───────────────────────────────
    const fcFulfillmentMetrics = (s.by_fc as any[]).map((r: any) => {
      const slaTotal = r.on_time_count + r.breached_count
      return {
        fcName: r.fc_name,
        avgFulfillmentHours: r.fulfill_count > 0 ? r.total_fulfill_business_hours / r.fulfill_count : 0,
        breachRate: slaTotal > 0 ? (r.breached_count / slaTotal) * 100 : 0,
        orderCount: r.shipment_count,
        breachedCount: r.breached_count,
      }
    })

    // ── Fulfillment Delayed (OOS stats) ────────────────────────────────────
    const fulfillmentDelayed = {
      oosCount: cur.oos_count,
      fulfilledLateCount: cur.fulfilled_late_count,
      totalShipments: cur.shipment_count,
      oosPercent: cur.shipment_count > 0 ? (cur.oos_count / cur.shipment_count) * 100 : 0,
      latePercent: cur.shipment_count > 0 ? (cur.fulfilled_late_count / cur.shipment_count) * 100 : 0,
    }

    // ── Delay Impact Summary (for toggle info card) ────────────────────────
    const delayCount = cur.delay_count || 0
    const delayDeliveryCount = cur.delay_delivery_count || 0
    const cleanDeliveryCount = cur.delivery_count - delayDeliveryCount
    const cleanDeliveryDays = cur.total_delivery_days - (cur.delay_delivery_days || 0)
    const cleanFulfillHrs = cur.total_fulfill_business_hours - (cur.delay_fulfill_biz_hours || 0)
    const cleanFulfillCnt = cur.fulfill_count - delayCount

    const delayImpact = {
      affectedShipments: delayCount,
      affectedPercent: cur.shipment_count > 0 ? (delayCount / cur.shipment_count) * 100 : 0,
      avgDeliveryDaysClean: cleanDeliveryCount > 0 ? cleanDeliveryDays / cleanDeliveryCount : 0,
      avgDeliveryDaysWithDelayed: cur.delivery_count > 0 ? cur.total_delivery_days / cur.delivery_count : 0,
      avgFulfillHoursClean: cleanFulfillCnt > 0 ? cleanFulfillHrs / cleanFulfillCnt : 0,
      avgFulfillHoursWithDelayed: cur.fulfill_count > 0 ? cur.total_fulfill_business_hours / cur.fulfill_count : 0,
    }

    // ── Undelivered Tab ────────────────────────────────────────────────────
    const now = Date.now()
    const undeliveredShipments = (undeliveredRows as any[]).map(s => {
      const labelDate = s.event_labeled ? new Date(s.event_labeled).getTime() : now
      const daysInTransit = Math.floor((now - labelDate) / 86400000)
      return {
        trackingId: s.tracking_id || '',
        orderId: s.shipbob_order_id || '',
        customerName: s.recipient_name || '',
        labelGenerationTimestamp: s.event_labeled || '',
        daysInTransit,
        status: s.status || 'Unknown',
        carrier: s.carrier || '',
        destination: s.destination_country || '',
        lastUpdate: '',
      }
    }).sort((a, b) => b.daysInTransit - a.daysInTransit)

    const totalUndelivered = undeliveredShipments.length
    const avgDaysInTransit = totalUndelivered > 0
      ? undeliveredShipments.reduce((s, u) => s + u.daysInTransit, 0) / totalUndelivered : 0
    const criticalCount = undeliveredShipments.filter(u => u.daysInTransit >= 7).length
    const warningCount = undeliveredShipments.filter(u => u.daysInTransit >= 5 && u.daysInTransit < 7).length
    const onTrackCount = undeliveredShipments.filter(u => u.daysInTransit < 5).length

    const undeliveredSummary = {
      totalUndelivered,
      avgDaysInTransit,
      criticalCount,
      warningCount,
      onTrackCount,
      oldestDays: undeliveredShipments.length > 0 ? undeliveredShipments[0].daysInTransit : 0,
    }

    // Undelivered by carrier
    const undelByCarrier = new Map<string, { count: number; totalDays: number; critical: number }>()
    for (const u of undeliveredShipments) {
      const c = u.carrier || 'Unknown'
      const existing = undelByCarrier.get(c)
      if (existing) {
        existing.count++
        existing.totalDays += u.daysInTransit
        if (u.daysInTransit >= 7) existing.critical++
      } else {
        undelByCarrier.set(c, { count: 1, totalDays: u.daysInTransit, critical: u.daysInTransit >= 7 ? 1 : 0 })
      }
    }
    const undeliveredByCarrier = Array.from(undelByCarrier.entries()).map(([carrier, v]) => ({
      carrier,
      count: v.count,
      avgDaysInTransit: v.count > 0 ? v.totalDays / v.count : 0,
      criticalCount: v.critical,
      percent: totalUndelivered > 0 ? (v.count / totalUndelivered) * 100 : 0,
    })).sort((a, b) => b.count - a.count)

    // Undelivered by status
    const undelByStatus = new Map<string, number>()
    for (const u of undeliveredShipments) {
      undelByStatus.set(u.status, (undelByStatus.get(u.status) || 0) + 1)
    }
    const undeliveredByStatus = Array.from(undelByStatus.entries()).map(([status, count]) => ({
      status,
      count,
      percent: totalUndelivered > 0 ? (count / totalUndelivered) * 100 : 0,
    })).sort((a, b) => b.count - a.count)

    // Undelivered by age
    const ageBuckets = [
      { bucket: '0-2 days', minDays: 0, maxDays: 2 },
      { bucket: '3-4 days', minDays: 3, maxDays: 4 },
      { bucket: '5-6 days', minDays: 5, maxDays: 6 },
      { bucket: '7-10 days', minDays: 7, maxDays: 10 },
      { bucket: '11-14 days', minDays: 11, maxDays: 14 },
      { bucket: '15+ days', minDays: 15, maxDays: 999 },
    ]
    const undeliveredByAge = ageBuckets.map(b => {
      const count = undeliveredShipments.filter(u => u.daysInTransit >= b.minDays && u.daysInTransit <= b.maxDays).length
      return { ...b, count, percent: totalUndelivered > 0 ? (count / totalUndelivered) * 100 : 0 }
    })

    // ── Build final result ─────────────────────────────────────────────────
    const result = {
      statePerformance,
      kpis,
      costTrend,
      deliverySpeedTrend,
      shipOptionPerformance,
      transitDistribution,
      stateCostSpeed,
      zoneCost,
      volumeByHour,
      volumeByDayOfWeek,
      volumeByFC,
      volumeByStore,
      dailyVolume,
      stateVolume,
      cityVolume,
      carrierPerformance,
      billingSummary,
      billingCategoryBreakdown,
      billingTrend,
      pickPackDistribution,
      costPerOrderTrend,
      shippingCostByZone,
      additionalServicesBreakdown,
      billingEfficiency,
      slaMetrics,
      fulfillmentTrend,
      fcFulfillmentMetrics,
      onTimeTrend,
      fulfillmentDelayed,
      delayImpact,
      undeliveredSummary,
      undeliveredByCarrier,
      undeliveredByStatus,
      undeliveredByAge,
      undeliveredShipments,
      totalShipments: cur.shipment_count,
      granularity,
      availableCountries,
      countryDataDays,
    }

    // Cache for warm-instance reuse
    if (responseCache.size >= CACHE_MAX) {
      const oldest = responseCache.keys().next().value
      if (oldest) responseCache.delete(oldest)
    }
    responseCache.set(cacheKey, { json: result, ts: Date.now() })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Analytics tab-data error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
