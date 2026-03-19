import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import type { DateRangePreset } from '@/lib/analytics/types'
import { getGranularityForRange } from '@/lib/analytics/types'
import { US_STATES, CA_PROVINCES, AU_STATES } from '@/lib/destination-data'
import usCitiesData from '@/lib/analytics/us-cities-coords.json'
import caCitiesData from '@/lib/analytics/ca-cities-coords.json'

// City coordinates lookup (module-level, computed once per cold start)
const cityCoords = new Map<string, { lon: number; lat: number }>(
  [...usCitiesData, ...caCitiesData].map((c: any) => [c.key, { lon: c.lon, lat: c.lat }])
)

export const maxDuration = 60

const PAGE_SIZE = 1000

// ── Module-level cache (persists across warm Vercel invocations) ──────────
const responseCache = new Map<string, { json: any; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 50

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
    return `${months[parseInt(m) - 1]} ${y.slice(2)}`
  }
  const [y, m, d] = key.split('-')
  if (granularity === 'weekly') {
    return `${months[parseInt(m) - 1]} ${parseInt(d)}`
  }
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
  const rawEndDate = searchParams.get('endDate')
  const datePreset = (searchParams.get('datePreset') || '30d') as DateRangePreset
  const country = searchParams.get('country') || 'US'
  const timezone = searchParams.get('timezone') || 'America/New_York'
  const tab = searchParams.get('tab') || 'all'
  const domesticOnly = searchParams.get('domesticOnly') === 'true'

  // Tab-based lazy loading: skip expensive raw-table queries unless the active tab needs them
  const needsTransit = tab === 'all' || tab === 'carriers-zones' || tab === 'cost-speed'
  const needsSLA = tab === 'all' || tab === 'sla'
  const needsUndelivered = tab === 'all' || tab === 'undelivered'
  const needsOrderVolume = tab === 'all' || tab === 'order-volume'

  if (!startDate || !rawEndDate) {
    return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 })
  }

  // Never include today — charges won't be fully synced/marked up until overnight crons run
  const todayStr = new Date().toISOString().substring(0, 10)
  const yesterdayDate = new Date()
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1)
  const yesterdayStr = yesterdayDate.toISOString().substring(0, 10)
  const endDate = rawEndDate >= todayStr ? yesterdayStr : rawEndDate

  // ── Check cache ────────────────────────────────────────────────────────
  const cacheKey = `v11:${clientId}:${startDate}:${endDate}:${datePreset}:${country}:${timezone}:${tab}:${domesticOnly}`
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

  // Extend trend start date backwards to compensate for tail trimming + rolling avg edges
  // This way, after trimming unreliable tail days, the chart still shows the full requested range
  const TREND_BUFFER_DAYS = 10
  const trendStart = new Date(startDate + 'T00:00:00Z')
  trendStart.setUTCDate(trendStart.getUTCDate() - TREND_BUFFER_DAYS)
  const trendStartDate = trendStart.toISOString().substring(0, 10)

  try {
    // ── Tab-based lazy loading: core queries always run, expensive raw-table queries only when needed ──
    // Wrap each query with timing for diagnostics
    const t0 = Date.now()
    const timed = <T>(label: string, promise: Promise<T>): Promise<T> => {
      const s = Date.now()
      return promise.then(r => { console.log(`[analytics] ${label}: ${Date.now() - s}ms`); return r })
    }

    const [
      summaryResult,
      transitDistResult,
      slaDetailResult,
      undeliveredRows,
      clientResult,
      fcNamesResult,
      fcLookupResult,
      hourDistResult,
      dowDistResult,
      orderVolumeResult,
      revenueResult,
      invoicesResult,
    ] = await Promise.all([
      // Core: Single RPC — all GROUP BY queries from pre-aggregated summaries (~100ms)
      timed('summaries', supabase.rpc('get_analytics_from_summaries', {
        p_client_id: clientId,
        p_start: startDate,
        p_end: endDate,
        p_prev_start: prevStartDate,
        p_prev_end: prevEndDate,
        p_country: country,
        p_trend_start: trendStartDate,
        p_domestic_only: domesticOnly,
      })),

      // Transit distribution — raw shipments scan (~545ms), only for carriers/cost-speed tabs
      needsTransit
        ? timed('transit', supabase.rpc('get_transit_distribution', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }))
        : { data: null, error: null },

      // SLA detail records — raw shipments scan (~457ms), only for SLA tab
      needsSLA
        ? timed('sla', supabase.rpc('get_sla_detail_records', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }))
        : { data: null, error: null },

      // Undelivered shipments — cursor pagination on raw shipments, only for undelivered tab
      needsUndelivered
        ? timed('undelivered', cursorPaginate((lastId) => {
            let q = supabase.from('shipments')
              .select('id, tracking_id, shipbob_order_id, recipient_name, event_labeled, carrier, status, destination_country, fc_name')
              .eq('client_id', clientId!)
              .is('deleted_at', null)
              .is('event_delivered', null)
              .gte('event_labeled', startDate!)
              .lte('event_labeled', endDate + 'T23:59:59.999Z')
              .order('id', { ascending: true })
              .limit(PAGE_SIZE)
            if (lastId) q = q.gt('id', lastId)
            return q
          }))
        : ([] as any[]),

      // Core: Client name
      timed('client', supabase.from('clients').select('company_name').eq('id', clientId!).single()),

      // Core: Distinct FC countries for this client
      timed('fcCountries', supabase.rpc('get_client_fc_countries', { p_client_id: clientId, p_start: startDate, p_end: endDate })),

      // FC name → country lookup — only needed for undelivered domestic filtering
      needsUndelivered
        ? timed('fcLookup', supabase.from('fulfillment_centers').select('name, country'))
        : { data: null, error: null },

      // Hour-of-day distribution — raw orders scan, only for order-volume tab
      needsOrderVolume
        ? timed('hourDist', supabase.rpc('get_order_hour_distribution', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_timezone: timezone, p_country: country }))
        : { data: null, error: null },

      // Day-of-week distribution — raw orders scan, only for order-volume tab
      needsOrderVolume
        ? timed('dowDist', supabase.rpc('get_order_dow_distribution', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_timezone: timezone, p_country: country }))
        : { data: null, error: null },

      // Order Volume breakdowns by purchase_date — raw orders scan, only for order-volume tab
      needsOrderVolume
        ? timed('orderVolume', supabase.rpc('get_order_volume_by_purchase_date', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_timezone: timezone, p_country: country }))
        : { data: null, error: null },

      // Core: Total revenue for billing efficiency (always ALL — only used by Financials tab which is locked to ALL)
      timed('revenue', supabase.rpc('get_total_revenue', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_country: 'ALL' })),

      // Core: Invoice category breakdown for Financials
      timed('invoices', supabase.rpc('get_invoice_billing_breakdown', { p_client_id: clientId, p_start: startDate, p_end: endDate })),
    ]) as any[]
    console.log(`[analytics] All queries done in ${Date.now() - t0}ms (tab=${tab})`)

    // Available countries from RPC (distinct FC countries for this client in date range)
    const fcCountryRows = fcNamesResult.data || []
    const availableCountries: string[] = fcCountryRows.map((r: any) => String(r.country)).filter(Boolean)
    if (!availableCountries.includes('US')) availableCountries.unshift('US')
    const countryDataDays: Record<string, number> = {}
    for (const r of fcCountryRows) { countryDataDays[String(r.country)] = Number(r.data_days) || 0 }

    // ── Billing period types (used by both invoice map and trend computation) ──
    type BillingPeriod = { shipping: number; surcharges: number; warehousing: number; extraPicks: number; multiHubIQ: number; b2b: number; vasKitting: number; receiving: number; returns: number; dutyTax: number; other: number; credit: number; shipments: number }
    const emptyPeriod = (): BillingPeriod => ({ shipping: 0, surcharges: 0, warehousing: 0, extraPicks: 0, multiHubIQ: 0, b2b: 0, vasKitting: 0, receiving: 0, returns: 0, dutyTax: 0, other: 0, credit: 0, shipments: 0 })

    // ── Fee type → UI category mapping ─────────────────────────────────────
    const feeTypeToCategory = (feeType: string): string => {
      if (feeType === 'Per Pick Fee') return 'extraPicks'
      if (feeType === 'Warehousing Fee') return 'warehousing'
      if (feeType === 'WRO Receiving Fee' || feeType === 'URO Storage Fee') return 'receiving'
      if (feeType.startsWith('B2B')) return 'b2b'
      if (feeType === 'Inventory Placement Program Fee') return 'multiHubIQ'
      if (feeType === 'VAS - Paid Requests' || feeType === 'Kitting Fee') return 'vasKitting'
      if (feeType === 'Credit') return 'credit'
      if (feeType.includes('Return') || feeType === 'Return to sender - Processing Fees') return 'returns'
      if (feeType.toLowerCase().includes('tax') || feeType.toLowerCase().includes('gst')
        || feeType.toLowerCase().includes('hst') || feeType.toLowerCase().includes('pst')
        || feeType.toLowerCase().includes('duty')) return 'dutyTax'
      return 'other'
    }

    // Build invoice data map: period_start → full category breakdown from invoice line items
    // For invoiced weeks, this replaces pre-aggregated summaries (which drift after invoicing)
    type InvoicePeriod = BillingPeriod & { invoiceTotal: number }
    const invoiceDataMap = new Map<string, InvoicePeriod>()
    for (const row of (invoicesResult.data || []) as any[]) {
      const key = (row.period_start || '').substring(0, 10)
      if (!key) continue
      if (!invoiceDataMap.has(key)) {
        invoiceDataMap.set(key, { ...emptyPeriod(), invoiceTotal: Number(row.invoice_total) })
      }
      const p = invoiceDataMap.get(key)!
      const amount = Number(row.category_total) || 0
      const tax = Number(row.tax_total) || 0
      const surcharge = Number(row.surcharge_total) || 0
      const lc = row.line_category as string
      const ft = row.fee_type as string || ''
      // Route tax from all line items into dutyTax
      p.dutyTax += tax
      if (lc === 'Shipping') {
        p.shipping += amount - surcharge
        p.surcharges += surcharge
        p.shipments += Number(row.item_count) || 0
      } else if (lc === 'Pick Fees') {
        p.extraPicks += amount
      } else if (lc === 'Storage') {
        p.warehousing += amount
      } else if (lc === 'B2B Fees') {
        p.b2b += amount
      } else if (lc === 'Returns') {
        p.returns += amount
      } else if (lc === 'Receiving') {
        p.receiving += amount
      } else if (lc === 'Credits') {
        p.credit += amount
      } else if (lc === 'Additional Services') {
        const cat = feeTypeToCategory(ft)
        if (cat === 'multiHubIQ') p.multiHubIQ += amount
        else if (cat === 'vasKitting') p.vasKitting += amount
        else if (cat === 'dutyTax') p.dutyTax += amount
        else p.other += amount
      } else {
        p.other += amount
      }
    }

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
      avgDeliveryDays: cur.delivery_count > 0 ? cur.total_delivery_days / cur.delivery_count : 0,
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

    // ── Performance City Data (from core RPC — analytics_city_summaries) ────
    const totalShipments = cur.shipment_count || 1
    const perfCityData = ((s.by_city || []) as any[]).map((r: any) => ({
      city: r.city,
      state: r.state,
      orderCount: r.shipment_count,
      delayCount: r.delay_count || 0,
      percent: (r.shipment_count / totalShipments) * 100,
    }))

    // ── Date-based trends (from by_date — already grouped per day) ────────
    const byDate = s.by_date as any[]

    // Rolling average window size based on date range preset
    const halfWindow = datePreset === '14d' ? 0
      : datePreset === '30d' ? 1
      : datePreset === '60d' ? 2
      : 3 // 90d, 6mo, 1yr, all, custom

    // Cost trend with rolling average
    const rawCost = byDate
      .filter((r: any) => !(r.shipment_count > 0 && r.total_charge === 0 && r.total_base_charge === 0))
      .map((r: any) => ({
        date: r.summary_date,
        baseCharge: Number(r.total_base_charge) || 0,
        totalCharge: Number(r.total_charge) || 0,
        shipmentCount: r.shipment_count,
      }))

    const costTrendAll = rawCost.map((d, i) => {
      let sumBase = 0, sumTotal = 0, sumShipments = 0
      for (let j = Math.max(0, i - halfWindow); j <= Math.min(rawCost.length - 1, i + halfWindow); j++) {
        sumBase += rawCost[j].baseCharge
        sumTotal += rawCost[j].totalCharge
        sumShipments += rawCost[j].shipmentCount
      }
      return {
        month: d.date,
        avgCostBase: sumShipments > 0 ? (sumBase / 100) / sumShipments : 0,
        avgCostWithSurcharge: sumShipments > 0 ? (sumTotal / 100) / sumShipments : 0,
        surchargeOnly: sumShipments > 0 ? ((sumTotal - sumBase) / 100) / sumShipments : 0,
        orderCount: d.shipmentCount,
      }
    })
    // Trim buffer days — only show dates within the user's requested range
    const costTrend = costTrendAll.filter(d => d.month >= startDate!)

    // Build raw daily sums for 7-day rolling average calculation
    const rawDays = byDate.map((r: any) => {
      const deliveredRatio = r.shipment_count > 0 ? r.delivered_count / r.shipment_count : 0
      const hasReliable = deliveredRatio >= 0.20 && r.delivered_count >= 5
      const dayDeliveryTotal = (r.delivery_on_time_count || 0) + (r.delivery_late_count || 0)
      return {
        date: r.summary_date,
        hasReliable,
        shipmentCount: r.shipment_count,
        deliveredCount: r.delivered_count,
        // Raw sums for weighted rolling averages
        fulfillHrs: r.total_fulfill_business_hours - (r.delay_fulfill_biz_hours || 0),
        fulfillCnt: r.fulfill_count - (r.delay_count || 0),
        allFulfillHrs: r.total_fulfill_business_hours,
        allFulfillCnt: r.fulfill_count,
        deliveryDays: r.total_delivery_days - (r.delay_delivery_days || 0),
        deliveryCnt: r.delivery_count - (r.delay_delivery_count || 0),
        allDeliveryDays: r.total_delivery_days,
        allDeliveryCnt: r.delivery_count,
        transitDays: r.total_transit_days,
        transitCnt: r.transit_count,
        onTimeCount: r.delivery_on_time_count || 0,
        deliveryTotal: dayDeliveryTotal,
      }
    })

    // Trim trailing days where delivery data is unreliable
    let lastReliableIdx = rawDays.length - 1
    while (lastReliableIdx >= 0 && !rawDays[lastReliableIdx].hasReliable) {
      lastReliableIdx--
    }
    const trimmed = rawDays.slice(0, lastReliableIdx + 1)

    const deliverySpeedTrendAll = trimmed.map((d, i) => {
      let wFulfillHrs = 0, wFulfillCnt = 0
      let wAllFulfillHrs = 0, wAllFulfillCnt = 0
      let wDeliveryDays = 0, wDeliveryCnt = 0
      let wAllDeliveryDays = 0, wAllDeliveryCnt = 0
      let wTransitDays = 0, wTransitCnt = 0
      let wOnTime = 0, wDeliveryTotal = 0

      for (let j = Math.max(0, i - halfWindow); j <= Math.min(trimmed.length - 1, i + halfWindow); j++) {
        const w = trimmed[j]
        wFulfillHrs += w.fulfillHrs; wFulfillCnt += w.fulfillCnt
        wAllFulfillHrs += w.allFulfillHrs; wAllFulfillCnt += w.allFulfillCnt
        wDeliveryDays += w.deliveryDays; wDeliveryCnt += w.deliveryCnt
        wAllDeliveryDays += w.allDeliveryDays; wAllDeliveryCnt += w.allDeliveryCnt
        wTransitDays += w.transitDays; wTransitCnt += w.transitCnt
        wOnTime += w.onTimeCount; wDeliveryTotal += w.deliveryTotal
      }

      const avgFulfill = wFulfillCnt > 0 ? wFulfillHrs / wFulfillCnt : 0
      const avgFulfillAll = wAllFulfillCnt > 0 ? wAllFulfillHrs / wAllFulfillCnt : 0
      const avgOTD = wDeliveryCnt > 0 ? wDeliveryDays / wDeliveryCnt : null
      const avgOTDAll = wAllDeliveryCnt > 0 ? wAllDeliveryDays / wAllDeliveryCnt : null
      const avgTransit = wTransitCnt > 0 ? wTransitDays / wTransitCnt : null

      // Middle Mile = order-to-delivery - fulfillment/24 - carrier transit
      const middleMile = (avgOTD !== null && avgTransit !== null && avgOTD > 0)
        ? Math.max(0, avgOTD - avgFulfill / 24 - avgTransit)
        : null

      return {
        date: d.date,
        avgFulfillTimeHours: avgFulfill,
        avgOrderToDeliveryDays: avgOTD,
        avgCarrierTransitDays: avgTransit,
        middleMileDays: middleMile,
        orderCount: d.shipmentCount,
        deliveredCount: d.deliveredCount,
        deliveryOnTimePercent: wDeliveryTotal > 0 ? (wOnTime / wDeliveryTotal) * 100 : -1,
        avgFulfillTimeHoursWithDelayed: avgFulfillAll,
        avgOrderToDeliveryDaysWithDelayed: avgOTDAll,
      }
    })
    // Trim buffer days — only show dates within the user's requested range
    const deliverySpeedTrend = deliverySpeedTrendAll.filter(d => d.date >= startDate!)

    // For weekly granularity, extend start back to Monday of the first week so partial leading weeks get full data
    const weekExtendedStart = (() => {
      if (granularity !== 'weekly') return startDate!
      const d = new Date(startDate! + 'T00:00:00Z')
      const day = d.getUTCDay()
      d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)) // back to Monday
      return d.toISOString().substring(0, 10)
    })()

    // Daily order volume with growth % — uses purchase_date (not event_labeled)
    const byDateInRange = byDate.filter((r: any) => r.summary_date >= weekExtendedStart)
    const ov = orderVolumeResult.data || {}
    const ovByDate: { purchase_day: string; order_count: number }[] = ov.by_date || []
    const dailyVolume = ovByDate.map((r: any, i: number) => ({
      date: r.purchase_day,
      orderCount: r.order_count,
      growthPercent: i > 0 && ovByDate[i - 1].order_count > 0
        ? ((r.order_count - ovByDate[i - 1].order_count) / ovByDate[i - 1].order_count) * 100
        : null,
    }))

    // On-time trend (min 5 shipments per day)
    const onTimeTrend = byDateInRange
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

    // ── Period-grouped trends (real data from summaries) ─────────────────

    const periodMap = new Map<string, BillingPeriod>()

    // Shipping costs from analytics_daily_summaries (by_date) — split into base + surcharges
    for (const r of byDateInRange) {
      const key = getTimeKey(r.summary_date, granularity)
      if (!periodMap.has(key)) periodMap.set(key, emptyPeriod())
      const p = periodMap.get(key)!
      p.shipping += Number(r.total_base_charge) / 100
      p.surcharges += Number(r.total_surcharge) / 100
      p.shipments += r.shipment_count
    }

    // Non-shipping fees from analytics_billing_summaries (by_date_fee_type)
    const byDateFeeType: { summary_date: string; fee_type: string; total_amount: number }[] = s.by_date_fee_type as any[] || []
    for (const r of byDateFeeType) {
      if (r.summary_date < weekExtendedStart) continue
      const key = getTimeKey(r.summary_date, granularity)
      if (!periodMap.has(key)) periodMap.set(key, emptyPeriod())
      const p = periodMap.get(key)!
      const cat = feeTypeToCategory(r.fee_type)
      if (cat in p) {
        ;(p as any)[cat] += Number(r.total_amount) / 100
      }
    }

    // Filter out incomplete trailing weeks (current week whose Sunday hasn't passed)
    const isCompleteWeek = (mondayKey: string): boolean => {
      const monday = new Date(mondayKey + 'T00:00:00Z')
      const sunday = new Date(monday)
      sunday.setUTCDate(monday.getUTCDate() + 6)
      return sunday.toISOString().substring(0, 10) <= todayStr
    }

    // Merge invoice-backed periods into periodMap (replaces summary data for invoiced weeks/months)
    // Skip for daily granularity — invoice totals can't be meaningfully assigned to a single day;
    // the pre-aggregated daily summaries already have data spread across actual transaction dates.
    const invoiceByGranularity = new Map<string, InvoicePeriod>()
    if (granularity !== 'daily') {
      for (const [key, inv] of invoiceDataMap) {
        const gKey = getTimeKey(key, granularity)
        if (!invoiceByGranularity.has(gKey)) {
          invoiceByGranularity.set(gKey, { ...emptyPeriod(), invoiceTotal: 0 })
        }
        const merged = invoiceByGranularity.get(gKey)!
        merged.shipping += inv.shipping
        merged.surcharges += inv.surcharges
        merged.extraPicks += inv.extraPicks
        merged.warehousing += inv.warehousing
        merged.multiHubIQ += inv.multiHubIQ
        merged.b2b += inv.b2b
        merged.vasKitting += inv.vasKitting
        merged.receiving += inv.receiving
        merged.returns += inv.returns
        merged.dutyTax += inv.dutyTax
        merged.other += inv.other
        merged.credit += inv.credit
        merged.shipments += inv.shipments
        merged.invoiceTotal += inv.invoiceTotal
      }
      for (const [gKey, inv] of invoiceByGranularity) {
        periodMap.set(gKey, inv)
      }
    }

    const billingTrend = Array.from(periodMap.entries())
      .filter(([period]) => granularity !== 'weekly' || isCompleteWeek(period))
      .map(([period, p]) => {
        const inv = invoiceByGranularity.get(period)
        // For invoiced periods: use invoice total (includes tax); otherwise sum categories
        const total = inv ? inv.invoiceTotal : p.shipping + p.surcharges + p.extraPicks + p.warehousing + p.multiHubIQ + p.b2b + p.vasKitting + p.receiving + p.returns + p.dutyTax + p.other + p.credit
        // If invoice total differs from category sum, put delta in dutyTax (it's tax)
        const categorySum = p.shipping + p.surcharges + p.extraPicks + p.warehousing + p.multiHubIQ + p.b2b + p.vasKitting + p.receiving + p.returns + p.dutyTax + p.other + p.credit
        const taxRemainder = inv ? Math.round((inv.invoiceTotal - categorySum) * 100) / 100 : 0
        return {
          month: period,
          monthLabel: formatMonthLabel(period, granularity),
          shipping: p.shipping,
          surcharges: p.surcharges,
          extraPicks: p.extraPicks,
          warehousing: p.warehousing,
          multiHubIQ: p.multiHubIQ,
          b2b: p.b2b,
          vasKitting: p.vasKitting,
          receiving: p.receiving,
          returns: p.returns,
          dutyTax: p.dutyTax + taxRemainder,
          other: p.other,
          credit: p.credit,
          total,
          orderCount: p.shipments,
          costPerOrder: p.shipments > 0 ? total / p.shipments : 0,
        }
      })
      .sort((a, b) => a.month.localeCompare(b.month))

    // ── Always-weekly billing trend (for fee breakdown table) ──────────────
    // When granularity is already weekly, reuse billingTrend. Otherwise build a separate weekly map.
    let billingTrendWeekly = billingTrend
    if (granularity !== 'weekly') {
      // billingTrendWeekly is always weekly — extend start to Monday even when page granularity is daily/monthly
      const weeklyExtStart = (() => {
        const d = new Date(startDate! + 'T00:00:00Z')
        const day = d.getUTCDay()
        d.setUTCDate(d.getUTCDate() - ((day + 6) % 7))
        return d.toISOString().substring(0, 10)
      })()
      const weeklyMap = new Map<string, BillingPeriod>()
      for (const r of byDate) {
        if (r.summary_date < weeklyExtStart) continue
        const key = getTimeKey(r.summary_date, 'weekly')
        if (!weeklyMap.has(key)) weeklyMap.set(key, emptyPeriod())
        const p = weeklyMap.get(key)!
        p.shipping += Number(r.total_base_charge) / 100
        p.surcharges += Number(r.total_surcharge) / 100
        p.shipments += r.shipment_count
      }
      for (const r of byDateFeeType) {
        if (r.summary_date < weeklyExtStart) continue
        const key = getTimeKey(r.summary_date, 'weekly')
        if (!weeklyMap.has(key)) weeklyMap.set(key, emptyPeriod())
        const p = weeklyMap.get(key)!
        const cat = feeTypeToCategory(r.fee_type)
        if (cat in p) { ;(p as any)[cat] += Number(r.total_amount) / 100 }
      }
      // Merge invoice data (re-keyed to weekly) — only when not country-filtered
      // (invoices contain all countries' data; can't split by country)
      const invoiceByWeek = new Map<string, InvoicePeriod>()
      if (country === 'ALL') {
        for (const [key, inv] of invoiceDataMap) {
          const wKey = getTimeKey(key, 'weekly')
          if (!invoiceByWeek.has(wKey)) {
            invoiceByWeek.set(wKey, { ...emptyPeriod(), invoiceTotal: 0 })
          }
          const m = invoiceByWeek.get(wKey)!
          m.shipping += inv.shipping; m.surcharges += inv.surcharges; m.extraPicks += inv.extraPicks
          m.warehousing += inv.warehousing; m.multiHubIQ += inv.multiHubIQ; m.b2b += inv.b2b
          m.vasKitting += inv.vasKitting; m.receiving += inv.receiving; m.returns += inv.returns
          m.dutyTax += inv.dutyTax; m.other += inv.other; m.credit += inv.credit
          m.shipments += inv.shipments; m.invoiceTotal += inv.invoiceTotal
        }
        for (const [wKey, inv] of invoiceByWeek) {
          weeklyMap.set(wKey, inv)
        }
      }
      billingTrendWeekly = Array.from(weeklyMap.entries())
        .filter(([period]) => isCompleteWeek(period))
        .map(([period, p]) => {
          const inv = invoiceByWeek.get(period)
          const total = inv ? inv.invoiceTotal : p.shipping + p.surcharges + p.extraPicks + p.warehousing + p.multiHubIQ + p.b2b + p.vasKitting + p.receiving + p.returns + p.dutyTax + p.other + p.credit
          const categorySum = p.shipping + p.surcharges + p.extraPicks + p.warehousing + p.multiHubIQ + p.b2b + p.vasKitting + p.receiving + p.returns + p.dutyTax + p.other + p.credit
          const taxRemainder = inv ? Math.round((inv.invoiceTotal - categorySum) * 100) / 100 : 0
          return {
            month: period,
            monthLabel: formatMonthLabel(period, 'weekly'),
            shipping: p.shipping, surcharges: p.surcharges, extraPicks: p.extraPicks,
            warehousing: p.warehousing, multiHubIQ: p.multiHubIQ, b2b: p.b2b,
            vasKitting: p.vasKitting, receiving: p.receiving, returns: p.returns,
            dutyTax: p.dutyTax + taxRemainder, other: p.other, credit: p.credit,
            total, orderCount: p.shipments,
            costPerOrder: p.shipments > 0 ? total / p.shipments : 0,
          }
        })
        .sort((a, b) => a.month.localeCompare(b.month))
    }

    const costPerOrderTrend = Array.from(periodMap.entries())
      .filter(([period]) => granularity !== 'weekly' || isCompleteWeek(period))
      .map(([period, g]) => ({
        month: period,
        monthLabel: formatMonthLabel(period, granularity),
        costPerOrder: g.shipments > 0 ? (g.shipping + g.surcharges) / g.shipments : 0,
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

    // ── Carrier × Zone cross-tab (for zone distribution per carrier) ────
    const carrierZoneBreakdown = (s.by_carrier_zone as any[] || []).map((r: any) => ({
      carrier: r.carrier,
      zone: r.zone,
      orderCount: r.shipment_count,
    }))

    // ── Volume by Hour / Day of Week (real data from shipments) ─────────
    const hourRows: { hour: number; order_count: number }[] = hourDistResult.data || []
    const totalHourOrders = hourRows.reduce((sum, r) => sum + Number(r.order_count), 0)
    const hourMap = new Map(hourRows.map(r => [r.hour, Number(r.order_count)]))
    const volumeByHour = Array.from({ length: 24 }, (_, h) => {
      const count = hourMap.get(h) || 0
      return { hour: h, orderCount: count, percent: totalHourOrders > 0 ? (count / totalHourOrders) * 100 : 0 }
    })

    const dowRows: { dow: number; order_count: number }[] = dowDistResult.data || []
    const totalDowOrders = dowRows.reduce((sum, r) => sum + Number(r.order_count), 0)
    const dowMap = new Map(dowRows.map(r => [r.dow, Number(r.order_count)]))
    const volumeByDayOfWeek = Array.from({ length: 7 }, (_, d) => {
      const count = dowMap.get(d) || 0
      return { dayOfWeek: d, dayName: DOW_NAMES[d], orderCount: count, percent: totalDowOrders > 0 ? (count / totalDowOrders) * 100 : 0 }
    })

    // ── Volume by FC (purchase_date-based) ──────────────────────────────────
    const ovTotal = ov.total || 0
    const ovByFC: { fc_name: string; order_count: number }[] = ov.by_fc || []
    const volumeByFC = ovByFC.map((r: any) => ({
      fcName: r.fc_name,
      orderCount: r.order_count,
      percent: ovTotal > 0 ? (r.order_count / ovTotal) * 100 : 0,
    }))

    // ── Volume by Store (purchase_date-based) ────────────────────────────────
    const ovByStore: { store_name: string; order_count: number }[] = ov.by_store || []
    const volumeByStore = ovByStore.map((r: any) => ({
      storeIntegrationName: r.store_name,
      orderCount: r.order_count,
      percent: ovTotal > 0 ? (r.order_count / ovTotal) * 100 : 0,
    }))

    // ── State Volume (purchase_date-based) ───────────────────────────────────
    const totalDays = ovByDate.length || 1
    const ovByState: { state: string; order_count: number }[] = ov.by_state || []
    const stateVolume = ovByState.map((r: any) => ({
      state: r.state,
      stateName: getStateName(r.state, country),
      orderCount: r.order_count,
      percent: ovTotal > 0 ? (r.order_count / ovTotal) * 100 : 0,
      avgOrdersPerDay: r.order_count / totalDays,
    }))

    // ── City Volume (purchase_date-based, limited to 500 in SQL) ─────────────
    const ovByCity: { city: string; state: string; order_count: number }[] = ov.by_city || []
    const cityVolume = ovByCity.map((r: any) => {
      const key = `${(r.city || '').toUpperCase()}|${r.state}`
      const coords = cityCoords.get(key)
      return {
        city: r.city,
        state: r.state,
        zipCode: '',
        orderCount: r.order_count,
        delayCount: 0,
        percent: ovTotal > 0 ? (r.order_count / ovTotal) * 100 : 0,
        lon: coords?.lon,
        lat: coords?.lat,
      }
    })

    // ── Billing Summary (real data from summaries) ─────────────────────────
    const currentShippingDollars = cur.total_charge / 100
    const prevShippingDollars = prev.total_charge / 100
    // Add non-shipping fees from billing summaries
    const billingFees: { fee_type: string; transaction_count: number; total_amount: number }[] = s.billing as any[] || []
    const totalNonShippingFees = billingFees.reduce((sum, f) => sum + Number(f.total_amount) / 100, 0)
    const currentCostDollars = currentShippingDollars + totalNonShippingFees
    const prevCostDollars = prevShippingDollars // prev period non-shipping fees not available in single RPC call
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

    // ── Billing Category Breakdown (real data from billing summaries) ─────
    // Map real fee types to UI categories, then build breakdown
    const categoryDisplayNames: Record<string, string> = {
      extraPicks: 'Extra Picks', warehousing: 'Warehousing', receiving: 'Receiving',
      b2b: 'B2B', multiHubIQ: 'MultiHub IQ', vasKitting: 'VAS/Kitting',
      returns: 'Returns', dutyTax: 'Duty & Tax', other: 'Other', credit: 'Credit',
    }
    const categoryTotals = new Map<string, { amount: number; quantity: number }>()
    // Start with shipping (base charge) and surcharges
    const currentBaseDollars = cur.total_base_charge / 100
    const currentSurchargeDollars = cur.total_surcharge / 100
    categoryTotals.set('Shipping', { amount: currentBaseDollars, quantity: cur.shipment_count })
    categoryTotals.set('Surcharges', { amount: currentSurchargeDollars, quantity: cur.shipment_count })
    // Add each billing fee type mapped to its category
    for (const f of billingFees) {
      const cat = feeTypeToCategory(f.fee_type)
      const displayName = categoryDisplayNames[cat] || cat
      const existing = categoryTotals.get(displayName)
      const amount = Number(f.total_amount) / 100
      const qty = f.transaction_count
      if (existing) {
        existing.amount += amount
        existing.quantity += qty
      } else {
        categoryTotals.set(displayName, { amount, quantity: qty })
      }
    }
    const grandTotal = Array.from(categoryTotals.values()).reduce((s, c) => s + c.amount, 0)
    const billingCategoryBreakdown = Array.from(categoryTotals.entries())
      .filter(([, c]) => Math.abs(c.amount) > 0.01)
      .map(([category, c]) => ({
        category,
        amount: c.amount,
        percent: grandTotal !== 0 ? (c.amount / grandTotal) * 100 : 0,
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
    const additionalServicesFees = (s.billing as any[]).filter((r: any) => r.fee_type !== 'Credit')
    // Group B2B fees into one, rename Inventory Placement Program Fee
    const groupedFees = new Map<string, { amount: number; count: number }>()
    for (const r of additionalServicesFees) {
      const label = (r.fee_type as string).startsWith('B2B') ? 'B2B'
        : r.fee_type === 'Inventory Placement Program Fee' ? 'MultiHub IQ Fee'
        : r.fee_type
      const existing = groupedFees.get(label) || { amount: 0, count: 0 }
      existing.amount += r.total_amount / 100
      existing.count += r.transaction_count
      groupedFees.set(label, existing)
    }
    const totalAdditionalAmount = [...groupedFees.values()].reduce((sum, f) => sum + f.amount, 0)
    const additionalServicesBreakdown = [...groupedFees.entries()].map(([category, f]) => ({
      category,
      amount: f.amount,
      transactionCount: f.count,
      percent: totalAdditionalAmount > 0 ? (f.amount / totalAdditionalAmount) * 100 : 0,
    })).sort((a, b) => b.amount - a.amount)

    // ── Billing Efficiency ─────────────────────────────────────────────────
    // Revenue is always total (not country-filtered) so that US% + CA% ≈ ALL%
    // and the metric means "what share of total revenue goes to fulfillment from this country"
    const revenueData = revenueResult.data as any
    if (revenueResult.error) console.error('[analytics] Revenue RPC error:', revenueResult.error.message)
    const totalRevenue: number = revenueData?.total_revenue ?? 0
    const ordersWithPrice: number = revenueData?.orders_with_price ?? 0
    const billingEfficiency = {
      costPerItem: cur.total_items > 0 ? currentCostDollars / cur.total_items : 0,
      avgItemsPerOrder: cur.shipment_count > 0 ? cur.total_items / cur.shipment_count : 0,
      fulfillmentAsPercentOfRevenue: totalRevenue > 0 ? (currentCostDollars / totalRevenue) * 100 : 0,
      avgRevenuePerOrder: ordersWithPrice > 0 ? totalRevenue / ordersWithPrice : 0,
      surchargePercentOfCost: currentCostDollars > 0 ? ((cur.total_surcharge / 100) / currentCostDollars) * 100 : 0,
      totalCredits: Math.abs(billingFees.filter((f: any) => f.fee_type === 'Credit').reduce((sum: number, f: any) => sum + Number(f.total_amount) / 100, 0)),
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
    const fulfillmentTrend = byDateInRange.map((r: any) => {
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
    // Build FC name → country lookup for domestic-only filtering
    const fcCountryMap = new Map<string, string>()
    for (const fc of (fcLookupResult.data || [])) {
      if (fc.name && fc.country) fcCountryMap.set(fc.name, fc.country)
    }

    const now = Date.now()
    const undeliveredShipments = (undeliveredRows as any[])
      // Domestic-only: FC country must match destination country
      .filter(s => {
        const fcCountry = fcCountryMap.get(s.fc_name)
        return fcCountry && fcCountry === s.destination_country
      })
      .map(s => {
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

    // ── Build final result (only include tab-specific fields when computed) ──
    const result: Record<string, any> = {
      // Core fields — always included (from pre-aggregated summaries)
      statePerformance,
      perfCityData,
      kpis,
      costTrend,
      deliverySpeedTrend,
      shipOptionPerformance,
      stateCostSpeed,
      zoneCost,
      carrierPerformance,
      carrierZoneBreakdown,
      billingSummary,
      billingCategoryBreakdown,
      billingTrend,
      billingTrendWeekly,
      pickPackDistribution,
      costPerOrderTrend,
      shippingCostByZone,
      additionalServicesBreakdown,
      billingEfficiency,
      fulfillmentTrend,
      fcFulfillmentMetrics,
      onTimeTrend,
      fulfillmentDelayed,
      delayImpact,
      totalShipments: cur.shipment_count,
      granularity,
      availableCountries,
      countryDataDays,
      _loadedTab: tab,
    }

    // Tab-specific fields — only included when their expensive queries actually ran.
    // This prevents merges from overwriting real data with empty arrays.
    if (needsTransit) {
      result.transitDistribution = transitDistribution
    }
    if (needsSLA) {
      result.slaMetrics = slaMetrics
    } else {
      // Always include summary-level SLA (from summaries), but without detail records
      result.slaMetrics = {
        onTimePercent: slaPercentCurrent,
        breachedCount: cur.breached_count,
        totalShipments: slaTotalCurrent,
        breachedShipments: [],
        onTimeShipments: [],
      }
    }
    if (needsOrderVolume) {
      result.volumeByHour = volumeByHour
      result.volumeByDayOfWeek = volumeByDayOfWeek
      result.volumeByFC = volumeByFC
      result.volumeByStore = volumeByStore
      result.dailyVolume = dailyVolume
      result.stateVolume = stateVolume
      result.cityVolume = cityVolume
    }
    if (needsUndelivered) {
      result.undeliveredSummary = undeliveredSummary
      result.undeliveredByCarrier = undeliveredByCarrier
      result.undeliveredByStatus = undeliveredByStatus
      result.undeliveredByAge = undeliveredByAge
      result.undeliveredShipments = undeliveredShipments
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
