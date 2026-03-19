"use client"

export const dynamic = 'force-dynamic'

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { DownloadIcon } from "lucide-react"
import { JetpackLoader } from "@/components/jetpack-loader"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Label as RechartsLabel,
  LabelList,
} from "recharts"

import { SiteHeader } from "@/components/site-header"
import { Separator } from "@/components/ui/separator"
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { PerformanceMap } from "@/components/analytics/performance-map"
import { COUNTRY_CONFIGS } from "@/lib/analytics/geo-config"
import { StateDetailsPanel } from "@/components/analytics/state-details-panel"
import { StateVolumeDetailsPanel } from "@/components/analytics/state-volume-details-panel"
import { NationalVolumeOverviewPanel } from "@/components/analytics/national-volume-overview-panel"
import { NationalPerformanceOverviewPanel } from "@/components/analytics/national-performance-overview-panel"
import { LayeredVolumeHeatMap } from "@/components/analytics/layered-volume-heat-map"
import { CostSpeedStateMap } from "@/components/analytics/cost-speed-state-map"
import { KpiTooltip, KPI_TOOLTIPS } from "@/components/analytics/kpi-tooltip"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { useUserSettings } from "@/hooks/use-user-settings"
import type {
  SLAMetrics,
  DateRangePreset,
  StateVolumeData,
  CityVolumeData,
  ZipCodeVolumeData,
  StatePerformance,
  KPIMetrics,
  CostTrendData,
  DeliverySpeedTrendData,
  ShipOptionPerformanceData,
  TransitTimeDistributionData,
  StateCostSpeedData,
  ZoneCostData,
  OrderVolumeByHour,
  OrderVolumeByDayOfWeek,
  OrderVolumeByFC,
  OrderVolumeByStore,
  DailyOrderVolume,
  CarrierPerformance,
  BillingSummary,
  BillingCategoryBreakdown,
  MonthlyBillingTrend,
  PickPackDistribution,
  CostPerOrderTrend,
  ShippingCostByZone,
  AdditionalServicesBreakdown,
  BillingEfficiencyMetrics,
  FulfillmentTrendData,
  FCFulfillmentMetrics,
  UndeliveredShipment,
  UndeliveredSummary,
  UndeliveredByCarrier,
  UndeliveredByStatus,
  UndeliveredByAge,
} from "@/lib/analytics/types"
import { getGranularityForRange, getGranularityLabel } from "@/lib/analytics/types"
import { getDateRangeFromPreset } from "@/lib/analytics/aggregators"


const ANALYTICS_TABS = [
  { value: "state-performance", label: "Performance" },
  { value: "cost-speed", label: "Shipping Cost + Speed" },
  { value: "order-volume", label: "Order Volume" },
  { value: "carriers-zones", label: "Carriers + Zones" },
  { value: "financials", label: "Financials" },
  { value: "sla", label: "Fulfillment SLAs" },
  { value: "undelivered", label: "Undelivered" },
]

const DATE_RANGE_PRESETS = [
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
  { value: '60d', label: '60 Days' },
  { value: '90d', label: '90 Days' },
  { value: '6mo', label: '6 Months' },
  { value: '1yr', label: '1 Year' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
]

// Per-chart date presets (no custom — custom requires a date picker which is page-level only)
const CHART_DATE_PRESETS = DATE_RANGE_PRESETS.filter(p => p.value !== 'custom')

// Fully independent per-chart date range AND country hook.
// Each chart owns its own preset and country. On initial load it matches the page
// preset/country and uses pageFieldData (no extra fetch). When the chart's selectors
// diverge from the page, it looks up from cache or fetches independently.
// Optional lockedCountry: forces chart to always use this country (ignores page country sync).
// Used by Financials tab which always shows ALL-country data regardless of page setting.
function useChartDateRange(
  pageFieldData: any,
  fieldName: string,
  pageDateRange: DateRangePreset,
  clientId: string | null,
  pageCountry: string,
  timezone: string,
  cache: React.MutableRefObject<Map<string, any>>,
  lockedCountry?: string,
  extraParams?: Record<string, string>,
) {
  const [chartPreset, setChartPreset] = React.useState<DateRangePreset>(pageDateRange)
  const [chartCountry, setChartCountry] = React.useState<string>(lockedCountry || pageCountry)
  const [chartData, setChartData] = React.useState<any>(null)
  const [isFetching, setIsFetching] = React.useState(false)

  // Stable stringified extraParams for dependency arrays
  const extraParamsKey = extraParams ? Object.entries(extraParams).sort().map(([k, v]) => `${k}=${v}`).join('&') : ''

  // Sync chart-level selectors when page-level values change (e.g. country toggle)
  // Skip country sync when lockedCountry is set (chart stays on its locked value)
  React.useEffect(() => { setChartPreset(pageDateRange) }, [pageDateRange])
  React.useEffect(() => { if (!lockedCountry) setChartCountry(pageCountry) }, [pageCountry, lockedCountry])

  // Resolve data: when chart preset+country match page (and no extraParams), use page data directly.
  // When they diverge or extraParams exist, look up from cache or fetch independently.
  React.useEffect(() => {
    // Chart matches page AND no extra params — use pageFieldData (via null fallback), no fetch needed
    if (chartPreset === pageDateRange && chartCountry === pageCountry && !extraParamsKey) {
      setChartData(null)
      return
    }

    // Check cache (include extraParams in cache key)
    const cacheKey = `${chartPreset}:${chartCountry}:${timezone}:${clientId}${extraParamsKey ? ':' + extraParamsKey : ''}`
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setChartData(cached[fieldName])
      return
    }

    // Not cached — fetch independently
    if (!clientId) return

    let cancelled = false
    setIsFetching(true)

    const range = getDateRangeFromPreset(chartPreset)
    const params = new URLSearchParams({
      clientId,
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
      datePreset: chartPreset,
      country: chartCountry,
      timezone,
      tab: 'state-performance', // Core data only — skip expensive raw-table queries
      ...extraParams,
    })

    fetch(`/api/data/analytics/tab-data?${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data) {
          cache.current.set(cacheKey, data)
          setChartData(data[fieldName])
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsFetching(false) })

    return () => { cancelled = true }
  }, [chartPreset, chartCountry, pageDateRange, pageCountry, clientId, timezone, fieldName, cache, extraParamsKey])

  return {
    data: chartData ?? pageFieldData,
    preset: chartPreset,
    country: chartCountry,
    isFetching,
    setPreset: (v: string) => setChartPreset(v as DateRangePreset),
    setCountry: (v: string) => setChartCountry(v),
  }
}

// Variant that returns the full API response (for sections needing multiple fields)
function useChartSectionRange(
  pageData: any,
  pageDateRange: DateRangePreset,
  clientId: string | null,
  pageCountry: string,
  timezone: string,
  cache: React.MutableRefObject<Map<string, any>>,
  lockedCountry?: string,
  extraParams?: Record<string, string>,
) {
  const [chartPreset, setChartPreset] = React.useState<DateRangePreset>(pageDateRange)
  const [chartCountry, setChartCountry] = React.useState<string>(lockedCountry || pageCountry)
  const [chartData, setChartData] = React.useState<any>(null)
  const [isFetching, setIsFetching] = React.useState(false)

  // Stable stringified extraParams for dependency arrays
  const extraParamsKey = extraParams ? Object.entries(extraParams).sort().map(([k, v]) => `${k}=${v}`).join('&') : ''

  // Sync chart-level selectors when page-level values change
  // Skip country sync when lockedCountry is set
  React.useEffect(() => { setChartPreset(pageDateRange) }, [pageDateRange])
  React.useEffect(() => { if (!lockedCountry) setChartCountry(pageCountry) }, [pageCountry, lockedCountry])

  React.useEffect(() => {
    if (chartPreset === pageDateRange && chartCountry === pageCountry && !extraParamsKey) {
      setChartData(null)
      return
    }
    const cacheKey = `${chartPreset}:${chartCountry}:${timezone}:${clientId}${extraParamsKey ? ':' + extraParamsKey : ''}`
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setChartData(cached)
      return
    }
    if (!clientId) return
    let cancelled = false
    setIsFetching(true)
    const range = getDateRangeFromPreset(chartPreset)
    const params = new URLSearchParams({
      clientId,
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
      datePreset: chartPreset,
      country: chartCountry,
      timezone,
      tab: 'state-performance', // Core data only — skip expensive raw-table queries
      ...extraParams,
    })
    fetch(`/api/data/analytics/tab-data?${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled && data) {
          cache.current.set(cacheKey, data)
          setChartData(data)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsFetching(false) })
    return () => { cancelled = true }
  }, [chartPreset, chartCountry, pageDateRange, pageCountry, clientId, timezone, cache, extraParamsKey])

  return {
    data: chartData ?? pageData,
    preset: chartPreset,
    country: chartCountry,
    isFetching,
    setPreset: (v: string) => setChartPreset(v as DateRangePreset),
    setCountry: (v: string) => setChartCountry(v),
  }
}

