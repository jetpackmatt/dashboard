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
  const rawClientId = searchParams.get('clientId')
  let clientId: string | null
  try {
    const access = await verifyClientAccess(rawClientId)
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  // 'all' = aggregate across all clients (admin only — verifyClientAccess already enforced this)
  // verifyClientAccess returns null for 'all', so check the original param
  const isAllClients = rawClientId === 'all'

  if (!clientId && !isAllClients) {
    return NextResponse.json({ error: 'A client must be selected for analytics' }, { status: 400 })
  }

  const rpcClientId = isAllClients ? null : clientId

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
  const needsOrderVolume = tab === 'all' || tab === 'order-volume'
  const needsPerformance = tab === 'all' || tab === 'state-performance'
  const needsCarrierZone = tab === 'all' || tab === 'carriers-zones' || tab === 'cost-speed'
  const needsFinancials = tab === 'all' || tab === 'financials'

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
  const cacheKey = `v24:${clientId}:${startDate}:${endDate}:${datePreset}:${country}:${timezone}:${tab}:${domesticOnly}`
  const cached = responseCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.json)
  }

  const supabase = createAdminClient()
  const granularity = getGranularityForRange(datePreset)

  // Previous period dates — mirror the actual date range length
  const rangeMs = new Date(endDate + 'T00:00:00Z').getTime() - new Date(startDate + 'T00:00:00Z').getTime()
  const days = Math.max(1, Math.round(rangeMs / (1000 * 60 * 60 * 24)) + 1)
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
      clientResult,
      fcNamesResult,
      fcLookupResult,
      hourDistResult,
      dowDistResult,
      orderVolumeResult,
      revenueResult,
      invoicesResult,
      otdByStateCleanResult,
      otdByStateDelayedResult,
      carrierZoneResult,
      shipOptionMappingResult,
    ] = await Promise.all([
      // Core: Single RPC — all GROUP BY queries from pre-aggregated summaries (~100ms)
      timed('summaries', supabase.rpc('get_analytics_from_summaries', {
        p_client_id: rpcClientId,
        p_start: startDate,
        p_end: endDate,
        p_prev_start: prevStartDate,
        p_prev_end: prevEndDate,
        p_country: country,
        p_trend_start: trendStartDate,
        p_domestic_only: domesticOnly,
      })),

      // Transit distribution — raw shipments scan (~545ms), only for carriers/cost-speed tabs
      (needsTransit && !isAllClients)
        ? timed('transit', supabase.rpc('get_transit_distribution', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }))
        : { data: null, error: null },

      // SLA detail records — raw shipments scan (~457ms), only for SLA tab
      (needsSLA && !isAllClients)
        ? timed('sla', supabase.rpc('get_sla_detail_records', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate }))
        : { data: null, error: null },

      // Core: Client name (skip for 'all' — no single client)
      isAllClients
        ? { data: { company_name: 'All Brands' }, error: null }
        : timed('client', supabase.from('clients').select('company_name').eq('id', clientId!).single()),

      // Core: Distinct FC countries for this client
      timed('fcCountries', supabase.rpc('get_client_fc_countries', { p_client_id: rpcClientId, p_start: startDate, p_end: endDate })),

      // FC name → country lookup (for domestic filtering)
      { data: null, error: null },

      // Hour-of-day distribution — raw orders scan, only for order-volume tab
      (needsOrderVolume && !isAllClients)
        ? timed('hourDist', supabase.rpc('get_order_hour_distribution', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_timezone: timezone, p_country: country }))
        : { data: null, error: null },

      // Day-of-week distribution — raw orders scan, only for order-volume tab
      (needsOrderVolume && !isAllClients)
        ? timed('dowDist', supabase.rpc('get_order_dow_distribution', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_timezone: timezone, p_country: country }))
        : { data: null, error: null },

      // Order Volume breakdowns by purchase_date — raw orders scan, only for order-volume tab
      (needsOrderVolume && !isAllClients)
        ? timed('orderVolume', supabase.rpc('get_order_volume_by_purchase_date', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_timezone: timezone, p_country: country }))
        : { data: null, error: null },

      // Total revenue for billing efficiency (only used by Financials tab which is locked to ALL)
      (needsFinancials && !isAllClients)
        ? timed('revenue', supabase.rpc('get_total_revenue', { p_client_id: clientId, p_start: startDate, p_end: endDate, p_country: 'ALL' }))
        : { data: null, error: null },

      // Invoice category breakdown for Financials
      (needsFinancials && !isAllClients)
        ? timed('invoices', supabase.rpc('get_invoice_billing_breakdown', { p_client_id: clientId, p_start: startDate, p_end: endDate }))
        : { data: null, error: null },

      // OTD percentiles — batched: national + all states (~900ms each, parallel)
      // Clean variant (delays excluded) for default view
      (needsPerformance && !isAllClients)
        ? timed('otdByStateClean', supabase.rpc('get_otd_percentiles_by_state', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate, p_country: country, p_include_delayed: false }))
        : { data: null, error: null },
      // With-delayed variant for toggle
      (needsPerformance && !isAllClients)
        ? timed('otdByStateDelayed', supabase.rpc('get_otd_percentiles_by_state', { p_client_id: clientId, p_start_date: startDate, p_end_date: endDate, p_country: country, p_include_delayed: true }))
        : { data: null, error: null },

      // Carrier × Zone cross-tab (direct paginated query — RPC doesn't include by_carrier_zone)
      // Also includes ship_option + total_charge for ship-option filtering and cost computation
      (needsCarrierZone && !isAllClients)
        ? timed('carrierZone', (async () => {
            const allRows: any[] = []
            let lastId: string | null = null
            while (true) {
              let q = supabase
                .from('analytics_daily_summaries')
                .select('id, carrier, zone, ship_option, shipment_count, total_transit_days, transit_count, total_charge')
                .eq('client_id', clientId!)
                .gte('summary_date', startDate)
                .lte('summary_date', endDate)
                .not('carrier', 'is', null)
                .not('zone', 'is', null)
                .gt('shipment_count', 0)
                .order('id', { ascending: true })
                .limit(1000)
              if (country !== 'ALL') q = q.eq('country', country)
              if (lastId) q = q.gt('id', lastId)
              const { data, error } = await q
              if (error) return { data: null, error }
              if (!data || data.length === 0) break
              allRows.push(...data)
              lastId = data[data.length - 1].id
              if (data.length < 1000) break
            }
            return { data: allRows, error: null }
          })())
        : { data: null, error: null },

      // Distinct ship_option_name → ship_option_id mapping from shipments (for SLA tier classification)
      (needsCarrierZone && !isAllClients)
        ? timed('shipOptionMap', supabase
            .from('shipments')
            .select('ship_option_name, ship_option_id')
            .eq('client_id', clientId!)
            .gte('event_labeled', startDate)
            .lte('event_labeled', endDate + 'T23:59:59.999Z')
            .not('ship_option_name', 'is', null)
            .not('ship_option_id', 'is', null)
            .limit(1000))
        : { data: null, error: null },
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
      if (feeType === 'WRO Receiving Fee' || feeType === 'URO Storage Fee' || feeType === 'WRO Label Fee') return 'receiving'
      if (feeType.startsWith('B2B')) return 'b2b'
      if (feeType === 'Inventory Placement Program Fee') return 'multiHubIQ'
      if (feeType === 'VAS - Paid Requests' || feeType === 'Kitting Fee') return 'vasKitting'
      if (feeType === 'Credit') return 'credit'
      if (feeType.includes('Return') || feeType === 'Return to sender - Processing Fees') return 'returns'
      if (feeType.toLowerCase().includes('tax') || feeType.toLowerCase().includes('gst')
        || feeType.toLowerCase().includes('hst') || feeType.toLowerCase().includes('pst')
        || feeType.toLowerCase().includes('duty')) return 'dutyTax'
      if (feeType === 'Address Correction') return 'surcharges'
      if (feeType === 'Shipbob Freight Fee - Accessorial' || feeType.toLowerCase().includes('freight')) return 'surcharges'
      if (feeType === 'Payment') return 'credit'
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
    // SLA: exclude inventory-delayed orders (same as fulfillment time)
    const cleanOnTimeCur = cur.on_time_count - (cur.delay_on_time_count || 0)
    const cleanBreachedCur = cur.breached_count - (cur.delay_breached_count || 0)
    const slaTotalCurrent = cleanOnTimeCur + cleanBreachedCur
    const slaTotalPrev = prev.on_time_count - (prev.delay_on_time_count || 0) + prev.breached_count - (prev.delay_breached_count || 0)
    const slaPercentCurrent = slaTotalCurrent > 0 ? (cleanOnTimeCur / slaTotalCurrent) * 100 : 0
    const slaPercentPrev = slaTotalPrev > 0 ? ((prev.on_time_count - (prev.delay_on_time_count || 0)) / slaTotalPrev) * 100 : 0

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
      lateOrders: cleanBreachedCur,
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
        lateOrders: pctChange(cleanBreachedCur, prev.breached_count - (prev.delay_breached_count || 0)),
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

    // On-time trend (min 5 shipments per day) — exclude inventory-delayed orders
    const onTimeTrend = byDateInRange
      .map((r: any) => {
        const cleanOT = r.on_time_count - (r.delay_on_time_count || 0)
        const cleanBr = r.breached_count - (r.delay_breached_count || 0)
        const slaTotal = cleanOT + cleanBr
        return {
          date: r.summary_date,
          onTimePercent: slaTotal >= 5 ? (cleanOT / slaTotal) * 100 : -1,
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

    // ── Carrier Performance (pre-grouped, delay-excluded SLA) ───────────────
    const carrierPerformance = (s.by_carrier as any[]).map((r: any) => {
      const cleanOT = r.on_time_count - (r.delay_on_time_count || 0)
      const cleanBr = r.breached_count - (r.delay_breached_count || 0)
      const slaTotal = cleanOT + cleanBr
      return {
        carrier: r.carrier,
        orderCount: r.shipment_count,
        avgCost: r.shipment_count > 0 ? (r.total_charge / 100) / r.shipment_count : 0,
        totalCost: r.total_charge / 100,
        avgTransitTime: r.transit_count > 0 ? r.total_transit_days / r.transit_count : 0,
        onTimePercent: slaTotal > 0 ? (cleanOT / slaTotal) * 100 : 0,
        breachedOrders: cleanBr,
      }
    })

    // ── Carrier × Zone cross-tab (aggregated from direct summary table query) ──
    // Filter out invalid zones for the selected country (e.g., zone 196 tagged as US)
    const isValidZone = (zone: string | number): boolean => {
      const z = typeof zone === 'string' ? parseInt(zone) : zone
      if (!z || z <= 0) return false
      if (country === 'US') return z >= 1 && z <= 10
      if (country === 'CA') return z >= 1 && z <= 999
      return true // ALL or other countries — allow everything
    }
    const czRawRows: any[] = (carrierZoneResult?.data || []).filter((r: any) => isValidZone(r.zone))

    // Map ShipBob ship option names → SLA tiers
    // The summaries table `ship_option` stores ShipBob ship option names (e.g., "GlobalEDDPExpedited",
    // "UspsPriority", "FedexGround"). We bucket these into 3 SLA tiers based on service level.
    // We also query shipments for ship_option_id to help classify unknown names.
    const shipOptionIdMap = new Map<string, number>()
    const shipOptionMappingRows: any[] = shipOptionMappingResult?.data || []
    for (const r of shipOptionMappingRows) {
      if (r.ship_option_name && r.ship_option_id != null) {
        shipOptionIdMap.set(r.ship_option_name, r.ship_option_id)
      }
    }

    const getShipOptionTier = (shipOption: string | null): string => {
      if (!shipOption) return 'Standard / Economy'
      const lower = shipOption.toLowerCase().replace(/[\s-]+/g, '')

      // ── 2-Day Express ──
      if (lower.includes('2day') || lower === 'shipbob2day' || lower === 'ups2day') return '2-Day Express'

      // ── Overnight ──
      if (lower.includes('overnight') || lower.includes('1day') || lower === 'nextday') return 'Overnight'

      // ── Standard / Economy (everything else is ground-tier) ──
      // Explicit matches: standard, economy, ground, priority (USPS Priority = ground tier in ShipBob),
      // GlobalEDDPExpedited (ePost economy international), 3 Day, custom ship options, etc.
      // Any unrecognized ship option defaults here since Standard/Economy is the dominant tier
      return 'Standard / Economy'
    }

    // Build distinct ship options (for the filter dropdown)
    const shipOptionCounts = new Map<string, number>()
    for (const r of czRawRows) {
      const so = getShipOptionTier(r.ship_option)
      shipOptionCounts.set(so, (shipOptionCounts.get(so) || 0) + (Number(r.shipment_count) || 0))
    }
    const availableShipOptions = Array.from(shipOptionCounts.entries())
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))

    // Aggregate carrier × zone (all ship options)
    const czMap = new Map<string, { carrier: string; zone: string; shipments: number; transitDays: number; transitCount: number; charge: number }>()
    for (const r of czRawRows) {
      const key = `${r.carrier}::${r.zone}`
      const existing = czMap.get(key) || { carrier: r.carrier, zone: r.zone, shipments: 0, transitDays: 0, transitCount: 0, charge: 0 }
      existing.shipments += Number(r.shipment_count) || 0
      existing.transitDays += Number(r.total_transit_days) || 0
      existing.transitCount += Number(r.transit_count) || 0
      existing.charge += Number(r.total_charge) || 0
      czMap.set(key, existing)
    }
    const carrierZoneBreakdown = Array.from(czMap.values()).map(r => ({
      carrier: r.carrier,
      zone: r.zone,
      orderCount: r.shipments,
      avgTransitTime: r.transitCount > 0 ? r.transitDays / r.transitCount : 0,
    }))

    // Per-ship-option breakdowns (carrier × zone filtered by each ship option)
    const czByShipOption = new Map<string, Map<string, { carrier: string; zone: string; shipments: number; transitDays: number; transitCount: number; charge: number }>>()
    for (const r of czRawRows) {
      const so = getShipOptionTier(r.ship_option)
      if (!czByShipOption.has(so)) czByShipOption.set(so, new Map())
      const soMap = czByShipOption.get(so)!
      const key = `${r.carrier}::${r.zone}`
      const existing = soMap.get(key) || { carrier: r.carrier, zone: r.zone, shipments: 0, transitDays: 0, transitCount: 0, charge: 0 }
      existing.shipments += Number(r.shipment_count) || 0
      existing.transitDays += Number(r.total_transit_days) || 0
      existing.transitCount += Number(r.transit_count) || 0
      existing.charge += Number(r.total_charge) || 0
      soMap.set(key, existing)
    }
    // Convert to per-ship-option carrier performance + zone breakdown
    const carrierPerformanceByShipOption: Record<string, any[]> = {}
    const carrierZoneByShipOption: Record<string, any[]> = {}
    for (const [so, soMap] of czByShipOption) {
      // Aggregate by carrier for carrier performance
      const byCarrier = new Map<string, { carrier: string; shipments: number; transitDays: number; transitCount: number; charge: number }>()
      const zoneBreakdown: any[] = []
      for (const r of soMap.values()) {
        zoneBreakdown.push({
          carrier: r.carrier,
          zone: r.zone,
          orderCount: r.shipments,
          avgTransitTime: r.transitCount > 0 ? r.transitDays / r.transitCount : 0,
        })
        const bc = byCarrier.get(r.carrier) || { carrier: r.carrier, shipments: 0, transitDays: 0, transitCount: 0, charge: 0 }
        bc.shipments += r.shipments
        bc.transitDays += r.transitDays
        bc.transitCount += r.transitCount
        bc.charge += r.charge
        byCarrier.set(r.carrier, bc)
      }
      carrierPerformanceByShipOption[so] = Array.from(byCarrier.values())
        .map(c => ({
          carrier: c.carrier,
          orderCount: c.shipments,
          avgCost: c.shipments > 0 ? (c.charge / 100) / c.shipments : 0,
          totalCost: c.charge / 100,
          avgTransitTime: c.transitCount > 0 ? c.transitDays / c.transitCount : 0,
          onTimePercent: 0,
          breachedOrders: 0,
        }))
        .sort((a, b) => b.orderCount - a.orderCount)
      carrierZoneByShipOption[so] = zoneBreakdown
    }

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
      surcharges: 'Surcharges',
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

    // ── Non-Shipping Cost Breakdown (from billing summaries — REAL data) ──
    const nonShippingFees = (s.billing as any[]).filter((r: any) => r.fee_type !== 'Credit' && r.fee_type !== 'Payment')
    // Relabel fee types for user-friendly display (no grouping — show each individually)
    const feeTypeLabel = (ft: string): string => {
      switch (ft) {
        case 'Per Pick Fee': return 'Extra Picks'
        case 'Warehousing Fee': return 'Storage Fees'
        case 'WRO Receiving Fee': return 'WRO Receiving'
        case 'WRO Label Fee': return 'WRO Labels'
        case 'URO Storage Fee': return 'URO Storage'
        case 'Inventory Placement Program Fee': return 'MultiHub IQ'
        case 'Return to sender - Processing Fees': return 'Return Processing'
        case 'Return Processed by Operations Fee': return 'Return Processing'
        case 'Return Label': return 'Return Labels'
        case 'VAS - Paid Requests': return 'VAS'
        case 'Kitting Fee': return 'Kitting'
        case 'Address Correction': return 'Address Corrections'
        case 'Shipbob Freight Fee - Accessorial': return 'Freight Accessorial'
        case 'B2B - Each Pick Fee': return 'B2B Each Picks'
        case 'B2B - Case Pick Fee': return 'B2B Case Picks'
        case 'B2B - ShipBob Freight Fee': return 'B2B Freight'
        case 'B2B - Order Fee': return 'B2B Order Fee'
        case 'B2B - ASIN Fee': return 'B2B ASIN Fee'
        case 'B2B - Label Fee': return 'B2B Label Fee'
        case 'B2B - Supplies': return 'B2B Supplies'
        case 'B2B - Pallet Material Charge': return 'B2B Pallet Material'
        case 'B2B - Pallet Pack Fee': return 'B2B Pallet Pack'
        case 'Others': return 'Other Fees'
        default: return ft
      }
    }
    const groupedFees = new Map<string, { amount: number; count: number }>()
    for (const r of nonShippingFees) {
      const label = feeTypeLabel(r.fee_type as string)
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
      breachedCount: cleanBreachedCur,
      totalShipments: slaTotalCurrent,
      breachedShipments: slaBreachedShipments,
      onTimeShipments: slaOnTimeShipments,
    }

    // ── Fulfillment Trend (7-day weighted rolling avg to smooth weekend dips) ──
    // business_hours_between() returns ~0 on weekends, so daily averages zigzag.
    // Rolling window uses total hours / total count across 7 days for a stable line.
    const fulfillmentTrend = byDateInRange.map((r: any, i: number) => {
      // 7-day rolling window (current day + 6 prior)
      const windowStart = Math.max(0, i - 6)
      const window = byDateInRange.slice(windowStart, i + 1)
      const totalCleanHrs = window.reduce((s: number, d: any) =>
        s + (d.total_fulfill_business_hours || 0) - (d.delay_fulfill_biz_hours || 0), 0)
      const totalCleanCnt = window.reduce((s: number, d: any) =>
        s + (d.fulfill_count || 0) - (d.delay_count || 0), 0)
      const totalAllHrs = window.reduce((s: number, d: any) =>
        s + (d.total_fulfill_business_hours || 0), 0)
      const totalAllCnt = window.reduce((s: number, d: any) =>
        s + (d.fulfill_count || 0), 0)
      const cleanAvg = totalCleanCnt > 0 ? totalCleanHrs / totalCleanCnt : 0
      const allAvg = totalAllCnt > 0 ? totalAllHrs / totalAllCnt : 0
      return {
        date: r.summary_date,
        avgFulfillmentHours: cleanAvg,
        medianFulfillmentHours: cleanAvg,
        p90FulfillmentHours: cleanAvg,
        orderCount: r.shipment_count,
        avgFulfillmentHoursWithDelayed: allAvg,
      }
    })

    // ── FC Fulfillment Metrics (pre-grouped, delay-excluded) ───────────────
    const fcFulfillmentMetrics = (s.by_fc as any[]).map((r: any) => {
      const cleanOT = r.on_time_count - (r.delay_on_time_count || 0)
      const cleanBr = r.breached_count - (r.delay_breached_count || 0)
      const slaTotal = cleanOT + cleanBr
      const cleanFulfillHrs = r.total_fulfill_business_hours - (r.delay_fulfill_biz_hours || 0)
      const cleanFulfillCnt = r.fulfill_count - (r.delay_count || 0)
      return {
        fcName: r.fc_name,
        avgFulfillmentHours: cleanFulfillCnt > 0 ? cleanFulfillHrs / cleanFulfillCnt : (r.fulfill_count > 0 ? r.total_fulfill_business_hours / r.fulfill_count : 0),
        breachRate: slaTotal > 0 ? (cleanBr / slaTotal) * 100 : 0,
        orderCount: r.shipment_count,
        breachedCount: cleanBr,
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
      availableShipOptions,
      carrierPerformanceByShipOption,
      carrierZoneByShipOption,
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
        breachedCount: cleanBreachedCur,
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
    if (needsPerformance) {
      if (otdByStateCleanResult?.data) result.otdPercentilesByStateClean = otdByStateCleanResult.data
      if (otdByStateDelayedResult?.data) result.otdPercentilesByStateDelayed = otdByStateDelayedResult.data
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