// Reusable per-chart selector bar (date + country)
function ChartSelectors({ chart, availableCountries, dateRangeDisplayLabel, hideAllCountry, hideCountry }: {
  chart: ReturnType<typeof useChartDateRange>
  availableCountries: string[]
  dateRangeDisplayLabel: string
  hideAllCountry?: boolean
  hideCountry?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {chart.isFetching && <JetpackLoader size="sm" />}
      <Select value={chart.preset} onValueChange={chart.setPreset}>
        <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-background border-border">
          <SelectValue>{CHART_DATE_PRESETS.find(p => p.value === chart.preset)?.label || dateRangeDisplayLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="font-roboto text-xs">
          {CHART_DATE_PRESETS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!hideCountry && availableCountries.length > 1 && (
        <Select value={chart.country} onValueChange={chart.setCountry}>
          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-background border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="font-roboto text-xs">
            {!hideAllCountry && <SelectItem value="ALL">All</SelectItem>}
            <SelectItem value="US">USA</SelectItem>
            {availableCountries.includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export default function AnalyticsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isMounted, setIsMounted] = React.useState(false)

  // Only mount on client to avoid hydration issues with data calculations
  React.useEffect(() => {
    setIsMounted(true)
  }, [])

  // Client context for brand filtering
  const { selectedClientId, isAdmin } = useClient()
  const { settings } = useUserSettings()

  // For admins, null selectedClientId means "All Brands" → send 'all' to API
  // For non-admins, null means no brand selected yet
  const effectiveClientId = selectedClientId ?? (isAdmin ? 'all' : null)

  // Pre-aggregated analytics data from server
  const [analyticsData, setAnalyticsData] = React.useState<any>(null)
  const [isLoadingData, setIsLoadingData] = React.useState(false)
  const [isLoadingTabData, setIsLoadingTabData] = React.useState(false)
  const [dataError, setDataError] = React.useState<string | null>(null)

  // Track which tabs have had their expensive queries loaded
  // FREE tabs (no extra queries beyond core summaries): state-performance, financials, cost-speed (partial)
  // The API 'tab' param controls which expensive queries run
  const loadedTabsRef = React.useRef<Set<string>>(new Set())

  // Initialize active tab from URL or default to 'state-performance'
  const [activeTab, setActiveTab] = React.useState(() => {
    return searchParams.get('tab') || 'state-performance'
  })

  // Two-phase tab switching: show loader instantly, defer heavy content mount
  // renderedTab lags behind activeTab — content only mounts after loader is visible
  const [renderedTab, setRenderedTab] = React.useState(activeTab)
  const [isTabTransitioning, setIsTabTransitioning] = React.useState(false)

  // When activeTab changes, show loader immediately, defer content mount
  React.useEffect(() => {
    if (activeTab !== renderedTab) {
      setIsTabTransitioning(true)
      // Use double-rAF to ensure the loader paints before mounting heavy content
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setRenderedTab(activeTab)
          // Don't clear isTabTransitioning here — let the renderedTab effect below handle it
        })
      })
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear transition state AFTER React has committed the new tab render
  React.useEffect(() => {
    if (isTabTransitioning && renderedTab === activeTab) {
      // Wait one more frame after React commits, so the browser finishes painting
      requestAnimationFrame(() => {
        setIsTabTransitioning(false)
      })
    }
  }, [renderedTab, activeTab, isTabTransitioning])

  // Sync tab state when URL search params change (e.g. sidebar link navigation)
  React.useEffect(() => {
    const tabFromUrl = searchParams.get('tab')
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  const [dateRange, setDateRange] = React.useState<DateRangePreset>('90d')
  // Custom date range for InlineDateRangePicker
  const [customDateRange, setCustomDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  })

  const [selectedState, setSelectedState] = React.useState<string | null>(null)
  type OtdP = { otd_p20: number | null; otd_p50: number | null; otd_p80: number | null; sample_count: number }
  const [nationalOtdClean, setNationalOtdClean] = React.useState<OtdP | null>(null)
  const [nationalOtdWithDelayed, setNationalOtdWithDelayed] = React.useState<OtdP | null>(null)
  const [stateOtdClean, setStateOtdClean] = React.useState<OtdP | null>(null)
  const [stateOtdWithDelayed, setStateOtdWithDelayed] = React.useState<OtdP | null>(null)
  const [selectedCountry, setSelectedCountry] = React.useState('US')
  // Performance tab needs a specific country (map requires config) — fall back to US when ALL
  const perfCountry = selectedCountry === 'ALL' ? 'US' : selectedCountry
  const [selectedVolumeState, setSelectedVolumeState] = React.useState<string | null>(null)

  // Delay exclusion toggle — default: exclude delayed orders from averages
  const [includeDelayedOrders, setIncludeDelayedOrders] = React.useState(false)

  // Include International toggle for Cost & Speed — default: domestic only
  const [includeInternational, setIncludeInternational] = React.useState(false)

  // SLA-specific filters
  const [selectedFulfillmentCenters, setSelectedFulfillmentCenters] = React.useState<string[]>([])
  const [selectedOrderTypes, setSelectedOrderTypes] = React.useState<string[]>([])
  const [selectedOrderFulfilled, setSelectedOrderFulfilled] = React.useState<string[]>([])

  // Calculate real KPI data from sample shipments
  // Uses deferred values so calendar UI updates instantly while charts calculate in background
  const currentDateRange = React.useMemo(() => {
    if (dateRange === 'custom' && customDateRange.from && customDateRange.to) {
      return {
        from: customDateRange.from,
        to: customDateRange.to,
        preset: 'custom' as DateRangePreset,
      }
    }
    return getDateRangeFromPreset(dateRange)
  }, [dateRange, customDateRange])
  // Previous date range is now computed server-side for period-over-period comparisons

  // Build fetch params (shared between initial load and tab-switch fetches)
  const buildFetchParams = React.useCallback((tab: string) => {
    if (!effectiveClientId || !currentDateRange) return null
    const startDate = currentDateRange.from.toISOString().split('T')[0]
    const endDate = currentDateRange.to.toISOString().split('T')[0]
    return new URLSearchParams({
      clientId: effectiveClientId,
      startDate,
      endDate,
      datePreset: dateRange,
      country: selectedCountry,
      timezone: settings.timezone,
      tab,
    })
  }, [effectiveClientId, currentDateRange, dateRange, selectedCountry, settings.timezone])

  // Fetch OTD percentiles (both clean + with-delayed variants, national + state)
  // Both variants fetched upfront so the toggle switches instantly (no network delay)
  React.useEffect(() => {
    if (!effectiveClientId || !currentDateRange) {
      setNationalOtdClean(null)
      setNationalOtdWithDelayed(null)
      setStateOtdClean(null)
      setStateOtdWithDelayed(null)
      return
    }
    let cancelled = false
    const startDate = currentDateRange.from.toISOString().split('T')[0]
    const endDate = currentDateRange.to.toISOString().split('T')[0]
    const base: Record<string, string> = {
      clientId: effectiveClientId,
      startDate,
      endDate,
      country: perfCountry,
    }
    const fetchOtd = (extra: Record<string, string> = {}) =>
      fetch(`/api/data/analytics/otd-percentiles?${new URLSearchParams({ ...base, ...extra })}`)
        .then(res => res.ok ? res.json() : null)
    // National: both variants
    fetchOtd({ includeDelayed: 'false' })
      .then(data => { if (!cancelled) setNationalOtdClean(data) })
      .catch(() => { if (!cancelled) setNationalOtdClean(null) })
    fetchOtd({ includeDelayed: 'true' })
      .then(data => { if (!cancelled) setNationalOtdWithDelayed(data) })
      .catch(() => { if (!cancelled) setNationalOtdWithDelayed(null) })
    // State-level: both variants if state selected
    if (selectedState) {
      fetchOtd({ includeDelayed: 'false', state: selectedState })
        .then(data => { if (!cancelled) setStateOtdClean(data) })
        .catch(() => { if (!cancelled) setStateOtdClean(null) })
      fetchOtd({ includeDelayed: 'true', state: selectedState })
        .then(data => { if (!cancelled) setStateOtdWithDelayed(data) })
        .catch(() => { if (!cancelled) setStateOtdWithDelayed(null) })
    } else {
      setStateOtdClean(null)
      setStateOtdWithDelayed(null)
    }
    return () => { cancelled = true }
  }, [selectedState, effectiveClientId, currentDateRange, perfCountry])

  // Fetch pre-aggregated data from server when client, date range, or country changes
  React.useEffect(() => {
    if (!isMounted || !effectiveClientId) {
      setAnalyticsData(null)
      setIsLoadingData(false)
      return
    }

    let cancelled = false

    async function fetchData() {
      setIsLoadingData(true)
      // Keep stale analyticsData visible (greyed out) while loading — don't null it
      setDataError(null)
      // Reset loaded tabs — new date range/client means all tab data is stale
      loadedTabsRef.current = new Set()

      const params = buildFetchParams(activeTab)
      if (!params) return

      try {
        const res = await fetch(`/api/data/analytics/tab-data?${params}`)

        if (cancelled) return

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          setDataError(err.error || 'Failed to load analytics data')
          setAnalyticsData(null)
          setIsLoadingData(false)
          return
        }

        const data = await res.json()

        if (cancelled) return

        loadedTabsRef.current.add(activeTab)
        setAnalyticsData(data)
      } catch (err) {
        if (!cancelled) {
          setDataError('Network error loading analytics data')
          setAnalyticsData(null)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingData(false)
        }
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [isMounted, effectiveClientId, currentDateRange, dateRange, selectedCountry, settings.timezone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Lazy-load tab-specific data when switching tabs
  React.useEffect(() => {
    if (!analyticsData || !effectiveClientId) return
    if (loadedTabsRef.current.has(activeTab)) {
      setIsLoadingTabData(false)
      return
    }

    let cancelled = false

    async function fetchTabData() {
      setIsLoadingTabData(true)
      const params = buildFetchParams(activeTab)
      if (!params) return

      try {
        const res = await fetch(`/api/data/analytics/tab-data?${params}`)
        if (cancelled) return
        if (!res.ok) return

        const data = await res.json()
        if (cancelled) return

        loadedTabsRef.current.add(activeTab)
        // Merge tab-specific fields into existing data (don't overwrite core fields with undefined)
        setAnalyticsData((prev: any) => prev ? { ...prev, ...data } : data)
      } catch {
        // Silently fail — user can retry by switching tabs again
      } finally {
        if (!cancelled) setIsLoadingTabData(false)
      }
    }

    fetchTabData()
    return () => { cancelled = true }
  }, [activeTab, analyticsData, effectiveClientId, buildFetchParams])

  // ── ALL DATA IS NOW PRE-AGGREGATED SERVER-SIDE ──
  // No client-side aggregation needed. Data comes from /api/data/analytics/tab-data

  // Helper: check if we have data loaded
  const hasData = !!analyticsData

  // === state-performance tab ===
  // When includeDelayedOrders is toggled, swap to _withDelayed variants
  const statePerformance: StatePerformance[] = React.useMemo(() => {
    const raw = analyticsData?.statePerformance || []
    if (!includeDelayedOrders) return raw
    return raw.map((s: any) => ({
      ...s,
      avgDeliveryTimeDays: s.avgDeliveryTimeDaysWithDelayed ?? s.avgDeliveryTimeDays,
      avgFulfillTimeHours: s.avgFulfillTimeHoursWithDelayed ?? s.avgFulfillTimeHours,
      avgRegionalMileDays: (s.avgDeliveryTimeDaysWithDelayed ?? s.avgDeliveryTimeDays) > 0
        ? Math.max(0, (s.avgDeliveryTimeDaysWithDelayed ?? s.avgDeliveryTimeDays) - (s.avgFulfillTimeHoursWithDelayed ?? s.avgFulfillTimeHours) / 24 - s.avgCarrierTransitDays)
        : 0,
    }))
  }, [analyticsData?.statePerformance, includeDelayedOrders])

  const delayImpact = analyticsData?.delayImpact || null

  const kpiData: KPIMetrics = analyticsData?.kpis || {
    totalCost: 0, orderCount: 0, avgTransitTime: 0, avgFulfillTime: 0, slaPercent: 0, lateOrders: 0, undelivered: 0,
    periodChange: { totalCost: 0, orderCount: 0, avgTransitTime: 0, slaPercent: 0, lateOrders: 0, undelivered: 0 }
  }

  // Shared axis tick style — Geist Sans, tabular nums, muted
  const axisTick = { fontSize: 11, fontFamily: 'var(--font-roboto), system-ui, sans-serif', fill: 'hsl(240 5% 55%)' }

  // === cost-speed tab ===
  const costTrendData: CostTrendData[] = analyticsData?.costTrend || []

  const maWindowSize = React.useMemo(() => {
    const totalDays = Math.round(
      (currentDateRange.to.getTime() - currentDateRange.from.getTime()) / (1000 * 60 * 60 * 24)
    )
    return Math.max(1, Math.min(30, Math.round(totalDays / 5)))
  }, [currentDateRange])

  const costTrendDataWithMA = React.useMemo(() => {
    if (costTrendData.length === 0) return []
    return costTrendData.map((item, index) => {
      const start = Math.max(0, index - maWindowSize + 1)
      const window = costTrendData.slice(start, index + 1)
      const movingAvg = window.reduce((sum, d) => sum + d.avgCostWithSurcharge, 0) / window.length
      return { ...item, movingAverage: movingAvg }
    })
  }, [costTrendData, maWindowSize])

  const overallAvgCost = React.useMemo(() => {
    if (costTrendData.length === 0) return null
    const totalCost = costTrendData.reduce((sum, d) => sum + d.avgCostWithSurcharge * d.orderCount, 0)
    const totalOrders = costTrendData.reduce((sum, d) => sum + d.orderCount, 0)
    return totalOrders > 0 ? totalCost / totalOrders : null
  }, [costTrendData])

  const costYAxisConfig = React.useMemo(() => {
    if (costTrendData.length === 0) return { domain: [8, 10] as [number, number], ticks: [8, 9, 10] }
    const allValues = costTrendData.flatMap(d => [d.avgCostBase, d.avgCostWithSurcharge])
    const minVal = Math.min(...allValues)
    const maxVal = Math.max(...allValues)
    const rawRange = Math.ceil(maxVal) - Math.floor(minVal)
    const step = rawRange <= 6 ? 1 : rawRange <= 12 ? 2 : rawRange <= 30 ? 5 : 10
    const domainMin = Math.floor(minVal / step) * step
    const domainMax = Math.ceil(maxVal / step) * step
    const ticks: number[] = []
    for (let i = domainMin; i <= domainMax; i += step) ticks.push(i)
    return { domain: [domainMin, domainMax] as [number, number], ticks }
  }, [costTrendData])

  const stateCostSpeedData: StateCostSpeedData[] = analyticsData?.stateCostSpeed || []
  const zoneCostData: ZoneCostData[] = React.useMemo(() => {
    const raw: ZoneCostData[] = (analyticsData?.zoneCost || []).filter((z: ZoneCostData) => z.avgTransitTime > 0)
    // Bucket non-standard zones into "Intl" (International), sort numerically
    const standardZones = raw.filter(z => Number(z.zone) >= 1 && Number(z.zone) <= 10)
    const intlZones = raw.filter(z => Number(z.zone) < 1 || Number(z.zone) > 10 || isNaN(Number(z.zone)))
    if (intlZones.length > 0) {
      const totalCount = intlZones.reduce((s, z) => s + z.orderCount, 0)
      const totalCost = intlZones.reduce((s, z) => s + z.avgCost * z.orderCount, 0)
      const totalTransit = intlZones.reduce((s, z) => s + z.avgTransitTime * z.orderCount, 0)
      standardZones.push({
        zone: 'Intl',
        avgCost: totalCount > 0 ? totalCost / totalCount : 0,
        avgTransitTime: totalCount > 0 ? totalTransit / totalCount : 0,
        orderCount: totalCount,
      })
    }
    return standardZones.sort((a, b) => {
      if (a.zone === 'Intl') return 1
      if (b.zone === 'Intl') return -1
      return Number(a.zone) - Number(b.zone)
    })
  }, [analyticsData?.zoneCost])
  const deliverySpeedTrendData: DeliverySpeedTrendData[] = React.useMemo(() => {
    const raw = analyticsData?.deliverySpeedTrend || []
    if (!includeDelayedOrders) return raw
    return raw.map((d: any) => {
      const otd = d.avgOrderToDeliveryDaysWithDelayed ?? d.avgOrderToDeliveryDays
      const fulfill = d.avgFulfillTimeHoursWithDelayed ?? d.avgFulfillTimeHours
      const transit = d.avgCarrierTransitDays
      const middleMile = (otd !== null && transit !== null && otd > 0)
        ? Math.max(0, otd - fulfill / 24 - transit)
        : null
      return {
        ...d,
        avgOrderToDeliveryDays: otd,
        avgFulfillTimeHours: fulfill,
        middleMileDays: middleMile,
      }
    })
  }, [analyticsData?.deliverySpeedTrend, includeDelayedOrders])
  const transitTimeDistributionData: TransitTimeDistributionData[] = analyticsData?.transitDistribution || []
  const shipOptionPerformanceData: ShipOptionPerformanceData[] = analyticsData?.shipOptionPerformance || []

  // === order-volume tab ===
  const orderVolumeByHour: OrderVolumeByHour[] = analyticsData?.volumeByHour || []
  const orderVolumeByDayOfWeek: OrderVolumeByDayOfWeek[] = analyticsData?.volumeByDayOfWeek || []
  const orderVolumeByFC: OrderVolumeByFC[] = analyticsData?.volumeByFC || []
  const orderVolumeByStore: OrderVolumeByStore[] = analyticsData?.volumeByStore || []
  const dailyOrderVolume: DailyOrderVolume[] = analyticsData?.dailyVolume || []

  // Independent per-chart date ranges (shared fetch cache)
  const chartDataCache = React.useRef<Map<string, any>>(new Map())

  // Seed cache with page-level data so charts can look it up after page selector changes
  React.useEffect(() => {
    if (!analyticsData || !effectiveClientId) return
    const cacheKey = `${dateRange}:${selectedCountry}:${settings.timezone}:${effectiveClientId}`
    chartDataCache.current.set(cacheKey, analyticsData)
  }, [analyticsData, dateRange, selectedCountry, settings.timezone, effectiveClientId])
  // === Order Volume tab hooks ===
  const dailyVolumeChart = useChartDateRange(dailyOrderVolume, 'dailyVolume', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const hourChart = useChartDateRange(orderVolumeByHour, 'volumeByHour', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const dowChart = useChartDateRange(orderVolumeByDayOfWeek, 'volumeByDayOfWeek', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const fcChart = useChartDateRange(orderVolumeByFC, 'volumeByFC', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const storeChart = useChartDateRange(orderVolumeByStore, 'volumeByStore', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)

  // === Cost + Speed tab hooks ===
  // When includeInternational is false (default), pass domesticOnly=true via extraParams
  // to filter out international destinations. When true, no extra params needed (use page data as-is).
  const costSpeedExtraParams = React.useMemo(
    () => includeInternational ? undefined : { domesticOnly: 'true' },
    [includeInternational]
  )
  const costSpeedKpiSection = useChartSectionRange(analyticsData, dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, costSpeedExtraParams)
  const costSpeedMapSection = useChartSectionRange(analyticsData, dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const costTrendChart = useChartDateRange(costTrendData, 'costTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, costSpeedExtraParams)
  const deliverySpeedChart = useChartDateRange(analyticsData?.deliverySpeedTrend || [], 'deliverySpeedTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, costSpeedExtraParams)
  const zoneCostChart = useChartDateRange(analyticsData?.zoneCost || [], 'zoneCost', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const shipOptionChart = useChartDateRange(shipOptionPerformanceData, 'shipOptionPerformance', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, costSpeedExtraParams)

  // === carriers-zones tab data (declared here so hooks below can use it) ===
  const carrierPerformance: CarrierPerformance[] = analyticsData?.carrierPerformance || []

  // === Carriers + Zones tab hooks ===
  const carrierSection = useChartSectionRange(analyticsData, dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const carrierZoneChart = useChartDateRange(analyticsData?.zoneCost || [], 'zoneCost', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const zoneDeepDiveChart = useChartDateRange(analyticsData?.zoneCost || [], 'zoneCost', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)

  // === Financials tab data (declared before hooks) ===
  const billingTrendData: MonthlyBillingTrend[] = analyticsData?.billingTrend || []
  const pickPackDistribution: PickPackDistribution[] = analyticsData?.pickPackDistribution || []
  const costPerOrderTrend: CostPerOrderTrend[] = analyticsData?.costPerOrderTrend || []
  const additionalServicesBreakdown: AdditionalServicesBreakdown[] = analyticsData?.additionalServicesBreakdown || []
  const billingCategoryBreakdown: BillingCategoryBreakdown[] = analyticsData?.billingCategoryBreakdown || []

  // === SLA tab data (declared before hooks) ===
  const fcFulfillmentMetrics: FCFulfillmentMetrics[] = analyticsData?.fcFulfillmentMetrics || []

  // === Financials tab hooks ===
  // Financials always uses 'ALL' via lockedCountry — invoices can't be split by country.
  // pageCountry = selectedCountry (truthful about what page data contains) so the hook
  // knows when to use page data vs fetch independently with country='ALL'.
  const financialsSection = useChartSectionRange(analyticsData, dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const billingTrendChart = useChartDateRange(billingTrendData, 'billingTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const costDistChart = useChartDateRange(billingCategoryBreakdown, 'billingCategoryBreakdown', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const feeBreakdownChart = useChartDateRange(analyticsData?.billingTrendWeekly || billingTrendData, 'billingTrendWeekly', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const pickPackChart = useChartDateRange(pickPackDistribution, 'pickPackDistribution', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const costPerOrderChart = useChartDateRange(costPerOrderTrend, 'costPerOrderTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const shippingByZoneChart = useChartDateRange(analyticsData?.shippingCostByZone || [], 'shippingCostByZone', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')
  const additionalSvcChart = useChartDateRange(additionalServicesBreakdown, 'additionalServicesBreakdown', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL')

  // === SLA tab hooks ===
  const slaTrendChart = useChartDateRange(analyticsData?.onTimeTrend || [], 'onTimeTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const fulfillTrendChart = useChartDateRange(analyticsData?.fulfillmentTrend || [], 'fulfillmentTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const fcFulfillChart = useChartDateRange(fcFulfillmentMetrics, 'fcFulfillmentMetrics', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)

  // === Cost+Speed KPI section derived data ===
  const kpiSectionData = costSpeedKpiSection.data
  const kpiSectionAvgCost = React.useMemo(() => {
    const ct = kpiSectionData?.costTrend || []
    if (ct.length === 0) return null
    const totalCost = ct.reduce((sum: number, d: any) => sum + d.avgCostWithSurcharge * d.orderCount, 0)
    const totalOrders = ct.reduce((sum: number, d: any) => sum + d.orderCount, 0)
    return totalOrders > 0 ? totalCost / totalOrders : null
  }, [kpiSectionData?.costTrend])
  const kpiSectionKpis = kpiSectionData?.kpis || kpiData
  const kpiSectionMiddleMile = React.useMemo(() => {
    const country = selectedCountry === 'ALL' ? 'US' : selectedCountry
    const knownCodes = new Set(Object.keys(COUNTRY_CONFIGS[country]?.codeToName || {}))
    const states = ((kpiSectionData?.statePerformance || statePerformance) as StatePerformance[])
      .filter(s => knownCodes.has(s.state))
    const totalDelivered = states.reduce((sum, s) => sum + s.deliveredCount, 0)
    if (totalDelivered === 0) return 0
    const totalWeighted = states.reduce((sum, s) => {
      const mm = s.avgDeliveryTimeDays > 0 ? Math.max(0, s.avgDeliveryTimeDays - s.avgFulfillTimeHours / 24 - s.avgCarrierTransitDays) : 0
      return sum + mm * s.deliveredCount
    }, 0)
    return totalWeighted / totalDelivered
  }, [kpiSectionData?.statePerformance, statePerformance, selectedCountry])

  // === Cost+Speed map section derived data ===
  const mapSectionData = costSpeedMapSection.data
  const mapStateCostSpeedData = mapSectionData?.stateCostSpeed || []

  // === Chart-specific derived data (transforms hook data so per-chart selectors work) ===
  const chartCostTrendWithMA = React.useMemo(() => {
    const data = costTrendChart.data as CostTrendData[]
    if (!data || data.length === 0) return []
    return data.map((item, index) => {
      const start = Math.max(0, index - maWindowSize + 1)
      const window = data.slice(start, index + 1)
      const movingAvg = window.reduce((sum, d) => sum + d.avgCostWithSurcharge, 0) / window.length
      return { ...item, movingAverage: movingAvg }
    })
  }, [costTrendChart.data, maWindowSize])

  const chartCostYAxisConfig = React.useMemo(() => {
    const data = costTrendChart.data as CostTrendData[]
    if (!data || data.length === 0) return { domain: [8, 10] as [number, number], ticks: [8, 9, 10] }
    const allValues = data.flatMap(d => [d.avgCostBase, d.avgCostWithSurcharge])
    const minVal = Math.min(...allValues)
    const maxVal = Math.max(...allValues)
    const rawRange = Math.ceil(maxVal) - Math.floor(minVal)
    const step = rawRange <= 6 ? 1 : rawRange <= 12 ? 2 : rawRange <= 30 ? 5 : 10
    const domainMin = Math.floor(minVal / step) * step
    const domainMax = Math.ceil(maxVal / step) * step
    const ticks: number[] = []
    for (let i = domainMin; i <= domainMax; i += step) ticks.push(i)
    return { domain: [domainMin, domainMax] as [number, number], ticks }
  }, [costTrendChart.data])

  const chartDeliverySpeedTrend = React.useMemo(() => {
    const raw = deliverySpeedChart.data as any[]
    if (!raw) return []
    return raw.map((d: any) => {
      const otd = d.avgOrderToDeliveryDays
      const fulfill = d.avgFulfillTimeHours
      const transit = d.avgCarrierTransitDays
      const fulfillDays = fulfill > 0 ? fulfill / 24 : 0
      const middleMile = (otd !== null && transit !== null && otd > 0)
        ? Math.max(0, otd - fulfillDays - transit)
        : null
      return { ...d, middleMileDays: middleMile, fulfillmentDays: fulfillDays }
    })
  }, [deliverySpeedChart.data])

  // Zone cost bucketing helper
  const bucketZoneCost = (raw: ZoneCostData[], country: string) => {
    if (!raw) return []
    // Only include zones with delivered shipments (avgTransitTime > 0)
    const delivered = raw.filter(z => z.avgTransitTime > 0)
    // Determine which zones are "standard" based on country
    const isStandard = (z: ZoneCostData) => {
      const n = Number(z.zone)
      if (country === 'US') return n >= 1 && n <= 10
      if (country === 'CA') return n >= 100 && n <= 999 // CA uses 3-digit zone codes
      return !isNaN(n) && n >= 1
    }
    const standardZones = delivered.filter(isStandard)
    const intlZones = delivered.filter(z => !isStandard(z))
    if (intlZones.length > 0) {
      const totalCount = intlZones.reduce((s, z) => s + z.orderCount, 0)
      const totalCost = intlZones.reduce((s, z) => s + z.avgCost * z.orderCount, 0)
      const totalTransit = intlZones.reduce((s, z) => s + z.avgTransitTime * z.orderCount, 0)
      standardZones.push({
        zone: 'Intl',
        avgCost: totalCount > 0 ? totalCost / totalCount : 0,
        avgTransitTime: totalCount > 0 ? totalTransit / totalCount : 0,
        orderCount: totalCount,
      })
    }
    return standardZones.sort((a, b) => {
      if (a.zone === 'Intl') return 1
      if (b.zone === 'Intl') return -1
      return Number(a.zone) - Number(b.zone)
    })
  }

  const chartZoneCostData = React.useMemo(() => bucketZoneCost(zoneCostChart.data as ZoneCostData[], zoneCostChart.country), [zoneCostChart.data, zoneCostChart.country])
  const carrierZoneCostData = React.useMemo(() => bucketZoneCost(carrierZoneChart.data as ZoneCostData[], carrierZoneChart.country), [carrierZoneChart.data, carrierZoneChart.country])
  const zoneDeepDiveData = React.useMemo(() => bucketZoneCost(zoneDeepDiveChart.data as ZoneCostData[], zoneDeepDiveChart.country), [zoneDeepDiveChart.data, zoneDeepDiveChart.country])

  const carrierSectionData = carrierSection.data
  const chartCarrierPerformance: CarrierPerformance[] = carrierSectionData?.carrierPerformance || carrierPerformance
  const chartTransitDistribution: TransitTimeDistributionData[] = carrierSectionData?.transitDistribution || transitTimeDistributionData
  const chartCarrierZoneBreakdown: { carrier: string; zone: string; orderCount: number }[] = carrierSectionData?.carrierZoneBreakdown || analyticsData?.carrierZoneBreakdown || []


  // Background pre-fetch all presets so chart selector changes are instant
  // Fast presets first, then slower ones — all in background
  const PREFETCH_PRESETS = ['14d', '30d', '60d', '90d', '6mo', '1yr', 'all']
  React.useEffect(() => {
    if (!analyticsData || !effectiveClientId) return

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    const toFetch = PREFETCH_PRESETS.filter(p => {
      if (p === dateRange) return false // Already loaded as page data
      const cacheKey = `${p}:${selectedCountry}:${settings.timezone}:${effectiveClientId}`
      return !chartDataCache.current.has(cacheKey) // Not yet cached
    })

    toFetch.forEach((preset, i) => {
      timers.push(setTimeout(() => {
        if (cancelled) return
        const range = getDateRangeFromPreset(preset as DateRangePreset)
        const params = new URLSearchParams({
          clientId: effectiveClientId!,
          startDate: range.from.toISOString().split('T')[0],
          endDate: range.to.toISOString().split('T')[0],
          datePreset: preset,
          country: selectedCountry,
          timezone: settings.timezone,
          tab: 'state-performance', // Only prefetch core data — skip expensive raw-table queries
        })

        fetch(`/api/data/analytics/tab-data?${params}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (!cancelled && data) {
              const cacheKey = `${preset}:${selectedCountry}:${settings.timezone}:${effectiveClientId}`
              chartDataCache.current.set(cacheKey, data)
            }
          })
          .catch(() => {})
      }, (i + 1) * 800)) // Stagger 800ms apart to avoid hammering the server
    })

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [analyticsData, effectiveClientId, selectedCountry, settings.timezone, dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  // === financials tab ===
  const billingSummary: BillingSummary = analyticsData?.billingSummary || {
    totalCost: 0, orderCount: 0, costPerOrder: 0, periodChange: { totalCost: 0, orderCount: 0, costPerOrder: 0 }
  }
  const shippingCostByZone: ShippingCostByZone[] = React.useMemo(() => {
    const raw: ShippingCostByZone[] = analyticsData?.shippingCostByZone || []
    const standard = raw.filter(z => { const n = Number(z.zone); return n >= 1 && n <= 10 })
    const intl = raw.filter(z => { const n = Number(z.zone); return n < 1 || n > 10 || isNaN(n) })
    if (intl.length > 0) {
      const totalOrders = intl.reduce((s, z) => s + z.orderCount, 0)
      const totalShipping = intl.reduce((s, z) => s + z.totalShipping, 0)
      const totalPercent = intl.reduce((s, z) => s + z.percent, 0)
      standard.push({
        zone: 'Intl',
        zoneLabel: 'International',
        orderCount: totalOrders,
        totalShipping,
        avgShipping: totalOrders > 0 ? totalShipping / totalOrders : 0,
        percent: totalPercent,
      })
    }
    return standard.sort((a, b) => {
      if (a.zone === 'Intl') return 1
      if (b.zone === 'Intl') return -1
      return Number(a.zone) - Number(b.zone)
    })
  }, [analyticsData?.shippingCostByZone])
  const billingEfficiencyMetrics: BillingEfficiencyMetrics = analyticsData?.billingEfficiency ?? {
    costPerItem: 0, avgItemsPerOrder: 0, fulfillmentAsPercentOfRevenue: 0, avgRevenuePerOrder: 0, surchargePercentOfCost: 0, totalCredits: 0
  }

  // Financials section derived data (from shared section hook)
  const finData = financialsSection.data
  const finBillingTrend: MonthlyBillingTrend[] = finData?.billingTrend || billingTrendData
  const finBillingSummary: BillingSummary = finData?.billingSummary || billingSummary
  const finBillingEfficiency: BillingEfficiencyMetrics = finData?.billingEfficiency || billingEfficiencyMetrics

  // Compute Y-axis domain for cost breakdown chart — zoom in so non-shipping fees are visible
  const billingChartYDomain = React.useMemo(() => {
    if (finBillingTrend.length === 0) return [0, 'auto'] as [number, string]
    const minShipping = Math.min(...finBillingTrend.map(d => d.shipping))
    // Stacked peak = sum of all positive categories (credit excluded from chart)
    const stackedTotals = finBillingTrend.map(d =>
      d.shipping + d.surcharges + d.extraPicks + d.warehousing + d.multiHubIQ + d.b2b + d.vasKitting + d.receiving + d.returns + d.dutyTax + d.other
    )
    const maxStacked = Math.max(...stackedTotals)
    const minStacked = Math.min(...stackedTotals)
    const step = maxStacked > 10000 ? 1000 : 500
    // Cut off 90% of the uniform baseline so chart focuses on the variation
    const floor = Math.max(0, Math.floor(minStacked * 0.9 / step) * step)
    const ceil = Math.ceil(maxStacked * 1.05 / step) * step
    return [floor, ceil] as [number, number]
  }, [finBillingTrend])

  // === sla tab ===
  const slaMetrics = React.useMemo(() => {
    if (!analyticsData?.slaMetrics) {
      return { onTimePercent: 0, breachedCount: 0, totalShipments: 0, shipments: [] as SLAMetrics[] }
    }
    return {
      onTimePercent: analyticsData.slaMetrics.onTimePercent,
      breachedCount: analyticsData.slaMetrics.breachedCount,
      totalShipments: analyticsData.slaMetrics.totalShipments,
      shipments: [
        ...(analyticsData.slaMetrics.breachedShipments || []),
        ...(analyticsData.slaMetrics.onTimeShipments || []),
      ] as SLAMetrics[],
    }
  }, [analyticsData?.slaMetrics])

  const fulfillmentTrendData: FulfillmentTrendData[] = React.useMemo(() => {
    const raw = analyticsData?.fulfillmentTrend || []
    if (!includeDelayedOrders) return raw
    return raw.map((d: any) => ({
      ...d,
      avgFulfillmentHours: d.avgFulfillmentHoursWithDelayed ?? d.avgFulfillmentHours,
      medianFulfillmentHours: d.avgFulfillmentHoursWithDelayed ?? d.medianFulfillmentHours,
      p90FulfillmentHours: d.avgFulfillmentHoursWithDelayed ?? d.p90FulfillmentHours,
    }))
  }, [analyticsData?.fulfillmentTrend, includeDelayedOrders])

  // === undelivered tab ===
  const undeliveredSummary: UndeliveredSummary = analyticsData?.undeliveredSummary || {
    totalUndelivered: 0, avgDaysInTransit: 0, criticalCount: 0, warningCount: 0, onTrackCount: 0, oldestDays: 0
  }
  const undeliveredByCarrier: UndeliveredByCarrier[] = analyticsData?.undeliveredByCarrier || []
  const undeliveredByStatus: UndeliveredByStatus[] = analyticsData?.undeliveredByStatus || []
  const undeliveredByAge: UndeliveredByAge[] = analyticsData?.undeliveredByAge || []
  const undeliveredShipments: UndeliveredShipment[] = analyticsData?.undeliveredShipments || []

  // Volume data from server (state + city volumes)
  // City-by-state detail is derived client-side from the full city volume data
  const volumeData = React.useMemo(() => {
    if (!analyticsData) return { stateData: [] as StateVolumeData[], zipCodeData: [] as ZipCodeVolumeData[], cityData: [] as CityVolumeData[], calculatedFor: currentDateRange }

    const allCities = (analyticsData.cityVolume || []) as Array<CityVolumeData & { lon: number; lat: number }>

    // Derive city-by-state from the full city volume data
    let cityByState: CityVolumeData[] = []
    if (selectedVolumeState) {
      const stateCities = allCities.filter((c: any) => c.state === selectedVolumeState)
      const totalInState = stateCities.reduce((sum: number, c: any) => sum + c.orderCount, 0)
      cityByState = stateCities
        .map((c: any) => ({
          city: c.city,
          state: c.state,
          zipCode: c.zipCode || '',
          orderCount: c.orderCount,
          percent: totalInState > 0 ? (c.orderCount / totalInState) * 100 : 0,
        }))
        .sort((a: CityVolumeData, b: CityVolumeData) => b.orderCount - a.orderCount)
        .slice(0, 10)
    }

    return {
      stateData: (analyticsData.stateVolume || []) as StateVolumeData[],
      zipCodeData: allCities as ZipCodeVolumeData[],
      cityData: cityByState,
      calculatedFor: currentDateRange,
    }
  }, [analyticsData, currentDateRange, selectedVolumeState])

  // On-time trend data from server
  const onTimeTrendData = analyticsData?.onTimeTrend || []

  // Y-axis domain - hardcoded to 90-100 for SLA chart
  const yAxisDomain = [90, 100]

  // Get human-readable label for selected date range
  const dateRangeDisplayLabel = React.useMemo(() => {
    if (dateRange === 'custom' && customDateRange.from && customDateRange.to) {
      return `${format(customDateRange.from, 'MMM d')} - ${format(customDateRange.to, 'MMM d, yyyy')}`
    }
    const labels: Record<string, string> = {
      '14d': 'Last 14 Days',
      '30d': 'Last 30 Days',
      '60d': 'Last 60 Days',
      '90d': 'Last 90 Days',
      '6mo': 'Last 6 Months',
      '1yr': 'Last Year',
      'all': 'All Time',
    }
    return labels[dateRange] || 'Last 30 Days'
  }, [dateRange, customDateRange])

  // Handle date preset change from Select dropdown
  const handleDatePresetChange = (value: string) => {
    if (value === 'custom') {
      setDateRange('custom' as DateRangePreset)
    } else {
      setDateRange(value as DateRangePreset)
      setCustomDateRange({ from: undefined, to: undefined })
    }
  }

  // Volume data is always current since it comes pre-computed from the server
  // When no client is selected, treat as "current" so Loading indicator doesn't show forever
  const isVolumeDataCurrent = hasData || !effectiveClientId

  // Handle tab change and update URL
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  return (
    <>
      <SiteHeader sectionName="Analytics">
        <Separator
          orientation="vertical"
          className="mx-1 data-[orientation=vertical]:h-4 bg-muted-foreground/30"
        />
        <Select value={activeTab} onValueChange={handleTabChange}>
          <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent px-2 text-base font-medium text-foreground hover:bg-accent focus:ring-0 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-50">
            <SelectValue>{ANALYTICS_TABS.find(t => t.value === activeTab)?.label || "Performance"}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {ANALYTICS_TABS.map((tab) => (
              <SelectItem key={tab.value} value={tab.value}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(!isMounted || !isVolumeDataCurrent || isLoadingData || isLoadingTabData || isTabTransitioning) && (
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
            <span className="text-xs text-muted-foreground">Loading</span>
          </div>
        )}
      </SiteHeader>
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-1 flex-col w-full font-roboto">
          <div className="flex flex-col w-full px-4 lg:px-6">
            {/* Tabs for Different Reports */}
            <Tabs value={renderedTab} onValueChange={handleTabChange} className="w-full">
              {/* Top spacing */}
              <div className="pt-5" />

              {/* Inline error / empty messages (loading handled by SiteHeader loader) */}
              {!isLoadingData && dataError && (
                <p className="text-sm text-destructive px-1">{dataError}</p>
              )}
              {!isLoadingData && !dataError && !effectiveClientId && (
                <p className="text-sm text-muted-foreground px-1">Select a brand to view analytics.</p>
              )}
              {!isLoadingData && !dataError && effectiveClientId && !hasData && (
                <p className="text-sm text-muted-foreground px-1">No shipment data for this brand in the selected date range.</p>
              )}

              {/* Tab content wrapper - greyed out during loading or tab transition */}
              <div className={(isLoadingData || isTabTransitioning) ? "opacity-20 pointer-events-none" : "transition-opacity duration-150"}>

              {/* Tab 1: Financials */}
              <TabsContent value="financials" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 h-[calc(100vh-64px)] overflow-y-auto bg-zinc-50 dark:bg-zinc-900">
                  {/* Featured Row: Chart (2 cols) + Summary Sidebar (1 col) */}
                  <div className="grid lg:grid-cols-3">
                    {/* Chart — 2 columns */}
                    <div className="lg:col-span-2 bg-muted dark:bg-zinc-900 relative flex flex-col after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[15%] after:bg-gradient-to-b after:from-transparent after:to-zinc-50 dark:after:to-zinc-900 after:pointer-events-none after:z-[1]">
                      {/* Header bar — inside chart column */}
                      <div className="flex items-start justify-between gap-4 px-4 lg:px-6 py-5">
                        <div>
                          <div className="text-lg font-semibold">Cost Breakdown</div>
                          <div className="text-xs text-muted-foreground mt-0.5">All fee categories over time</div>
                        </div>
                        <ChartSelectors chart={financialsSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                      </div>
                      {/* Chart */}
                      <div className="pl-4 lg:pl-6 pr-0 pb-4 flex-1">
                      <ChartContainer
                        config={{
                          shipping: { label: "Shipping", color: "hsl(215, 65%, 55%)" },
                          surcharges: { label: "Surcharges", color: "hsl(200, 50%, 45%)" },
                          extraPicks: { label: "Extra Picks", color: "hsl(25, 85%, 55%)" },
                          warehousing: { label: "Warehousing", color: "hsl(260, 55%, 58%)" },
                          multiHubIQ: { label: "MultiHub", color: "hsl(45, 80%, 50%)" },
                          b2b: { label: "B2B", color: "hsl(340, 70%, 55%)" },
                          vasKitting: { label: "VAS", color: "hsl(280, 60%, 55%)" },
                          receiving: { label: "Receiving", color: "hsl(160, 55%, 42%)" },
                          returns: { label: "Returns", color: "hsl(0, 65%, 52%)" },
                          dutyTax: { label: "Duty/Tax", color: "hsl(195, 60%, 40%)" },
                          other: { label: "Other", color: "hsl(90, 45%, 45%)" },
                        }}
                        className="h-[440px] w-full [&_svg]:overflow-visible"
                      >
                        <AreaChart data={finBillingTrend} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fillShipping" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-shipping)" stopOpacity={0.6} />
                              <stop offset="95%" stopColor="var(--color-shipping)" stopOpacity={0.15} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                          <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} tick={{ fill: 'hsl(var(--foreground))' }} />
                          <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} allowDecimals={false} domain={billingChartYDomain} allowDataOverflow tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`} />
                          <ChartTooltip
                            content={({ active, payload, label }) => {
                              if (!active || !payload?.length) return null
                              const labelMap: Record<string, string> = { credit: 'Credit', dutyTax: 'Duty/Tax', vasKitting: 'VAS', multiHubIQ: 'MultiHub', extraPicks: 'Extra Picks', surcharges: 'Surcharges', returns: 'Returns', other: 'Other' }
                              const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0)
                              return (
                                <div className="rounded-lg border bg-background px-3 py-2.5 text-[11px] shadow-xl min-w-[200px]">
                                  <div className="text-xs font-semibold mb-2">{label}</div>
                                  <div className="space-y-1.5">
                                    {payload.map((p) => (
                                      <div key={String(p.name)} className="flex items-center gap-2">
                                        <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: p.color }} />
                                        <div className="flex flex-1 justify-between items-center leading-none">
                                          <span className="text-muted-foreground">{labelMap[String(p.name)] || (String(p.name).charAt(0).toUpperCase() + String(p.name).slice(1))}</span>
                                          <span className={`font-mono font-medium tabular-nums ml-6 ${p.name === 'credit' ? 'text-green-600' : 'text-foreground'}`}>${Number(p.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex justify-between items-center mt-2 pt-2 border-t border-border text-[11px] font-semibold">
                                    <span>Total</span>
                                    <span className="font-mono tabular-nums ml-6">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="shipping" stackId="1" stroke="var(--color-shipping)" fill="url(#fillShipping)" />
                          <Area type="monotone" dataKey="surcharges" stackId="1" stroke="var(--color-surcharges)" fill="var(--color-surcharges)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="extraPicks" stackId="1" stroke="var(--color-extraPicks)" fill="var(--color-extraPicks)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="warehousing" stackId="1" stroke="var(--color-warehousing)" fill="var(--color-warehousing)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="multiHubIQ" stackId="1" stroke="var(--color-multiHubIQ)" fill="var(--color-multiHubIQ)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="b2b" stackId="1" stroke="var(--color-b2b)" fill="var(--color-b2b)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="vasKitting" stackId="1" stroke="var(--color-vasKitting)" fill="var(--color-vasKitting)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="receiving" stackId="1" stroke="var(--color-receiving)" fill="var(--color-receiving)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="returns" stackId="1" stroke="var(--color-returns)" fill="var(--color-returns)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="dutyTax" stackId="1" stroke="var(--color-dutyTax)" fill="var(--color-dutyTax)" fillOpacity={0.55} />
                          <Area type="monotone" dataKey="other" stackId="1" stroke="var(--color-other)" fill="var(--color-other)" fillOpacity={0.55} />
                        </AreaChart>
                      </ChartContainer>
                      {/* Legend */}
                      <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-1 mt-4 text-[11px] relative z-[2]">
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(215, 65%, 55%)' }} /><span>Shipping</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(200, 50%, 45%)' }} /><span>Surcharges</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(25, 85%, 55%)' }} /><span>Picks</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(260, 55%, 58%)' }} /><span>Storage</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(45, 80%, 50%)' }} /><span>MultiHub</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(340, 70%, 55%)' }} /><span>B2B</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(280, 60%, 55%)' }} /><span>VAS</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(160, 55%, 42%)' }} /><span>Receiving</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(0, 65%, 52%)' }} /><span>Returns</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(195, 60%, 40%)' }} /><span>Tax</span></div>
                        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(90, 45%, 45%)' }} /><span>Other</span></div>
                      </div>
                      </div>
                    </div>

                    {/* Summary Sidebar — 1 column, content area has border + gradient, fades to page bg below */}
                    <div className="lg:col-span-1 border-t lg:border-t-0 flex flex-col">
                      <div className="lg:border-l border-border bg-gradient-to-b from-zinc-100 via-zinc-50 to-zinc-50 dark:from-zinc-800 dark:via-zinc-900 dark:to-zinc-900 flex flex-col h-[calc(100%-76px)]">
                      <div className="border-b border-border px-5 h-[52px] flex items-center">
                        <div className="text-sm font-semibold">Period Summary</div>
                      </div>
                      {/* Row 1: Total Cost — full width */}
                      <div className="flex flex-col items-center justify-center px-4 bg-sky-50/50 dark:bg-sky-950/20 border-b border-border flex-1">
                        <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Total Cost</div>
                        <div className="text-3xl font-bold tabular-nums">
                          ${finBillingSummary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className={cn(
                          "text-xs mt-1",
                          finBillingSummary.periodChange.totalCost > 0 ? "text-red-500" : finBillingSummary.periodChange.totalCost < 0 ? "text-green-500" : "text-zinc-400 dark:text-zinc-500"
                        )}>
                          {finBillingSummary.periodChange.totalCost > 0 ? "+" : ""}{finBillingSummary.periodChange.totalCost.toFixed(1)}% vs prev period
                        </div>
                      </div>
                      {/* Row 2: Orders | Cost per Order */}
                      <div className="grid grid-cols-2 border-b border-border flex-1">
                        <div className="flex flex-col items-center justify-center px-3 border-r border-border bg-emerald-50/50 dark:bg-emerald-950/20">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Orders</div>
                          <div className="text-2xl font-bold tabular-nums">{finBillingSummary.orderCount.toLocaleString()}</div>
                          <div className={cn(
                            "text-[10px] mt-0.5",
                            finBillingSummary.periodChange.orderCount > 0 ? "text-green-500" : finBillingSummary.periodChange.orderCount < 0 ? "text-red-500" : "text-zinc-400 dark:text-zinc-500"
                          )}>
                            {finBillingSummary.periodChange.orderCount > 0 ? "+" : ""}{finBillingSummary.periodChange.orderCount.toFixed(1)}%
                          </div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-3 bg-amber-50/40 dark:bg-amber-950/15">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Cost / Order</div>
                          <div className="text-2xl font-bold tabular-nums">${finBillingSummary.costPerOrder.toFixed(2)}</div>
                          <div className={cn(
                            "text-[10px] mt-0.5",
                            finBillingSummary.periodChange.costPerOrder > 0 ? "text-red-500" : finBillingSummary.periodChange.costPerOrder < 0 ? "text-green-500" : "text-zinc-400 dark:text-zinc-500"
                          )}>
                            {finBillingSummary.periodChange.costPerOrder > 0 ? "+" : ""}{finBillingSummary.periodChange.costPerOrder.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                      {/* Row 3: Cost/Item | Items/Order | % of Revenue */}
                      <div className="grid grid-cols-3 border-b border-border flex-1">
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Cost / Item</div>
                          <div className="text-lg font-bold tabular-nums">${(finBillingEfficiency?.costPerItem ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Items / Order</div>
                          <div className="text-lg font-bold tabular-nums">{(finBillingEfficiency?.avgItemsPerOrder ?? 0).toFixed(1)}</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">% of Revenue</div>
                          <div className="text-lg font-bold tabular-nums">{(finBillingEfficiency?.fulfillmentAsPercentOfRevenue ?? 0).toFixed(1)}%</div>
                        </div>
                      </div>
                      {/* Row 4: Avg Rev/Order | Surcharge % | Credits */}
                      <div className="grid grid-cols-3 flex-1 border-b border-border">
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border bg-indigo-50/40 dark:bg-indigo-950/15">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Rev / Order</div>
                          <div className="text-lg font-bold tabular-nums">${(finBillingEfficiency?.avgRevenuePerOrder ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Surcharges</div>
                          <div className="text-lg font-bold tabular-nums">{(finBillingEfficiency?.surchargePercentOfCost ?? 0).toFixed(1)}%</div>
                          <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">of fulfillment cost</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 bg-green-50/50 dark:bg-green-950/15">
                          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Credits</div>
                          <div className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400">-${(finBillingEfficiency?.totalCredits ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                        </div>
                      </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 lg:px-8 py-5 space-y-5">
                {/* Row 2: Cost Distribution + Pick/Pack + Cost per Order Trend */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {/* Cost Distribution */}
                  <Card className="bg-transparent shadow-none">
                    <CardHeader className="pb-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm font-medium"><div>Cost Distribution</div></CardTitle>
                          <CardDescription className="text-xs">Breakdown by category</CardDescription>
                        </div>
                        <ChartSelectors chart={costDistChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {(() => {
                        const categories = costDistChart.data as BillingCategoryBreakdown[]
                        const colors = [
                          'hsl(203, 61%, 50%)',   // Jetpack blue
                          'hsl(203, 45%, 65%)',   // Lighter blue
                          'hsl(32, 85%, 55%)',    // Warm amber
                          'hsl(142, 50%, 45%)',   // Green
                          'hsl(346, 65%, 55%)',   // Rose
                          'hsl(262, 50%, 55%)',   // Purple
                          'hsl(203, 30%, 72%)',   // Muted blue
                          'hsl(18, 70%, 55%)',    // Coral
                        ]
                        const positiveCategories = categories.filter(c => c.amount > 0)
                        const negativeCategories = categories.filter(c => c.amount < 0)
                        const positiveTotal = positiveCategories.reduce((s, c) => s + c.amount, 0)

                        return (
                          <div>
                            {/* Total */}
                            <div className="flex items-baseline gap-2 mb-4">
                              <span className="text-2xl font-bold tabular-nums">
                                ${billingSummary.totalCost >= 1000 ? `${(billingSummary.totalCost / 1000).toFixed(1)}k` : billingSummary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                              <span className="text-xs text-muted-foreground">total spend</span>
                            </div>

                            {/* Stacked proportion bar */}
                            <div className="h-3 rounded-full overflow-hidden flex mb-5 bg-muted/20">
                              {positiveCategories.map((cat, idx) => {
                                const originalIdx = categories.indexOf(cat)
                                const widthPct = positiveTotal > 0 ? (cat.amount / positiveTotal) * 100 : 0
                                return (
                                  <div
                                    key={cat.category}
                                    className="h-full transition-all"
                                    style={{
                                      width: `${widthPct}%`,
                                      backgroundColor: colors[originalIdx] || colors[idx % colors.length],
                                      opacity: 0.85,
                                    }}
                                  />
                                )
                              })}
                            </div>

                            {/* Category rows */}
                            <div className="space-y-2.5">
                              {categories.map((cat, idx) => {
                                const isNegative = cat.amount < 0
                                return (
                                  <div key={cat.category} className="flex items-center gap-2.5">
                                    <span
                                      className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                                      style={{ backgroundColor: colors[idx % colors.length] }}
                                    />
                                    <span className="text-xs flex-1 truncate">{cat.category}</span>
                                    <span className={`text-xs font-medium tabular-nums text-right ${isNegative ? 'text-green-600' : ''}`}>
                                      {isNegative ? '-' : ''}${Math.abs(cat.amount) >= 1000
                                        ? `${(Math.abs(cat.amount) / 1000).toFixed(1)}k`
                                        : Math.abs(cat.amount).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                    <span className={`text-[11px] tabular-nums text-right w-12 ${isNegative ? 'text-green-600' : 'text-muted-foreground'}`}>
                                      {cat.percent >= 0 ? '' : ''}{cat.percent.toFixed(1)}%
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}
                    </CardContent>
                  </Card>

                  {/* Pick/Pack Distribution */}
                  <Card className="bg-transparent shadow-none">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Pick &amp; Pack Distribution</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Orders by item count</div>
                      </div>
                      <ChartSelectors chart={pickPackChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                    </div>
                    <CardContent>
                      <ChartContainer
                        config={{
                          orderCount: { label: "Orders", color: "hsl(var(--chart-1))" },
                        }}
                        className="h-[240px] w-full"
                      >
                        <BarChart data={pickPackChart.data as PickPackDistribution[]} margin={{ top: 20, right: 10, left: 10, bottom: 5 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis type="category" dataKey="itemCount" tickLine={false} axisLine={false} fontSize={11} />
                          <YAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => v.toLocaleString()} />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="dot" />}
                          />
                          <Bar dataKey="orderCount" fill="var(--color-orderCount)" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ChartContainer>
                      {/* Stats */}
                      <div className="grid grid-cols-5 gap-2 mt-3 text-center">
                        {(pickPackChart.data as PickPackDistribution[]).map((pp) => (
                          <div key={pp.itemCount} className="p-2 bg-muted/30 rounded">
                            <div className="text-[10px] text-muted-foreground">{pp.itemCount} {pp.itemCount === '1' ? 'item' : 'items'}</div>
                            <div className="text-sm font-semibold tabular-nums">{pp.percent.toFixed(1)}%</div>
                            <div className="text-[10px] text-muted-foreground tabular-nums">{pp.orderCount.toLocaleString()} orders</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Cost per Order Trend */}
                  <Card className="bg-transparent shadow-none">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Cost per Order Trend</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Average cost over time</div>
                      </div>
                      <ChartSelectors chart={costPerOrderChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                    </div>
                    <CardContent>
                      <ChartContainer
                        config={{
                          costPerOrder: { label: "Cost per Order", color: "hsl(var(--chart-1))" },
                        }}
                        className="h-[240px] w-full"
                      >
                        <AreaChart data={costPerOrderChart.data as CostPerOrderTrend[]} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fillCostPerOrder" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-costPerOrder)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--color-costPerOrder)" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} fontSize={10} tickMargin={8} />
                          <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `$${Number(v).toFixed(2)}`} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="dot"
                                formatter={(value, name, item) => (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">Cost per Order</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground ml-4">${Number(value).toFixed(2)}</span>
                                    </div>
                                  </>
                                )}
                              />
                            }
                          />
                          <Area type="monotone" dataKey="costPerOrder" stroke="var(--color-costPerOrder)" fill="url(#fillCostPerOrder)" />
                        </AreaChart>
                      </ChartContainer>
                      {/* Min/Max indicators */}
                      <div className="flex justify-between mt-3 text-xs">
                        <div className="p-2 bg-green-500/10 rounded">
                          <div className="text-[10px] text-muted-foreground">Lowest</div>
                          <div className="font-semibold text-green-600 tabular-nums">
                            ${(costPerOrderChart.data as CostPerOrderTrend[]).length > 0 ? Math.min(...(costPerOrderChart.data as CostPerOrderTrend[]).map(d => d.costPerOrder)).toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <div className="p-2 bg-muted/30 rounded">
                          <div className="text-[10px] text-muted-foreground">Average</div>
                          <div className="font-semibold tabular-nums">
                            ${(costPerOrderChart.data as CostPerOrderTrend[]).length > 0 ? ((costPerOrderChart.data as CostPerOrderTrend[]).reduce((s, d) => s + d.costPerOrder, 0) / (costPerOrderChart.data as CostPerOrderTrend[]).length).toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <div className="p-2 bg-red-500/10 rounded">
                          <div className="text-[10px] text-muted-foreground">Highest</div>
                          <div className="font-semibold text-red-600 tabular-nums">
                            ${(costPerOrderChart.data as CostPerOrderTrend[]).length > 0 ? Math.max(...(costPerOrderChart.data as CostPerOrderTrend[]).map(d => d.costPerOrder)).toFixed(2) : '0.00'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 3: Shipping by Zone + Surcharge Breakdown */}
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Shipping Cost by Zone */}
                  <Card className="bg-transparent shadow-none">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Shipping Cost by Zone</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Zone-based shipping analysis</div>
                      </div>
                      <ChartSelectors chart={shippingByZoneChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                    </div>
                    <CardContent>
                      <ChartContainer
                        config={{
                          avgShipping: { label: "Avg Shipping", color: "hsl(var(--chart-1))" },
                        }}
                        className="h-[260px] w-full"
                      >
                        <ComposedChart data={shippingCostByZone} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="zone" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => v === 'Intl' ? 'Intl' : `Zone ${v}`} />
                          <YAxis yAxisId="left" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} tickFormatter={(v) => `$${v}`} />
                          <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} fontSize={11} allowDecimals={false} tickFormatter={(v) => v.toLocaleString()} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="dot"
                                labelFormatter={(value) => value === 'Intl' ? 'International' : `Zone ${value}`}
                                formatter={(value, name, item) => (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">{name === 'avgShipping' ? 'Avg Shipping' : 'Orders'}</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground ml-4">{name === 'avgShipping' ? `$${Number(value).toFixed(2)}` : Number(value).toLocaleString()}</span>
                                    </div>
                                  </>
                                )}
                              />
                            }
                          />
                          <Bar yAxisId="left" dataKey="avgShipping" fill="var(--color-avgShipping)" radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="orderCount" stroke="hsl(0, 0%, 25%)" strokeWidth={2} dot={{ fill: 'hsl(0, 0%, 25%)', strokeWidth: 0, r: 4 }} />
                        </ComposedChart>
                      </ChartContainer>
                      <div className="flex justify-center gap-6 mt-2 text-xs">
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(var(--chart-1))' }} /><span>Avg Shipping Cost</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(0, 0%, 25%)' }} /><span>Order Volume</span></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Additional Services Breakdown */}
                  <Card className="bg-transparent shadow-none">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Additional Services Breakdown</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Breakdown of additional service fees</div>
                      </div>
                      <ChartSelectors chart={additionalSvcChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                    </div>
                    <CardContent>
                      <ChartContainer
                        config={{
                          amount: { label: "Amount", color: "hsl(var(--chart-1))" },
                        }}
                        className="w-full" style={{ height: `${Math.max(200, ((additionalSvcChart.data as AdditionalServicesBreakdown[])?.length || 0) * 28 + 30)}px` }}
                      >
                        <BarChart data={additionalSvcChart.data as AdditionalServicesBreakdown[]} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                          <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} fontSize={10} width={120} interval={0} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="dot"
                                formatter={(value, name, item) => (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">Amount</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground ml-4">${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                  </>
                                )}
                              />
                            }
                          />
                          <Bar dataKey="amount" fill="var(--color-amount)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                      {/* Additional services summary stats */}
                      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t">
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">Total Fees</div>
                          <div className="text-sm font-bold tabular-nums">
                            ${(additionalSvcChart.data as AdditionalServicesBreakdown[]).reduce((s, d) => s + d.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">Transactions</div>
                          <div className="text-sm font-bold tabular-nums">
                            {(additionalSvcChart.data as AdditionalServicesBreakdown[]).reduce((s, d) => s + d.transactionCount, 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">Avg Fee</div>
                          <div className="text-sm font-bold tabular-nums">
                            ${(additionalSvcChart.data as AdditionalServicesBreakdown[]).length > 0 && (additionalSvcChart.data as AdditionalServicesBreakdown[]).reduce((s, d) => s + d.transactionCount, 0) > 0
                              ? ((additionalSvcChart.data as AdditionalServicesBreakdown[]).reduce((s, d) => s + d.amount, 0) / (additionalSvcChart.data as AdditionalServicesBreakdown[]).reduce((s, d) => s + d.transactionCount, 0)).toFixed(2)
                              : '0.00'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 4: Detailed Breakdown Table */}
                <Card className="bg-transparent shadow-none">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-medium"><div>Weekly Fee Breakdown</div></CardTitle>
                        <CardDescription className="text-xs">Detailed breakdown by category</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <ChartSelectors chart={feeBreakdownChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideCountry />
                        <Button variant="outline" size="sm" className="h-[28px] text-xs">
                          <DownloadIcon className="w-4 h-4 mr-1" />
                          Export
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-[7px]">
                    {(() => {
                      const feeData = [...(feeBreakdownChart.data as MonthlyBillingTrend[])].reverse()
                      return (
                    <div className="rounded-md border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="border-b bg-muted/50 text-[10px]">
                              <th className="text-left px-2 py-2 font-medium">Week</th>
                              <th className="text-right px-2 py-2 font-medium">Orders</th>
                              <th className="text-right px-2 py-2 font-medium">Shipping</th>
                              <th className="text-right px-2 py-2 font-medium">Surcharges</th>
                              <th className="text-right px-2 py-2 font-medium">Extra Picks</th>
                              <th className="text-right px-2 py-2 font-medium">Warehousing</th>
                              <th className="text-right px-2 py-2 font-medium">MultiHub</th>
                              <th className="text-right px-2 py-2 font-medium">B2B</th>
                              <th className="text-right px-2 py-2 font-medium">VAS</th>
                              <th className="text-right px-2 py-2 font-medium">Receiving</th>
                              <th className="text-right px-2 py-2 font-medium">Returns</th>
                              <th className="text-right px-2 py-2 font-medium">Duty/Tax</th>
                              <th className="text-right px-2 py-2 font-medium">Other</th>
                              <th className="text-right px-2 py-2 font-medium">Credit</th>
                              <th className="text-right px-2 py-2 font-medium">Total</th>
                              <th className="text-right px-2 py-2 font-medium">$/Order</th>
                            </tr>
                          </thead>
                          <tbody>
                            {feeData.map((month, idx) => (
                              <tr key={month.month} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="px-2 py-1.5 font-medium whitespace-nowrap">{month.monthLabel}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">{month.orderCount.toLocaleString()}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.shipping.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.surcharges.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.extraPicks.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.warehousing.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.multiHubIQ.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.b2b.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.vasKitting.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.receiving.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.returns.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.dutyTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums">${month.other.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className={cn("px-2 py-1.5 text-right tabular-nums", month.credit < 0 ? "text-green-600" : "")}>
                                  ${month.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">${month.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">${month.costPerOrder.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 bg-muted/30 font-semibold">
                              <td className="px-2 py-1.5">Total</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{feeData.reduce((s, m) => s + m.orderCount, 0).toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.shipping, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.surcharges, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.extraPicks, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.warehousing, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.multiHubIQ, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.b2b, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.vasKitting, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.receiving, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.returns, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.dutyTax, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.other, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-green-600">${feeData.reduce((s, m) => s + m.credit, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">${feeData.reduce((s, m) => s + m.total, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                                ${feeData.length > 0 ? (feeData.reduce((s, m) => s + m.total, 0) / feeData.reduce((s, m) => s + m.orderCount, 0)).toFixed(2) : '0.00'}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                      )
                    })()}
                  </CardContent>
                </Card>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 2: Cost & Speed Analysis */}
              <TabsContent value="cost-speed" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 h-[calc(100vh-64px)] overflow-y-auto bg-gradient-to-b from-zinc-100 via-zinc-50 to-white dark:from-zinc-800 dark:via-zinc-900 dark:to-zinc-950">
                  <div className="flex items-start justify-between gap-4 px-5 lg:px-8 pt-6 pb-2">
                    <div>
                      <div className="text-lg font-semibold">Shipping Cost + Speed</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Average shipping cost and transit time analysis</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <Checkbox
                          checked={includeInternational}
                          onCheckedChange={(checked) => setIncludeInternational(checked === true)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">Include International</span>
                      </label>
                      <ChartSelectors chart={costSpeedKpiSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                    </div>
                  </div>

                  {/* KPI Summary Row */}
                  <div className="border-y border-border mt-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4">
                      <div className="text-center px-4 py-5 border-r border-border/50 bg-indigo-50/30 dark:bg-indigo-950/10">
                        <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Period Avg. Shipping Cost</div>
                        <div className="text-2xl font-bold tabular-nums">{kpiSectionAvgCost !== null ? `$${kpiSectionAvgCost.toFixed(2)}` : '—'}</div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">per order</div>
                      </div>
                      <div className="text-center px-4 py-5 lg:border-r border-border/50 bg-amber-50/30 dark:bg-amber-950/10">
                        <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Avg. Fulfillment <KpiTooltip text={KPI_TOOLTIPS.fulfillTime} /></div>
                        <div className="text-2xl font-bold tabular-nums">
                          {kpiSectionKpis.avgFulfillTime > 0 ? kpiSectionKpis.avgFulfillTime.toFixed(1) : '—'}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">operating hours</div>
                      </div>
                      <div className="text-center px-4 py-5 border-t lg:border-t-0 border-r border-border/50 bg-emerald-50/40 dark:bg-emerald-950/15">
                        <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Avg. Middle Mile <KpiTooltip text={KPI_TOOLTIPS.middleMile} /></div>
                        <div className="text-2xl font-bold tabular-nums">
                          {kpiSectionMiddleMile > 0 ? kpiSectionMiddleMile.toFixed(1) : '—'}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">calendar days</div>
                      </div>
                      <div className="text-center px-4 py-5 border-t lg:border-t-0 bg-sky-50/40 dark:bg-sky-950/15">
                        <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Avg. Last Mile <KpiTooltip text={KPI_TOOLTIPS.lastMile} /></div>
                        <div className="text-2xl font-bold tabular-nums">
                          {kpiSectionKpis.avgTransitTime > 0 ? kpiSectionKpis.avgTransitTime.toFixed(1) : '—'}
                        </div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">calendar days</div>
                      </div>
                    </div>
                  </div>

                  {/* Geography: Cost + Carrier Transit by State */}
                  {(() => {
                    const mapCountry = costSpeedMapSection.country
                    const allData = mapStateCostSpeedData as StateCostSpeedData[]
                    const usConfig = COUNTRY_CONFIGS['US']
                    const caConfig = COUNTRY_CONFIGS['CA']
                    const usData = mapCountry === 'CA' ? [] : allData.filter(d => usConfig.codeToName[d.state])
                    const caData = mapCountry === 'US' ? [] : allData.filter(d => caConfig.codeToName[d.state])
                    const showUS = mapCountry === 'US' || (mapCountry === 'ALL' && usData.length > 0)
                    const showCA = mapCountry === 'CA' || (mapCountry === 'ALL' && caData.length > 0)
                    if (!showUS && !showCA) return null
                    return (
                      <div className="border-b border-border">
                        <div className="flex items-start justify-between gap-4 px-5 lg:px-8 pt-5 pb-2">
                          <div>
                            <div className="text-sm font-semibold">
                              Cost + Last Mile Transit Time by {mapCountry === 'CA' ? 'Province' : mapCountry === 'ALL' ? 'State / Province' : 'State'}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">Geographic distribution of shipping costs and carrier transit times</div>
                          </div>
                          <ChartSelectors chart={costSpeedMapSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                        </div>
                        <div className="px-5 lg:px-8 pt-5 pb-5">
                          <div className="grid gap-6 md:grid-cols-2">
                            <div>
                              <div className="text-sm font-medium text-center mb-0 mt-3">Average Shipping Cost</div>
                              {showCA && (
                                <CostSpeedStateMap data={caData} metric="cost" title="" country="CA" />
                              )}
                              {showUS && (
                                <CostSpeedStateMap data={usData} metric="cost" title="" country="US" />
                              )}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-center mb-0 mt-3">Average Last Mile Transit</div>
                              {showCA && (
                                <CostSpeedStateMap data={caData} metric="transit" title="" country="CA" />
                              )}
                              {showUS && (
                                <CostSpeedStateMap data={usData} metric="transit" title="" country="US" />
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Chart sections */}
                  <div className="px-5 lg:px-8 pb-8 pt-5 space-y-5">

                    {/* Average Cost over Time */}
                    <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                        <div>
                          <div className="text-sm font-semibold">Average Cost over Time</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Cost per order with and without surcharges</div>
                        </div>
                        <ChartSelectors chart={costTrendChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                      </div>
                      <div className="px-6 pb-6 pt-2">
                    <ChartContainer
                      config={{
                        avgCostBase: {
                          label: "Base Cost",
                          color: "hsl(var(--chart-1))",
                        },
                        avgCostWithSurcharge: {
                          label: "With Surcharges",
                          color: "hsl(var(--chart-2))",
                        },
                        movingAverage: {
                          label: `${maWindowSize}-Day Average`,
                          color: "hsl(var(--chart-3))",
                        },
                      }}
                      className="aspect-auto h-[280px] w-full"
                    >
                      <ComposedChart data={chartCostTrendWithMA} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="fillCostBase" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor="var(--color-avgCostBase)"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="var(--color-avgCostBase)"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                          <linearGradient id="fillCostWithSurcharge" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor="var(--color-avgCostWithSurcharge)"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="var(--color-avgCostWithSurcharge)"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="month"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={32}
                          tick={axisTick}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tick={axisTick}
                          tickFormatter={(value) => `$${value}`}
                          domain={chartCostYAxisConfig.domain}
                          ticks={chartCostYAxisConfig.ticks}
                          width={45}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              formatter={(value, name, item) => (
                                <>
                                  <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                  <div className="flex flex-1 justify-between items-center leading-none">
                                    <span className="text-muted-foreground">{item.name === 'avgCostBase' ? 'Base Cost' : item.name === 'movingAverage' ? `${maWindowSize}-Day Avg` : 'With Surcharges'}</span>
                                    <span className="font-mono font-medium tabular-nums text-foreground ml-4">${Number(value).toFixed(2)}</span>
                                  </div>
                                </>
                              )}
                            />
                          }
                        />
                        <Area
                          dataKey="avgCostWithSurcharge"
                          type="natural"
                          fill="url(#fillCostWithSurcharge)"
                          stroke="var(--color-avgCostWithSurcharge)"
                        />
                        <Area
                          dataKey="avgCostBase"
                          type="natural"
                          fill="url(#fillCostBase)"
                          stroke="var(--color-avgCostBase)"
                        />
                        <Line
                          dataKey="movingAverage"
                          type="monotone"
                          stroke="var(--color-movingAverage)"
                          strokeWidth={2}
                          dot={(props: any) => {
                            const showDot = props.index % maWindowSize === 0
                            return (
                              <circle
                                key={props.index}
                                cx={props.cx}
                                cy={props.cy}
                                r={showDot ? 3 : 0}
                                fill="var(--color-movingAverage)"
                              />
                            )
                          }}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                      </ComposedChart>
                    </ChartContainer>
                      </div>
                    </div>

                    {/* Order-to-Delivery Breakdown */}
                    <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                        <div>
                          <div className="text-sm font-semibold">Order-to-Delivery Breakdown</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Stacked components of total delivery time</div>
                        </div>
                        <ChartSelectors chart={deliverySpeedChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                      </div>
                      <div className="px-6 pb-6 pt-2">
                    <ChartContainer
                      config={{
                        avgCarrierTransitDays: {
                          label: "Last Mile",
                          color: "hsl(203 61% 50%)",
                        },
                        middleMileDays: {
                          label: "Middle Mile",
                          color: "hsl(35 90% 58%)",
                        },
                        fulfillmentDays: {
                          label: "Fulfillment",
                          color: "hsl(152 60% 45%)",
                        },
                        avgFulfillTimeHours: {
                          label: "Fulfillment (hours)",
                          color: "hsl(152 60% 45%)",
                        },
                      }}
                      className="aspect-auto h-[300px] w-full"
                    >
                      <ComposedChart
                        data={chartDeliverySpeedTrend}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="fillLastMile" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(203 61% 50%)" stopOpacity={0.7} />
                            <stop offset="95%" stopColor="hsl(203 61% 50%)" stopOpacity={0.15} />
                          </linearGradient>
                          <linearGradient id="fillMiddleMile" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(35 90% 58%)" stopOpacity={0.7} />
                            <stop offset="95%" stopColor="hsl(35 90% 58%)" stopOpacity={0.15} />
                          </linearGradient>
                          <linearGradient id="fillFulfillDays" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(152 60% 45%)" stopOpacity={0.7} />
                            <stop offset="95%" stopColor="hsl(152 60% 45%)" stopOpacity={0.15} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={32}
                          tick={axisTick}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }}
                        />
                        <YAxis
                          yAxisId="days"
                          orientation="left"
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                          tick={axisTick}
                          tickFormatter={(value) => `${value}d`}
                          width={45}
                        />
                        <YAxis
                          yAxisId="hours"
                          orientation="right"
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                          tick={axisTick}
                          tickFormatter={(value) => `${value}h`}
                          width={40}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              formatter={(value, name, item) => {
                                const labels: Record<string, string> = { avgCarrierTransitDays: 'Last Mile', middleMileDays: 'Middle Mile', fulfillmentDays: 'Fulfillment', avgFulfillTimeHours: 'Fulfillment' }
                                const unit = name === 'avgFulfillTimeHours' ? 'h' : 'd'
                                // Hide fulfillmentDays from tooltip — we show avgFulfillTimeHours instead
                                if (name === 'fulfillmentDays') {
                                  // Show Order-to-Delivery total at the top
                                  const otd = item.payload?.avgOrderToDeliveryDays
                                  if (otd == null) return null
                                  return (
                                    <div className="flex flex-1 justify-between items-center leading-none pb-1 mb-1 border-b border-border/50">
                                      <span className="font-medium text-foreground">Order-to-Delivery</span>
                                      <span className="font-mono font-semibold tabular-nums text-foreground ml-4">{Number(otd).toFixed(1)}d</span>
                                    </div>
                                  )
                                }
                                return (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">{labels[name as string] || name}</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground ml-4">{Number(value).toFixed(1)}{unit}</span>
                                    </div>
                                  </>
                                )
                              }}
                            />
                          }
                        />
                        {/* Stacked areas: bottom → top = fulfillment, middle mile, last mile */}
                        <Area
                          yAxisId="days"
                          dataKey="fulfillmentDays"
                          type="monotone"
                          stackId="otd"
                          fill="url(#fillFulfillDays)"
                          stroke="hsl(152 60% 45%)"
                          strokeWidth={0}
                          dot={false}
                        />
                        <Area
                          yAxisId="days"
                          dataKey="middleMileDays"
                          type="monotone"
                          stackId="otd"
                          fill="url(#fillMiddleMile)"
                          stroke="hsl(35 90% 58%)"
                          strokeWidth={1}
                          dot={false}
                        />
                        <Area
                          yAxisId="days"
                          dataKey="avgCarrierTransitDays"
                          type="monotone"
                          stackId="otd"
                          fill="url(#fillLastMile)"
                          stroke="hsl(203 61% 50%)"
                          strokeWidth={1}
                          dot={false}
                        />
                        {/* Fulfillment dotted line on hours axis for granular visibility */}
                        <Line
                          yAxisId="hours"
                          dataKey="avgFulfillTimeHours"
                          type="monotone"
                          stroke="var(--color-avgFulfillTimeHours)"
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          dot={false}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                      </ComposedChart>
                    </ChartContainer>
                      </div>
                    </div>

                    {/* Cost by Zone */}
                    <div className="grid gap-5">
                      {/* Cost by Zone */}
                      <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                          <div>
                            <div className="text-sm font-semibold">Average Cost by Shipping Zone</div>
                            <div className="text-xs text-muted-foreground mt-0.5">Cost and transit time by zone distance</div>
                          </div>
                          <ChartSelectors chart={zoneCostChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideAllCountry />
                        </div>
                        <div className="px-6 pb-6 pt-2">
                    <ChartContainer
                      config={{
                        avgCost: {
                          label: "Avg Cost",
                          color: "hsl(var(--chart-1))",
                        },
                        avgTransitTime: {
                          label: "Carrier Transit",
                          color: "hsl(0 0% 25%)",
                        },
                      }}
                      className="h-[280px] w-full"
                    >
                      <ComposedChart
                        data={chartZoneCostData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="zone"
                          tickLine={false}
                          axisLine={false}
                          tick={axisTick}
                          tickFormatter={(value) => value === 'Intl' ? 'Intl' : zoneCostChart.country === 'US' ? `Zone ${value}` : `${value}`}
                        />
                        <YAxis
                          yAxisId="cost"
                          orientation="left"
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                          tick={axisTick}
                          tickFormatter={(value) => `$${value}`}
                          width={45}
                        />
                        <YAxis
                          yAxisId="transit"
                          orientation="right"
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                          tick={axisTick}
                          tickFormatter={(value) => `${value}d`}
                          width={40}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => value === 'Intl' ? 'International' : zoneCostChart.country === 'US' ? `Zone ${value}` : `Zone ${value}`}
                              formatter={(value, name, item) => (
                                <>
                                  <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                  <div className="flex flex-1 justify-between items-center leading-none">
                                    <span className="text-muted-foreground">{name === 'avgCost' ? 'Avg Cost' : 'Transit'}</span>
                                    <span className="font-mono font-medium tabular-nums text-foreground ml-4">{name === 'avgCost' ? `$${Number(value).toFixed(2)}` : `${Number(value).toFixed(1)}d`}</span>
                                  </div>
                                </>
                              )}
                            />
                          }
                        />
                        <Bar
                          yAxisId="cost"
                          dataKey="avgCost"
                          fill="var(--color-avgCost)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Line
                          yAxisId="transit"
                          type="monotone"
                          dataKey="avgTransitTime"
                          stroke="var(--color-avgTransitTime)"
                          strokeWidth={2}
                          dot={{ fill: "var(--color-avgTransitTime)", r: 4 }}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                      </ComposedChart>
                    </ChartContainer>
                        </div>
                      </div>

                    </div>

                  </div>
                </div>
              </TabsContent>

              {/* Tab 3: Order Volume */}
              <TabsContent value="order-volume" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 min-h-[calc(100vh-64px)] bg-zinc-50 dark:bg-zinc-900">
                  {/* Hero map section — full-bleed like Performance tab, sidebar spans full height */}
                  {isMounted && volumeData.stateData.length > 0 && selectedCountry !== 'ALL' && (
                    <div className="grid lg:grid-cols-3">
                      <div className="lg:col-span-2 relative flex flex-col after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[50%] after:bg-gradient-to-b after:from-transparent after:to-zinc-50 dark:after:to-zinc-900 after:pointer-events-none after:z-[1]">
                        {/* Header bar — inside map column (like Performance tab) */}
                        <div className="flex items-start justify-between gap-4 px-4 lg:px-6 py-5">
                          <div>
                            <div className="text-lg font-semibold">Order Volume</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              <span className="tabular-nums">{volumeData.stateData.reduce((sum, s) => sum + s.orderCount, 0).toLocaleString()} orders</span>
                              <span className="mx-1.5 text-border">|</span>
                              <span>Click a state for details</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 -mt-[2px]">
                            <Select value={dateRange} onValueChange={handleDatePresetChange}>
                              <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                                <SelectValue>{DATE_RANGE_PRESETS.find(p => p.value === dateRange)?.label || '30D'}</SelectValue>
                              </SelectTrigger>
                              <SelectContent align="end" className="font-roboto text-xs">
                                {DATE_RANGE_PRESETS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {(analyticsData?.availableCountries || []).length > 1 && (
                              <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v); setSelectedState(null) }}>
                                <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="end">
                                  <SelectItem value="ALL">All Countries</SelectItem>
                                  <SelectItem value="US">USA</SelectItem>
                                  {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                        <LayeredVolumeHeatMap
                          key={selectedCountry}
                          stateData={volumeData.stateData}
                          zipCodeData={volumeData.zipCodeData}
                          onStateSelect={(stateCode) => setSelectedVolumeState(stateCode)}
                          country={selectedCountry}
                        />
                      </div>

                      <div className="lg:col-span-1 border-t lg:border-t-0 lg:border-l border-border bg-gradient-to-b from-zinc-100 via-zinc-50 to-zinc-100 dark:from-zinc-800 dark:via-zinc-900 dark:to-zinc-900 lg:rounded-b-xl lg:border-b">
                        {selectedVolumeState && Array.isArray(volumeData.stateData) && volumeData.stateData.find(s => s.state === selectedVolumeState) ? (
                          <StateVolumeDetailsPanel
                            stateData={volumeData.stateData.find(s => s.state === selectedVolumeState)!}
                            cityData={volumeData.cityData}
                            onClose={() => setSelectedVolumeState(null)}
                          />
                        ) : (
                          <NationalVolumeOverviewPanel
                            stateData={volumeData.stateData}
                            cityData={volumeData.zipCodeData}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Charts — continuous grey background below hero */}
                  <div className="px-5 lg:px-8 py-5 space-y-5">

                {/* Daily Trend */}
                <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                    <div>
                      <div className="text-sm font-semibold">Daily Order Volume</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Order count trend over the selected period</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {dailyVolumeChart.isFetching && <JetpackLoader size="sm" />}
                      <Select value={dailyVolumeChart.preset} onValueChange={dailyVolumeChart.setPreset}>
                        <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                          <SelectValue>{CHART_DATE_PRESETS.find(p => p.value === dailyVolumeChart.preset)?.label || dateRangeDisplayLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end" className="font-roboto text-xs">
                          {CHART_DATE_PRESETS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(analyticsData?.availableCountries || []).length > 1 && (
                        <Select value={dailyVolumeChart.country} onValueChange={dailyVolumeChart.setCountry}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end" className="font-roboto text-xs">
                            <SelectItem value="ALL">All</SelectItem>
                            <SelectItem value="US">USA</SelectItem>
                            {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                  <div className="px-6 pb-6 pt-2">
                    <ChartContainer
                      config={{
                        orderCount: {
                          label: "Orders",
                          color: "hsl(var(--chart-1))",
                        },
                      }}
                      className="h-[300px] w-full"
                    >
                      <AreaChart
                        data={dailyVolumeChart.data}
                        margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-orderCount)" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="var(--color-orderCount)" stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          interval={(() => {
                            const chartData = dailyVolumeChart.data as DailyOrderVolume[]
                            const dataLength = chartData.length
                            if (dataLength <= 7) return 0
                            if (dataLength <= 30) return Math.floor(dataLength / 6)
                            if (dataLength <= 90) return Math.floor(dataLength / 5)
                            return Math.floor(dataLength / 8)
                          })()}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            const chartData = dailyVolumeChart.data as DailyOrderVolume[]
                            if (chartData.length > 90) {
                              return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                            }
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }}
                        />
                        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              indicator="dot"
                              labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            />
                          }
                        />
                        <Area
                          type="monotone"
                          dataKey="orderCount"
                          stroke="var(--color-orderCount)"
                          fill="url(#fillOrders)"
                          dot={false}
                        />
                      </AreaChart>
                    </ChartContainer>
                  </div>
                </div>

                {/* Pattern Charts Row */}
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Orders by Hour of Day</div>
                        <div className="text-xs text-muted-foreground mt-0.5">When do orders come in throughout the day?</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hourChart.isFetching && <JetpackLoader size="sm" />}
                        <Select value={hourChart.preset} onValueChange={hourChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{CHART_DATE_PRESETS.find(p => p.value === hourChart.preset)?.label || dateRangeDisplayLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end" className="font-roboto text-xs">
                            {CHART_DATE_PRESETS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(analyticsData?.availableCountries || []).length > 1 && (
                          <Select value={hourChart.country} onValueChange={hourChart.setCountry}>
                            <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end" className="font-roboto text-xs">
                              <SelectItem value="ALL">All</SelectItem>
                              <SelectItem value="US">USA</SelectItem>
                              {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                    <div className="px-6 pb-6 pt-2">
                      <ChartContainer
                        config={{
                          orderCount: {
                            label: "Orders",
                            color: "hsl(var(--chart-1))",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <BarChart
                          data={hourChart.data}
                          margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="hour"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => {
                              const hour = parseInt(value)
                              if (hour === 0) return '12am'
                              if (hour === 12) return '12pm'
                              if (hour < 12) return `${hour}am`
                              return `${hour - 12}pm`
                            }}
                          />
                          <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="dot"
                                labelFormatter={(value) => {
                                  const h = parseInt(value as string)
                                  if (h === 0) return '12:00 AM'
                                  if (h === 12) return '12:00 PM'
                                  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`
                                }}
                              />
                            }
                          />
                          <Bar
                            dataKey="orderCount"
                            fill="var(--color-orderCount)"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ChartContainer>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Orders by Day of Week</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Which days are busiest?</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {dowChart.isFetching && <JetpackLoader size="sm" />}
                        <Select value={dowChart.preset} onValueChange={dowChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{CHART_DATE_PRESETS.find(p => p.value === dowChart.preset)?.label || dateRangeDisplayLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end" className="font-roboto text-xs">
                            {CHART_DATE_PRESETS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(analyticsData?.availableCountries || []).length > 1 && (
                          <Select value={dowChart.country} onValueChange={dowChart.setCountry}>
                            <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end" className="font-roboto text-xs">
                              <SelectItem value="ALL">All</SelectItem>
                              <SelectItem value="US">USA</SelectItem>
                              {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                    <div className="px-6 pb-6 pt-2">
                      <ChartContainer
                        config={{
                          orderCount: {
                            label: "Orders",
                            color: "hsl(var(--chart-2))",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <BarChart
                          data={dowChart.data}
                          margin={{ top: 30, right: 20, left: 20, bottom: 0 }}
                        >
                          <CartesianGrid vertical={false} horizontal={false} />
                          <XAxis
                            dataKey="dayName"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => value.slice(0, 3)}
                          />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="dot" />}
                          />
                          <Bar
                            dataKey="orderCount"
                            fill="var(--color-orderCount)"
                            radius={[4, 4, 0, 0]}
                          >
                            <LabelList
                              dataKey="orderCount"
                              position="top"
                              formatter={(value: number) => value.toLocaleString()}
                              className="fill-foreground text-xs"
                            />
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                    </div>
                  </div>
                </div>

                {/* Distribution Tables Row */}
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Orders by Fulfillment Center</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Which FCs handle the most volume?</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {fcChart.isFetching && <JetpackLoader size="sm" />}
                        <Select value={fcChart.preset} onValueChange={fcChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{CHART_DATE_PRESETS.find(p => p.value === fcChart.preset)?.label || dateRangeDisplayLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end" className="font-roboto text-xs">
                            {CHART_DATE_PRESETS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(analyticsData?.availableCountries || []).length > 1 && (
                          <Select value={fcChart.country} onValueChange={fcChart.setCountry}>
                            <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end" className="font-roboto text-xs">
                              <SelectItem value="ALL">All</SelectItem>
                              <SelectItem value="US">USA</SelectItem>
                              {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                    <div className="px-6 pb-6 pt-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left p-3 font-semibold">FC</th>
                            <th className="text-right p-3 font-semibold">Orders</th>
                            <th className="text-right p-3 font-semibold">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(fcChart.data as OrderVolumeByFC[]).slice(0, 10).map((fc) => (
                            <tr key={fc.fcName} className="border-b border-border/50 hover:bg-muted/50">
                              <td className="p-3 font-medium">{fc.fcName}</td>
                              <td className="p-3 text-right">{fc.orderCount.toLocaleString()}</td>
                              <td className="p-3 text-right">{fc.percent.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Orders by Store Integration</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Which stores generate the most orders?</div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {storeChart.isFetching && <JetpackLoader size="sm" />}
                        <Select value={storeChart.preset} onValueChange={storeChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{CHART_DATE_PRESETS.find(p => p.value === storeChart.preset)?.label || dateRangeDisplayLabel}</SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end" className="font-roboto text-xs">
                            {CHART_DATE_PRESETS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {(analyticsData?.availableCountries || []).length > 1 && (
                          <Select value={storeChart.country} onValueChange={storeChart.setCountry}>
                            <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end" className="font-roboto text-xs">
                              <SelectItem value="ALL">All</SelectItem>
                              <SelectItem value="US">USA</SelectItem>
                              {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                    <div className="px-6 pb-6 pt-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left p-3 font-semibold">Store</th>
                            <th className="text-right p-3 font-semibold">Orders</th>
                            <th className="text-right p-3 font-semibold">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(storeChart.data as OrderVolumeByStore[]).slice(0, 10).map((store) => (
                            <tr key={store.storeIntegrationName} className="border-b border-border/50 hover:bg-muted/50">
                              <td className="p-3 font-medium">{store.storeIntegrationName}</td>
                              <td className="p-3 text-right">{store.orderCount.toLocaleString()}</td>
                              <td className="p-3 text-right">{store.percent.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 4: Carriers + Zones */}
              <TabsContent value="carriers-zones" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 h-[calc(100vh-64px)] overflow-y-auto bg-zinc-50 dark:bg-zinc-900">
                  <div className="px-5 lg:px-8 pt-6 pb-2">
                    <div className="text-lg font-semibold">Carriers + Zones</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Carrier performance and zone-level cost analysis</div>
                  </div>
                  <div className="px-5 lg:px-8 py-5 space-y-5">
                {/* Zone Performance Landscape - Feature Chart */}
                <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                    <div>
                      <div className="text-sm font-semibold">Zone Performance Landscape</div>
                      <div className="text-xs text-muted-foreground mt-0.5">How shipping cost and transit time scale with distance</div>
                    </div>
                    <ChartSelectors chart={carrierZoneChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideAllCountry />
                  </div>
                  <div className="px-6 pb-6 pt-2">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                      {/* Main Chart */}
                      <div className="lg:col-span-3">
                        <ChartContainer
                          config={{
                            avgCost: { label: "Avg Cost", color: "hsl(var(--chart-1))" },
                            avgTransitTime: { label: "Avg Transit", color: "hsl(var(--chart-2))" },
                            orderCount: { label: "Orders", color: "hsl(var(--chart-3))" },
                          }}
                          style={{ height: `${Math.max(280, Math.min(520, 32 + carrierZoneCostData.length * 44))}px` }}
                          className="w-full"
                        >
                          <ComposedChart
                            data={carrierZoneCostData}
                            margin={{ top: 30, right: 30, left: 20, bottom: 20 }}
                          >
                            <CartesianGrid vertical={false} />
                            <XAxis
                              dataKey="zone"
                              tickLine={false}
                              axisLine={false}
                              interval={0}
                              tick={axisTick}
                              tickFormatter={(value) => value === 'Intl' ? 'Intl' : carrierZoneChart.country === 'US' ? `Zone ${value}` : `${value}`}
                            />
                            <YAxis
                              yAxisId="cost"
                              orientation="left"
                              tickLine={false}
                              axisLine={false}
                              allowDecimals={false}
                              tickFormatter={(value) => `$${value}`}
                            />
                            <YAxis
                              yAxisId="volume"
                              orientation="right"
                              tickLine={false}
                              axisLine={false}
                              allowDecimals={false}
                              tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}
                            />
                            <ChartTooltip
                              content={
                                <ChartTooltipContent
                                  indicator="dot"
                                  labelFormatter={(value) => value === 'Intl' ? 'International' : carrierZoneChart.country === 'US' ? `Zone ${value}` : `Zone ${value}`}
                                  formatter={(value, name, item) => (
                                    <>
                                      <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                      <div className="flex flex-1 justify-between items-center leading-none">
                                        <span className="text-muted-foreground">{name === 'avgCost' ? 'Avg Cost' : 'Orders'}</span>
                                        <span className="font-mono font-medium tabular-nums text-foreground ml-4">{name === 'avgCost' ? `$${Number(value).toFixed(2)}` : Number(value).toLocaleString()}</span>
                                      </div>
                                    </>
                                  )}
                                />
                              }
                            />
                            <Bar
                              yAxisId="volume"
                              dataKey="orderCount"
                              fill="var(--color-orderCount)"
                              radius={[4, 4, 0, 0]}
                              opacity={0.3}
                            />
                            <Line
                              yAxisId="cost"
                              type="monotone"
                              dataKey="avgCost"
                              stroke="var(--color-avgCost)"
                              strokeWidth={3}
                              dot={{ fill: "var(--color-avgCost)", r: 5 }}
                            />
                          </ComposedChart>
                        </ChartContainer>
                        <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--chart-3))', opacity: 0.3 }} />
                            <span>Order Volume</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-0.5" style={{ backgroundColor: 'hsl(var(--chart-1))' }} />
                            <span>Avg Cost</span>
                          </div>
                        </div>
                      </div>

                      {/* Zone Summary Stats */}
                      <div className="space-y-3 overflow-y-auto pr-2" style={{ maxHeight: '520px' }}>
                        <div className="text-sm font-medium text-muted-foreground">Zone Distribution</div>
                        {carrierZoneCostData.map((zone) => {
                          const totalOrders = carrierZoneCostData.reduce((sum, z) => sum + z.orderCount, 0)
                          const percent = totalOrders > 0 ? (zone.orderCount / totalOrders * 100) : 0
                          return (
                            <div key={zone.zone} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium">Zone {zone.zone}</span>
                                <span className="text-muted-foreground tabular-nums">{percent.toFixed(1)}%</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${percent}%`,
                                    backgroundColor: `hsl(221.2, ${60 + percent * 0.5}%, ${60 - percent * 0.2}%)`
                                  }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Network Summary Row — driven by carrierZoneChart selectors */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {(() => {
                    const zoneData = carrierZoneCostData
                    const totalOrders = zoneData.reduce((sum, z) => sum + z.orderCount, 0)
                    const avgTransit = totalOrders > 0
                      ? zoneData.reduce((sum, z) => sum + (z.avgTransitTime * z.orderCount), 0) / totalOrders
                      : 0
                    const avgCost = totalOrders > 0
                      ? zoneData.reduce((sum, z) => sum + (z.avgCost * z.orderCount), 0) / totalOrders
                      : 0

                    return (
                      <>
                        <Card className="bg-transparent shadow-none">
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">{totalOrders.toLocaleString()}</div>
                              <div className="text-sm text-muted-foreground mt-1">Total Shipments</div>
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="bg-transparent shadow-none">
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">{zoneData.length}</div>
                              <div className="text-sm text-muted-foreground mt-1">Shipping Zones</div>
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="bg-transparent shadow-none">
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">{avgTransit.toFixed(1)} <span className="text-lg font-normal">days</span></div>
                              <div className="text-sm text-muted-foreground mt-1">Average Last Mile</div>
                            </div>
                          </CardContent>
                        </Card>
                        <Card className="bg-transparent shadow-none">
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">${avgCost.toFixed(2)}</div>
                              <div className="text-sm text-muted-foreground mt-1">Avg Cost per Shipment</div>
                            </div>
                          </CardContent>
                        </Card>
                      </>
                    )
                  })()}
                </div>

                {/* Your Carrier Network Section */}
                <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                    <div>
                      <div className="text-sm font-semibold">Your Carrier Network</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Distributed across {chartCarrierPerformance.length} carriers for optimal coverage</div>
                    </div>
                    <ChartSelectors chart={carrierSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideAllCountry />
                  </div>
                  <div className="px-6 pb-6 pt-2">
                    {(() => {
                      const totalOrders = chartCarrierPerformance.reduce((sum, c) => sum + c.orderCount, 0)
                      // Build per-carrier zone distribution lookup
                      const zonesByCarrier = new Map<string, { zone: string; count: number; percent: number }[]>()
                      for (const row of chartCarrierZoneBreakdown) {
                        if (!zonesByCarrier.has(row.carrier)) zonesByCarrier.set(row.carrier, [])
                        zonesByCarrier.get(row.carrier)!.push({ zone: row.zone, count: row.orderCount, percent: 0 })
                      }
                      // Calculate percentages and sort by zone number
                      for (const [, zones] of zonesByCarrier) {
                        const carrierTotal = zones.reduce((s, z) => s + z.count, 0)
                        for (const z of zones) z.percent = carrierTotal > 0 ? (z.count / carrierTotal) * 100 : 0
                        zones.sort((a, b) => {
                          const na = parseInt(a.zone) || 99
                          const nb = parseInt(b.zone) || 99
                          return na - nb
                        })
                      }
                      // Zone color scale: light → dark blue by distance
                      const zoneColor = (zone: string): string => {
                        const z = parseInt(zone) || 0
                        const colors: Record<number, string> = {
                          1: 'hsl(203 75% 82%)',
                          2: 'hsl(203 70% 72%)',
                          3: 'hsl(203 65% 62%)',
                          4: 'hsl(203 62% 54%)',
                          5: 'hsl(203 61% 47%)',
                          6: 'hsl(203 65% 40%)',
                          7: 'hsl(203 70% 33%)',
                          8: 'hsl(203 75% 26%)',
                        }
                        return colors[z] || 'hsl(203 30% 70%)'
                      }
                      // Build transit distribution lookup and find global max for consistent scale
                      const transitByCarrier = new Map(chartTransitDistribution.map(t => [t.carrier, t]))
                      const globalMaxTransit = chartTransitDistribution.length > 0
                        ? Math.max(...chartTransitDistribution.map(t => t.max))
                        : 1
                      // Generate nice tick marks for the shared axis
                      const axisTicks: number[] = []
                      const tickStep = 2
                      for (let t = 0; t <= globalMaxTransit; t += tickStep) axisTicks.push(t)
                      return (
                        <div className="rounded-md border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted">
                              <tr className="border-b text-xs">
                                <th className="py-2.5 px-3 text-left font-semibold w-[140px]">Carrier</th>
                                <th className="py-2.5 px-2 text-right font-semibold w-[70px]">Orders</th>
                                <th className="py-2.5 px-2 text-right font-semibold w-[50px]">Vol %</th>
                                <th className="py-2.5 px-2 text-right font-semibold w-[70px]">Avg Cost</th>
                                <th className="py-2.5 px-2 text-right font-semibold whitespace-nowrap w-[65px]">Transit</th>
                                <th className="p-3 text-left font-semibold pl-5" style={{ minWidth: 220 }}>
                                  <div className="flex items-center justify-between">
                                    <span className="whitespace-nowrap">Transit Time Distribution</span>
                                    <span className="font-normal text-[10px] text-muted-foreground flex items-center gap-2.5 pr-1">
                                      <span className="flex items-center gap-1">
                                        <span className="inline-block w-5 h-1 rounded-full" style={{ backgroundColor: 'hsl(203 61% 50% / 0.2)' }} />
                                        P5–P95
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <span className="inline-block w-3.5 h-2 rounded" style={{ backgroundColor: 'hsl(203 61% 50% / 0.45)' }} />
                                        mid 50%
                                      </span>
                                      <span className="flex items-center gap-1">
                                        <span className="inline-block w-0.5 h-2.5" style={{ backgroundColor: 'hsl(203 61% 50%)' }} />
                                        median
                                      </span>
                                    </span>
                                  </div>
                                </th>
                                {carrierSection.country === 'US' && (
                                <th className="p-3 text-left font-semibold pl-4" style={{ minWidth: 160 }}>
                                  <div className="flex items-center justify-between">
                                    <span className="whitespace-nowrap">Zone Distribution</span>
                                    <span className="font-normal text-[10px] text-muted-foreground flex items-center gap-1.5 pr-1">
                                      {[1,3,5,7].map(z => (
                                        <span key={z} className="flex items-center gap-0.5">
                                          <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: zoneColor(String(z)) }} />
                                          <span>{z}</span>
                                        </span>
                                      ))}
                                    </span>
                                  </div>
                                </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Top axis scale */}
                              <tr className="border-b">
                                <td colSpan={5} />
                                <td className="px-3 pl-5 py-1">
                                  <div className="relative h-3">
                                    {axisTicks.map(t => (
                                      <span key={t} className="absolute text-[9px] text-muted-foreground tabular-nums -translate-x-1/2" style={{ left: `${(t / globalMaxTransit) * 100}%` }}>
                                        {t}d
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                {carrierSection.country === 'US' && <td />}
                              </tr>
                              {chartCarrierPerformance.map((cp, idx) => {
                                const volumePercent = totalOrders > 0 ? (cp.orderCount / totalOrders * 100) : 0
                                const dist = transitByCarrier.get(cp.carrier)
                                return (
                                  <tr key={cp.carrier} className={cn("border-b text-xs", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                    <td className="py-2.5 px-3 font-medium">{cp.carrier}</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums">{cp.orderCount.toLocaleString()}</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground">{volumePercent.toFixed(1)}%</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums">${cp.avgCost.toFixed(2)}</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums">{cp.avgTransitTime.toFixed(1)}d</td>
                                    <td className="p-3 pl-5">
                                      {dist ? (
                                        <div>
                                          <div className="relative h-5 rounded overflow-hidden">
                                            {/* Background */}
                                            <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-800 rounded" />
                                            {/* Tick marks */}
                                            {axisTicks.map(t => (
                                              <div key={t} className="absolute top-0 bottom-0 w-px bg-zinc-200 dark:bg-zinc-700" style={{ left: `${(t / globalMaxTransit) * 100}%` }} />
                                            ))}
                                            {/* Range bar (min to max) */}
                                            <div
                                              className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full"
                                              style={{
                                                left: `${(dist.min / globalMaxTransit) * 100}%`,
                                                width: `${((dist.max - dist.min) / globalMaxTransit) * 100}%`,
                                                backgroundColor: 'hsl(203 61% 50% / 0.2)',
                                              }}
                                            />
                                            {/* IQR bar (Q1 to Q3) */}
                                            <div
                                              className="absolute top-1/2 -translate-y-1/2 h-3 rounded"
                                              style={{
                                                left: `${(dist.q1 / globalMaxTransit) * 100}%`,
                                                width: `${Math.max(1, ((dist.q3 - dist.q1) / globalMaxTransit) * 100)}%`,
                                                backgroundColor: 'hsl(203 61% 50% / 0.45)',
                                              }}
                                            />
                                            {/* Median line */}
                                            <div
                                              className="absolute top-1/2 -translate-y-1/2 h-4 w-0.5"
                                              style={{
                                                left: `${(dist.median / globalMaxTransit) * 100}%`,
                                                backgroundColor: 'hsl(203 61% 50%)',
                                              }}
                                            />
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">—</span>
                                      )}
                                    </td>
                                    {carrierSection.country === 'US' && (
                                    <td className="p-3 pl-4">
                                      {(() => {
                                        const zones = zonesByCarrier.get(cp.carrier)
                                        if (!zones || zones.length === 0) return <span className="text-xs text-muted-foreground">—</span>
                                        return (
                                          <div className="flex h-5 rounded overflow-hidden" title={zones.map(z => `Zone ${z.zone}: ${z.percent.toFixed(1)}%`).join('\n')}>
                                            {zones.map(z => (
                                              <div
                                                key={z.zone}
                                                className="h-full flex items-center justify-center text-[9px] font-medium overflow-hidden"
                                                style={{
                                                  width: `${z.percent}%`,
                                                  backgroundColor: zoneColor(z.zone),
                                                  color: parseInt(z.zone) >= 5 ? 'hsl(0 0% 100%)' : 'hsl(203 50% 20%)',
                                                  minWidth: z.percent > 0 ? 2 : 0,
                                                }}
                                              >
                                                {z.percent >= 12 ? z.zone : ''}
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      })()}
                                    </td>
                                    )}
                                  </tr>
                                )
                              })}
                              {/* Shared axis scale */}
                              <tr>
                                <td colSpan={5} />
                                <td className="px-3 pl-5 pb-2 pt-0">
                                  <div className="relative h-3">
                                    {axisTicks.map(t => (
                                      <span key={t} className="absolute text-[9px] text-muted-foreground tabular-nums -translate-x-1/2" style={{ left: `${(t / globalMaxTransit) * 100}%` }}>
                                        {t}d
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                {carrierSection.country === 'US' && <td />}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                </div>

                {/* Zone Deep Dive */}
                <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                    <div>
                      <div className="text-sm font-semibold">Zone Cost & Transit Details</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Detailed breakdown of shipping metrics by zone distance</div>
                    </div>
                    <ChartSelectors chart={zoneDeepDiveChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideAllCountry />
                  </div>
                  <div className="px-6 pb-6 pt-2">
                    <div className="rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr className="border-b">
                            <th className="p-3 text-left font-semibold">Zone</th>
                            <th className="p-3 text-right font-semibold">Orders</th>
                            <th className="p-3 text-right font-semibold">% of Total</th>
                            <th className="p-3 text-right font-semibold">Avg Cost</th>
                            <th className="p-3 text-right font-semibold">Avg Transit</th>
                            {zoneDeepDiveChart.country === 'US' && <th className="p-3 text-left font-semibold">Distance</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {zoneDeepDiveData.map((zone, idx) => {
                            const totalOrders = zoneDeepDiveData.reduce((sum, z) => sum + z.orderCount, 0)
                            const percent = totalOrders > 0 ? (zone.orderCount / totalOrders * 100) : 0
                            const distanceLabels: Record<string, string> = {
                              '1': 'Local (same region)',
                              '2': 'Very close',
                              '3': 'Regional',
                              '4': 'Medium distance',
                              '5': 'Farther',
                              '6': 'Far',
                              '7': 'Very far',
                              '8': 'Coast to coast'
                            }
                            return (
                              <tr key={zone.zone} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-medium">{zone.zone === 'Intl' ? 'International' : `Zone ${zone.zone}`}</td>
                                <td className="p-3 text-right tabular-nums">{zone.orderCount.toLocaleString()}</td>
                                <td className="p-3 text-right tabular-nums text-muted-foreground">{percent.toFixed(1)}%</td>
                                <td className="p-3 text-right tabular-nums">${zone.avgCost.toFixed(2)}</td>
                                <td className="p-3 text-right tabular-nums">{zone.avgTransitTime.toFixed(1)} days</td>
                                {zoneDeepDiveChart.country === 'US' && <td className="p-3 text-muted-foreground">{distanceLabels[zone.zone] || ''}</td>}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 4: SLA Performance */}
              <TabsContent value="sla" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 h-[calc(100vh-64px)] overflow-y-auto bg-zinc-50 dark:bg-zinc-900">
                  <div className="px-5 lg:px-8 pt-6 pb-2">
                    <div className="text-lg font-semibold">SLA Performance</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Fulfillment SLA compliance and trends</div>
                  </div>
                  <div className="px-5 lg:px-8 py-5 space-y-5">
                {/* On-Time Delivery Trend */}
                <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                    <div>
                      <div className="text-sm font-semibold">Fulfillment SLA Success Rate</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Daily performance trend across selected period</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <ChartSelectors chart={slaTrendChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                      <div className="text-right">
                        <div className="text-4xl font-bold tabular-nums"
                             style={{
                               color: slaMetrics.onTimePercent >= 95
                                 ? "hsl(142 71% 45%)"
                                 : slaMetrics.onTimePercent >= 90
                                 ? "hsl(45 93% 47%)"
                                 : "hsl(0 84% 60%)"
                             }}>
                          {slaMetrics.onTimePercent.toFixed(1)}%
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">Average</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 pb-6 pt-2">
                    <ChartContainer
                      config={{
                        onTimePercent: {
                          label: "On-Time %",
                          color: "hsl(var(--chart-1))",
                        },
                        target95: {
                          label: "95% Target",
                          color: "hsl(var(--chart-2))",
                        },
                        target90: {
                          label: "90% Target",
                          color: "hsl(var(--chart-3))",
                        },
                      }}
                      className="h-[300px] w-full"
                    >
                      <AreaChart
                        data={slaTrendChart.data as any[]}
                        margin={{ top: 20, right: 12, left: -8, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="fillOnTime" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-onTimePercent)" stopOpacity={0.8} />
                            <stop offset="95%" stopColor="var(--color-onTimePercent)" stopOpacity={0.1} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={32}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          }}
                        />
                        <YAxis
                          type="number"
                          domain={[90, 100]}
                          ticks={[90, 92, 94, 96, 98, 100]}
                          allowDataOverflow={false}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}%`}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              indicator="dot"
                              labelFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              formatter={(value, name, item) => (
                                <>
                                  <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                  <div className="flex flex-1 justify-between items-center leading-none">
                                    <span className="text-muted-foreground">On-Time Rate</span>
                                    <span className="font-mono font-medium tabular-nums text-foreground ml-4">{Number(value).toFixed(1)}%</span>
                                  </div>
                                </>
                              )}
                            />
                          }
                        />
                        <RechartsLabel value="95%" position="insideTopLeft" />
                        <Line
                          type="monotone"
                          dataKey={() => 95}
                          stroke="hsl(142 71% 45%)"
                          strokeWidth={1}
                          strokeDasharray="5 5"
                          dot={false}
                          legendType="none"
                        />
                        <Line
                          type="monotone"
                          dataKey={() => 90}
                          stroke="hsl(45 93% 47%)"
                          strokeWidth={1}
                          strokeDasharray="5 5"
                          dot={false}
                          legendType="none"
                        />
                        <Area
                          type="monotone"
                          dataKey="onTimePercent"
                          stroke="hsl(var(--chart-1))"
                          fill="url(#fillOnTime)"
                        />
                      </AreaChart>
                    </ChartContainer>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Time to Fulfill Trends */}
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background flex flex-col">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Time to Fulfill Trends</div>
                        <div className="text-xs text-muted-foreground mt-0.5">How long does it take to fulfill orders?</div>
                      </div>
                      <ChartSelectors chart={fulfillTrendChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                    </div>
                    <div className="px-6 pb-6 pt-2 flex-1">
                      <ChartContainer
                        config={{
                          avgFulfillmentHours: {
                            label: "Average",
                            color: "hsl(var(--chart-1))",
                          },
                          p90FulfillmentHours: {
                            label: "90th Percentile",
                            color: "hsl(var(--chart-2))",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <ComposedChart
                          data={fulfillTrendChart.data as FulfillmentTrendData[]}
                          margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="fillAvg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-avgFulfillmentHours)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="var(--color-avgFulfillmentHours)" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            interval={(() => {
                              const dataLength = (fulfillTrendChart.data as FulfillmentTrendData[]).length
                              if (dataLength <= 7) return 0
                              if (dataLength <= 30) return Math.floor(dataLength / 6)
                              if (dataLength <= 90) return Math.floor(dataLength / 5)
                              return Math.floor(dataLength / 8)
                            })()}
                            tickFormatter={(value) => {
                              const date = new Date(value)
                              const dataLength = (fulfillTrendChart.data as FulfillmentTrendData[]).length
                              if (dataLength > 90) {
                                return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                              }
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                            tickFormatter={(value) => `${value}h`}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="dot"
                                labelFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                formatter={(value, name, item) => (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">{name === 'avgFulfillmentHours' ? 'Average' : '90th Pctl'}</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground ml-4">{Number(value).toFixed(1)}h</span>
                                    </div>
                                  </>
                                )}
                              />
                            }
                          />
                          <Area
                            type="monotone"
                            dataKey="avgFulfillmentHours"
                            stroke="var(--color-avgFulfillmentHours)"
                            fill="url(#fillAvg)"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="p90FulfillmentHours"
                            stroke="var(--color-p90FulfillmentHours)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                        </ComposedChart>
                      </ChartContainer>
                    </div>
                  </div>

                  {/* Fulfillment Speed by FC */}
                  <div className="rounded-xl border border-border/60 overflow-hidden bg-background flex flex-col">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                      <div>
                        <div className="text-sm font-semibold">Fulfillment Speed by FC</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Which FCs process orders fastest?</div>
                      </div>
                      <ChartSelectors chart={fcFulfillChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                    </div>
                    <div className="px-6 pb-6 pt-2 flex-1">
                      <ChartContainer
                        config={{
                          avgFulfillmentHours: {
                            label: "Avg Time (hours)",
                            color: "hsl(var(--chart-1))",
                          },
                          breachRate: {
                            label: "Breach Rate (%)",
                            color: "hsl(var(--chart-2))",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <BarChart
                          data={fcFulfillChart.data as FCFulfillmentMetrics[]}
                          margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="fcName" tickLine={false} axisLine={false} />
                          <YAxis
                            yAxisId="left"
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                            tickFormatter={(value) => `${value}h`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <ChartTooltip
                            content={
                              <ChartTooltipContent
                                indicator="dot"
                                formatter={(value, name, item) => (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">{name === 'avgFulfillmentHours' ? 'Avg Time' : 'Breach Rate'}</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground ml-4">{name === 'avgFulfillmentHours' ? `${Number(value).toFixed(1)}h` : `${Number(value).toFixed(1)}%`}</span>
                                    </div>
                                  </>
                                )}
                              />
                            }
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="avgFulfillmentHours"
                            fill="var(--color-avgFulfillmentHours)"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            yAxisId="right"
                            dataKey="breachRate"
                            fill="var(--color-breachRate)"
                            radius={[4, 4, 0, 0]}
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                        </BarChart>
                      </ChartContainer>
                    </div>
                  </div>
                </div>

                {/* Recent SLA Breaches */}
                <Card className="bg-transparent shadow-none">
                  <CardHeader>
                    <CardTitle className="text-sm font-medium"><div>Recent SLA Breaches</div></CardTitle>
                    <CardDescription className="text-xs">Orders that missed their fulfillment deadline</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr className="border-b">
                            <th className="p-3 text-left font-semibold">Order ID</th>
                            <th className="p-3 text-left font-semibold">Customer</th>
                            <th className="p-3 text-left font-semibold">Order Received</th>
                            <th className="p-3 text-left font-semibold">Label Generated</th>
                            <th className="p-3 text-right font-semibold">Time to Ship</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slaMetrics.shipments
                            .filter(s => !s.isOnTime)
                            .slice(0, 10)
                            .map((s, idx) => (
                              <tr key={s.orderId} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-medium">{s.orderId}</td>
                                <td className="p-3">{s.customerName}</td>
                                <td className="p-3">
                                  {new Date(s.orderInsertTimestamp).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit"
                                  })}
                                </td>
                                <td className="p-3">
                                  {new Date(s.labelGenerationTimestamp).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit"
                                  })}
                                </td>
                                <td className="p-3 text-right">
                                  <span className="text-destructive font-medium">
                                    {s.timeToShipHours.toFixed(1)}h
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 5: Performance Breakdown */}
              <TabsContent value="state-performance" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 min-h-[calc(100vh-64px)] bg-muted dark:bg-zinc-900">
                  {/* Map + Details grid */}
                  <div className="grid lg:grid-cols-3 min-h-[calc(100vh-64px)]">
                    {/* Map - 2 columns */}
                    <div className="lg:col-span-2 bg-muted dark:bg-zinc-900 relative [&>.relative>svg]:-mt-[20px] [&>.relative>svg]:-mb-[5px] flex flex-col after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[50%] after:bg-gradient-to-b after:from-transparent after:to-zinc-200 dark:after:to-zinc-800 after:pointer-events-none after:z-[1]">
                      {/* Header bar — inside map column */}
                      <div className="flex items-start justify-between gap-4 px-4 lg:px-6 py-5">
                        <div>
                          <div className="text-lg font-semibold">{perfCountry === 'US' ? 'USA' : COUNTRY_CONFIGS[perfCountry]?.label} Performance Overview</div>
                          <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                            {statePerformance.reduce((sum, s) => sum + s.orderCount, 0).toLocaleString()} orders
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 -mt-[2px]">
                          <Select
                            value={dateRange}
                            onValueChange={handleDatePresetChange}
                          >
                            <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                              <SelectValue>
                                {DATE_RANGE_PRESETS.find(p => p.value === dateRange)?.label || '30D'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent align="end" className="font-roboto text-xs">
                              {DATE_RANGE_PRESETS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {dateRange === 'custom' && (
                            <InlineDateRangePicker
                              dateRange={customDateRange.from && customDateRange.to ? { from: customDateRange.from, to: customDateRange.to } : undefined}
                              onDateRangeChange={(range) => {
                                if (range?.from && range?.to) {
                                  const today = new Date()
                                  today.setHours(23, 59, 59, 999)
                                  const fourteenDaysAgo = new Date(today)
                                  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13)
                                  fourteenDaysAgo.setHours(0, 0, 0, 0)

                                  if (range.to >= fourteenDaysAgo) {
                                    const minFrom = new Date(today)
                                    minFrom.setDate(minFrom.getDate() - 13)
                                    minFrom.setHours(0, 0, 0, 0)
                                    if (range.from > minFrom) {
                                      setCustomDateRange({ from: minFrom, to: today })
                                      return
                                    }
                                  }
                                  setCustomDateRange({ from: range.from, to: range.to })
                                }
                              }}
                              autoOpen
                            />
                          )}
                          {(analyticsData?.availableCountries || []).length > 1 && (
                            <Select value={perfCountry} onValueChange={(v) => {
                              setSelectedCountry(v)
                              setSelectedState(null)
                            }}>
                              <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="US">USA</SelectItem>
                                {(analyticsData?.availableCountries || []).includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
                                {(analyticsData?.availableCountries || []).includes('AU') && <SelectItem value="AU">Australia</SelectItem>}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                      {(() => {
                        const dataDays = analyticsData?.countryDataDays?.[perfCountry] ?? 999
                        if (perfCountry !== 'US' && dataDays < 10) {
                          const countryName = perfCountry === 'CA' ? 'Canada' : perfCountry === 'AU' ? 'Australia' : perfCountry
                          return (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                              <div className="text-sm font-medium text-muted-foreground mb-2">Not Enough Data Yet</div>
                              <div className="text-xs text-muted-foreground max-w-sm">
                                {countryName} has only {dataDays} {dataDays === 1 ? 'day' : 'days'} of shipping data in this period.
                                At least 10 days of data is needed for meaningful performance metrics.
                              </div>
                            </div>
                          )
                        }
                        return (
                          <PerformanceMap
                            key={perfCountry}
                            config={COUNTRY_CONFIGS[perfCountry]}
                            regionData={statePerformance}
                            onRegionSelect={setSelectedState}
                          />
                        )
                      })()}
                    </div>

                    {/* Details panel - 1 column, border-left divider */}
                    <div className="lg:col-span-1 border-t lg:border-t-0 lg:border-l border-border bg-gradient-to-b from-zinc-100 via-zinc-50 to-zinc-100 dark:from-zinc-800 dark:via-zinc-900 dark:to-zinc-900">
                      {(perfCountry !== 'US' && (analyticsData?.countryDataDays?.[perfCountry] ?? 999) < 14) ? (
                        <div className="h-full flex items-center justify-center">
                          <div className="text-xs text-muted-foreground py-16">Check back once more data has accumulated</div>
                        </div>
                      ) : selectedState && statePerformance.find(s => s.state === selectedState) ? (
                        <StateDetailsPanel
                          stateData={statePerformance.find(s => s.state === selectedState)!}
                          cityData={analyticsData?.perfCityData || []}
                          delayImpact={delayImpact}
                          includeDelayed={includeDelayedOrders}
                          onToggleDelayed={setIncludeDelayedOrders}
                          otdPercentiles={includeDelayedOrders ? stateOtdWithDelayed : stateOtdClean}
                        />
                      ) : (
                        <NationalPerformanceOverviewPanel
                          stateData={statePerformance}
                          country={perfCountry}
                          regionLabel={COUNTRY_CONFIGS[perfCountry]?.regionLabel}
                          regionLabelPlural={COUNTRY_CONFIGS[perfCountry]?.regionLabelPlural}
                          delayImpact={delayImpact}
                          includeDelayed={includeDelayedOrders}
                          onToggleDelayed={setIncludeDelayedOrders}
                          otdPercentiles={includeDelayedOrders ? nationalOtdWithDelayed : nationalOtdClean}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 6: Undelivered Shipments */}
              <TabsContent value="undelivered" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 h-[calc(100vh-64px)] overflow-y-auto bg-zinc-50 dark:bg-zinc-900">
                  <div className="px-5 lg:px-8 pt-6 pb-2">
                    <div className="text-lg font-semibold">Undelivered Shipments</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Active shipments not yet delivered</div>
                  </div>
                  <div className="px-5 lg:px-8 py-5 space-y-5">
                {/* KPI Summary Cards */}
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <Card className="bg-transparent shadow-none">
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Total Undelivered</p>
                      <p className="text-2xl font-bold">{undeliveredSummary.totalUndelivered.toLocaleString()}</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-transparent shadow-none">
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Avg Days in Transit</p>
                      <p className="text-2xl font-bold">{undeliveredSummary.avgDaysInTransit.toFixed(1)}</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-transparent shadow-none">
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Critical (7+ days)</p>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{undeliveredSummary.criticalCount.toLocaleString()}</p>
                    </CardContent>
                  </Card>

                  <Card className="bg-transparent shadow-none">
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">On Track (&lt;5 days)</p>
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{undeliveredSummary.onTrackCount.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Age Distribution Chart */}
                  <Card className="bg-transparent shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium"><div>Age Distribution</div></CardTitle>
                      <CardDescription className="text-xs">Days since label was generated</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          count: { label: "Shipments", color: "hsl(var(--chart-1))" },
                        }}
                        className="h-[280px] w-full"
                      >
                        <BarChart data={undeliveredByAge} layout="vertical" margin={{ left: 80, right: 20, top: 10, bottom: 10 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                          <YAxis type="category" dataKey="bucket" width={75} tick={{ fontSize: 12 }} />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="dot" />}
                          />
                          <Bar
                            dataKey="count"
                            radius={[0, 4, 4, 0]}
                            fill="hsl(var(--chart-1))"
                          >
                            {undeliveredByAge.map((entry, index) => (
                              <rect
                                key={`cell-${index}`}
                                fill={entry.minDays >= 7 ? "hsl(var(--destructive))" : entry.minDays >= 3 ? "hsl(var(--chart-1))" : "hsl(var(--chart-2))"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Status Breakdown */}
                  <Card className="bg-transparent shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium"><div>Status Breakdown</div></CardTitle>
                      <CardDescription className="text-xs">Current shipment status distribution</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Total count header */}
                      <div className="text-center mb-6 pb-4 border-b">
                        <p className="text-3xl font-bold">{undeliveredSummary.totalUndelivered.toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">Total Undelivered</p>
                      </div>
                      {/* Status bars */}
                      <div className="space-y-4">
                        {undeliveredByStatus.map((item) => {
                          const color = item.status === 'Exception' ? 'bg-red-500' :
                                       item.status === 'Delayed' ? 'bg-amber-500' :
                                       item.status === 'In Transit' ? 'bg-blue-500' :
                                       'bg-emerald-500'
                          const textColor = item.status === 'Exception' ? 'text-red-600 dark:text-red-400' :
                                           item.status === 'Delayed' ? 'text-amber-600 dark:text-amber-400' :
                                           item.status === 'In Transit' ? 'text-blue-600 dark:text-blue-400' :
                                           'text-emerald-600 dark:text-emerald-400'
                          return (
                            <div key={item.status} className="space-y-1.5">
                              <div className="flex items-center justify-between text-sm">
                                <span className={cn("font-medium", textColor)}>{item.status}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {item.count.toLocaleString()} ({item.percent.toFixed(0)}%)
                                </span>
                              </div>
                              <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full transition-all", color)}
                                  style={{ width: `${Math.max(item.percent, 1)}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Undelivered by Carrier */}
                <Card className="bg-transparent shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium"><div>Undelivered by Carrier</div></CardTitle>
                    <CardDescription className="text-xs">Shipment count and average days in transit per carrier</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        count: { label: "Shipments", color: "hsl(var(--chart-1))" },
                        avgDaysInTransit: { label: "Avg Days", color: "hsl(var(--chart-2))" },
                      }}
                      className="h-[300px] w-full"
                    >
                      <ComposedChart data={undeliveredByCarrier} margin={{ left: 20, right: 20, top: 20, bottom: 60 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="carrier"
                          angle={-45}
                          textAnchor="end"
                          height={60}
                          tick={{ fontSize: 11 }}
                          interval={0}
                        />
                        <YAxis yAxisId="left" orientation="left" allowDecimals={false} tickFormatter={(v) => v.toLocaleString()} />
                        <YAxis yAxisId="right" orientation="right" allowDecimals={false} tickFormatter={(v) => `${v}d`} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              indicator="dot"
                              formatter={(value, name, item) => (
                                <>
                                  <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                  <div className="flex flex-1 justify-between items-center leading-none">
                                    <span className="text-muted-foreground">{name === 'count' ? 'Shipments' : 'Avg Days'}</span>
                                    <span className="font-mono font-medium tabular-nums text-foreground ml-4">{name === 'count' ? Number(value).toLocaleString() : `${Number(value).toFixed(1)}d`}</span>
                                  </div>
                                </>
                              )}
                            />
                          }
                        />
                        <Bar yAxisId="left" dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="avgDaysInTransit" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ fill: "hsl(var(--chart-2))" }} />
                      </ComposedChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Shipments Detail Table */}
                <Card className="bg-transparent shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium"><div>Undelivered Shipments Detail</div></CardTitle>
                    <CardDescription className="text-xs">
                      Showing {Math.min(50, undeliveredShipments.length)} of {undeliveredShipments.length} undelivered shipments, sorted by days in transit
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-3 font-medium">Tracking ID</th>
                              <th className="text-left p-3 font-medium">Order ID</th>
                              <th className="text-left p-3 font-medium">Customer</th>
                              <th className="text-left p-3 font-medium">Carrier</th>
                              <th className="text-left p-3 font-medium">Destination</th>
                              <th className="text-right p-3 font-medium">Days</th>
                              <th className="text-left p-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {undeliveredShipments.slice(0, 50).map((shipment, index) => (
                              <tr key={shipment.trackingId} className={cn("border-b", index % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-mono text-xs">{shipment.trackingId}</td>
                                <td className="p-3 font-mono text-xs">{shipment.orderId}</td>
                                <td className="p-3">{shipment.customerName}</td>
                                <td className="p-3">{shipment.carrier}</td>
                                <td className="p-3">{shipment.destination}</td>
                                <td className={cn(
                                  "p-3 text-right font-medium tabular-nums",
                                  shipment.daysInTransit >= 7 ? "text-red-600 dark:text-red-400" :
                                  shipment.daysInTransit >= 5 ? "text-amber-600 dark:text-amber-400" :
                                  "text-foreground"
                                )}>
                                  {shipment.daysInTransit}
                                </td>
                                <td className="p-3">
                                  <span className={cn(
                                    "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
                                    shipment.status === 'Exception' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                    shipment.status === 'Delayed' ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                                    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                  )}>
                                    {shipment.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {undeliveredShipments.length > 50 && (
                      <p className="text-sm text-muted-foreground mt-3 text-center">
                        Showing top 50 shipments by days in transit. Export to see all {undeliveredShipments.length} records.
                      </p>
                    )}
                  </CardContent>
                </Card>
                  </div>
                </div>
              </TabsContent>

              </div>
            </Tabs>
          </div>
        </div>
      </div>
    </>
  )
}
