"use client"

export const dynamic = 'force-dynamic'

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { CalendarIcon, DownloadIcon } from "lucide-react"
import { JetpackLoader } from "@/components/jetpack-loader"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Line,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Label as RechartsLabel,
  LabelList,
  Customized,
} from "recharts"

import { SiteHeader } from "@/components/site-header"
import { Separator } from "@/components/ui/separator"
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { PerformanceMap } from "@/components/analytics/performance-map"
import { COUNTRY_CONFIGS } from "@/lib/analytics/geo-config"
import { PerformanceDetailsPanel } from "@/components/analytics/performance-details-panel"
import { StateVolumeDetailsPanel } from "@/components/analytics/state-volume-details-panel"
import { NationalVolumeOverviewPanel } from "@/components/analytics/national-volume-overview-panel"
import { LayeredVolumeHeatMap } from "@/components/analytics/layered-volume-heat-map"
import { CostSpeedStateMap } from "@/components/analytics/cost-speed-state-map"
import { KpiTooltip, KPI_TOOLTIPS } from "@/components/analytics/kpi-tooltip"
import { AnimatedNumber } from "@/components/analytics/animated-number"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { Checkbox } from "@/components/ui/checkbox"
import { MultiSelectFilter, type FilterOption } from "@/components/ui/multi-select-filter"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { PermissionGuard } from "@/components/permission-guard"
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
  OtdPercentiles,
  SkuCostData,
  SkuCostTrendPoint,
  WeightCostData,
} from "@/lib/analytics/types"
import { getGranularityForRange, getGranularityLabel } from "@/lib/analytics/types"
import { getDateRangeFromPreset } from "@/lib/analytics/aggregators"

// Parse date-only strings ("2026-03-01") as local time, not UTC.
// new Date("2026-03-01") interprets as UTC midnight → shifts back a day in US timezones.
// Appending T00:00:00 forces local-time interpretation.
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr.length === 10 ? dateStr + 'T00:00:00' : dateStr)
}

// Shared x-axis interval calculation to avoid tick crowding
function getXAxisInterval(dataLength: number): number {
  if (dataLength <= 7) return 0
  if (dataLength <= 30) return Math.floor(dataLength / 6)
  if (dataLength <= 90) return Math.floor(dataLength / 5)
  return Math.floor(dataLength / 8)
}

const ANALYTICS_TABS = [
  { value: "state-performance", label: "Performance" },
  { value: "cost-speed", label: "Shipping Cost + Speed" },
  { value: "order-volume", label: "Order Volume" },
  { value: "carriers-zones", label: "Carriers + Zones" },
  { value: "financials", label: "Financials" },
  { value: "sla", label: "Fulfillment SLAs" },
]

const DATE_RANGE_PRESETS = [
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
  { value: '60d', label: '60 Days' },
  { value: '90d', label: '90 Days' },
  { value: '6mo', label: '6 Months' },
  { value: '1yr', label: '1 Year' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
]

// Per-chart date presets (includes custom — each chart has its own inline date picker)
const CHART_DATE_PRESETS = DATE_RANGE_PRESETS

// Helper: get display label for a chart's date selector
function chartPresetLabel(chart: { preset: string; customRange?: { from: Date | undefined; to: Date | undefined } }, fallback: string) {
  if (chart.preset === 'custom' && chart.customRange?.from && chart.customRange?.to) {
    return `${format(chart.customRange.from, 'MMM d')} – ${format(chart.customRange.to, 'MMM d, yyyy')}`
  }
  return CHART_DATE_PRESETS.find(p => p.value === chart.preset)?.label || fallback
}

// Helper: Select value that allows re-clicking "Custom" after dates are set
function chartSelectVal(chart: { preset: string; customRange?: { from: Date | undefined; to: Date | undefined } }) {
  return chart.preset === 'custom' && chart.customRange?.from && chart.customRange?.to ? 'custom-active' : chart.preset
}

// Unified analytics filters — shared state across Cost & Speed and Financials tabs
// Cost & Speed shows order-type + geography filters; Financials adds Include Credits
const COST_SPEED_FILTER_OPTIONS: FilterOption[] = [
  { value: 'dtc', label: 'D2C' },
  { value: 'b2b', label: 'B2B' },
  { value: 'fba', label: 'FBA' },
  { value: 'international', label: 'International' },
]
const FINANCIALS_FILTER_OPTIONS: FilterOption[] = [
  ...COST_SPEED_FILTER_OPTIONS,
  { value: 'credits', label: 'Credits' },
]
const ALL_ANALYTICS_FILTERS = FINANCIALS_FILTER_OPTIONS.map(o => o.value)

// Hardcoded service-level groups — classified by ship_option_name in RPC
const SERVICE_GROUP_OPTIONS: FilterOption[] = [
  { value: 'ground', label: 'Ground' },
  { value: '2day', label: '2-Day' },
  { value: 'overnight', label: 'Overnight' },
  { value: 'other', label: 'Other' },
]
const ALL_SERVICE_GROUPS = SERVICE_GROUP_OPTIONS.map(o => o.value)
const ALL_ORDER_TYPES_LIST = ['DTC', 'B2B', 'FBA'] as const

// Column color tinting — pure function for HSL cell backgrounds
const tintFn = (h: number, s: number, l: number, max: number) =>
  (v: number) => v <= 0 ? 'transparent' : `hsla(${h}, ${s}%, ${l}%, ${(0.04 + (v / (max || 1)) * 0.13).toFixed(2)})`

// Currency formatter (hoisted to avoid recreation)
const fmtCurrency = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Cost distribution chart colors (hoisted to avoid recreation)
const COST_DIST_COLORS = [
  'hsl(203, 61%, 50%)',   // Jetpack blue
  'hsl(203, 45%, 65%)',   // Lighter blue
  'hsl(32, 85%, 55%)',    // Warm amber
  'hsl(142, 50%, 45%)',   // Green
  'hsl(346, 65%, 55%)',   // Rose
  'hsl(262, 50%, 55%)',   // Purple
  'hsl(203, 30%, 72%)',   // Muted blue
  'hsl(18, 70%, 55%)',    // Coral
]

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
  fetchTab?: string,
) {
  const [chartPreset, setChartPreset] = React.useState<DateRangePreset>(pageDateRange)
  const [chartCountry, setChartCountry] = React.useState<string>(lockedCountry || pageCountry)
  const [chartCustomRange, setChartCustomRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined })
  const [chartData, setChartData] = React.useState<any>(null)
  const [isFetching, setIsFetching] = React.useState(false)

  // Stable stringified extraParams for dependency arrays
  const extraParamsKey = extraParams ? Object.entries(extraParams).sort().map(([k, v]) => `${k}=${v}`).join('&') : ''
  // Stable key for custom range
  const customRangeKey = chartPreset === 'custom' && chartCustomRange.from && chartCustomRange.to
    ? `${chartCustomRange.from.toISOString().split('T')[0]}:${chartCustomRange.to.toISOString().split('T')[0]}`
    : ''

  // Sync chart-level selectors when page-level values change (e.g. country toggle)
  // Skip country sync when lockedCountry is set (chart stays on its locked value)
  React.useEffect(() => { setChartPreset(pageDateRange) }, [pageDateRange])
  React.useEffect(() => { if (!lockedCountry) setChartCountry(pageCountry) }, [pageCountry, lockedCountry])

  // Resolve data: when chart preset+country match page (and no extraParams), use page data directly.
  // When they diverge or extraParams exist, look up from cache or fetch independently.
  React.useEffect(() => {
    // Custom preset without both dates selected — wait for user to pick dates
    if (chartPreset === 'custom' && !customRangeKey) {
      setIsFetching(false)
      return
    }

    // Chart matches page AND no extra params — use pageFieldData (via null fallback), no fetch needed
    if (chartPreset === pageDateRange && chartPreset !== 'custom' && chartCountry === pageCountry && !extraParamsKey) {
      setChartData(null)
      setIsFetching(false)
      return
    }

    // Check cache (include extraParams + fetchTab in cache key)
    const tabKey = fetchTab || 'sp'
    const cacheKey = `${chartPreset}:${customRangeKey}:${chartCountry}:${timezone}:${clientId}:${tabKey}${extraParamsKey ? ':' + extraParamsKey : ''}`
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setChartData(cached[fieldName])
      setIsFetching(false)
      return
    }

    // Not cached — fetch independently
    if (!clientId) return

    let cancelled = false
    setIsFetching(true)

    const range = chartPreset === 'custom' && chartCustomRange.from && chartCustomRange.to
      ? { from: chartCustomRange.from, to: chartCustomRange.to }
      : getDateRangeFromPreset(chartPreset)
    const params = new URLSearchParams({
      clientId,
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
      datePreset: chartPreset,
      country: chartCountry,
      timezone,
      tab: fetchTab || 'state-performance',
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
  }, [chartPreset, customRangeKey, chartCountry, pageDateRange, pageCountry, clientId, timezone, fieldName, cache, extraParamsKey, fetchTab])

  return {
    data: chartData ?? pageFieldData,
    preset: chartPreset,
    country: chartCountry,
    customRange: chartCustomRange,
    isFetching,
    setPreset: (v: string) => {
      setChartPreset(v as DateRangePreset)
      if (v !== 'custom') setChartCustomRange({ from: undefined, to: undefined })
    },
    setCountry: (v: string) => setChartCountry(v),
    setCustomRange: setChartCustomRange,
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
  fetchTab?: string,
) {
  const [chartPreset, setChartPreset] = React.useState<DateRangePreset>(pageDateRange)
  const [chartCountry, setChartCountry] = React.useState<string>(lockedCountry || pageCountry)
  const [chartCustomRange, setChartCustomRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined })
  const [chartData, setChartData] = React.useState<any>(null)
  const [isFetching, setIsFetching] = React.useState(false)

  // Stable stringified extraParams for dependency arrays
  const extraParamsKey = extraParams ? Object.entries(extraParams).sort().map(([k, v]) => `${k}=${v}`).join('&') : ''
  // Stable key for custom range
  const customRangeKey = chartPreset === 'custom' && chartCustomRange.from && chartCustomRange.to
    ? `${chartCustomRange.from.toISOString().split('T')[0]}:${chartCustomRange.to.toISOString().split('T')[0]}`
    : ''

  // Sync chart-level selectors when page-level values change
  // Skip country sync when lockedCountry is set
  React.useEffect(() => { setChartPreset(pageDateRange) }, [pageDateRange])
  React.useEffect(() => { if (!lockedCountry) setChartCountry(pageCountry) }, [pageCountry, lockedCountry])

  React.useEffect(() => {
    // Custom preset without both dates selected — wait for user to pick dates
    if (chartPreset === 'custom' && !customRangeKey) {
      setIsFetching(false)
      return
    }

    if (chartPreset === pageDateRange && chartPreset !== 'custom' && chartCountry === pageCountry && !extraParamsKey) {
      setChartData(null)
      setIsFetching(false)
      return
    }
    const tabKey = fetchTab || 'sp'
    const cacheKey = `${chartPreset}:${customRangeKey}:${chartCountry}:${timezone}:${clientId}:${tabKey}${extraParamsKey ? ':' + extraParamsKey : ''}`
    const cached = cache.current.get(cacheKey)
    if (cached) {
      setChartData(cached)
      setIsFetching(false)
      return
    }
    if (!clientId) return
    let cancelled = false
    setIsFetching(true)
    const range = chartPreset === 'custom' && chartCustomRange.from && chartCustomRange.to
      ? { from: chartCustomRange.from, to: chartCustomRange.to }
      : getDateRangeFromPreset(chartPreset)
    const params = new URLSearchParams({
      clientId,
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
      datePreset: chartPreset,
      country: chartCountry,
      timezone,
      tab: fetchTab || 'state-performance',
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
  }, [chartPreset, customRangeKey, chartCountry, pageDateRange, pageCountry, clientId, timezone, cache, extraParamsKey, fetchTab])

  return {
    data: chartData ?? pageData,
    preset: chartPreset,
    country: chartCountry,
    customRange: chartCustomRange,
    isFetching,
    setPreset: (v: string) => {
      setChartPreset(v as DateRangePreset)
      if (v !== 'custom') setChartCustomRange({ from: undefined, to: undefined })
    },
    setCountry: (v: string) => setChartCountry(v),
    setCustomRange: setChartCustomRange,
  }
}

// Reusable per-chart selector bar (date + country + optional custom date picker)
function ChartSelectors({ chart, availableCountries, dateRangeDisplayLabel, hideAllCountry, hideCountry, hideLoader }: {
  chart: {
    preset: string; country: string; isFetching: boolean
    setPreset: (v: string) => void; setCountry: (v: string) => void
    customRange?: { from: Date | undefined; to: Date | undefined }
    setCustomRange?: (range: { from: Date | undefined; to: Date | undefined }) => void
    data?: any
  }
  availableCountries: string[]
  dateRangeDisplayLabel: string
  hideAllCountry?: boolean
  hideCountry?: boolean
  hideLoader?: boolean
}) {
  const [calendarOpen, setCalendarOpen] = React.useState(false)
  const prevPresetRef = React.useRef(chart.preset)

  // Auto-open calendar when preset changes to 'custom'
  React.useEffect(() => {
    if (chart.preset === 'custom' && prevPresetRef.current !== 'custom') {
      // Small delay so Select dropdown closes first
      const t = setTimeout(() => setCalendarOpen(true), 150)
      prevPresetRef.current = chart.preset
      return () => clearTimeout(t)
    }
    prevPresetRef.current = chart.preset
  }, [chart.preset])

  // Display label for the date selector value
  const displayLabel = chart.preset === 'custom' && chart.customRange?.from && chart.customRange?.to
    ? `${format(chart.customRange.from, 'MMM d')} – ${format(chart.customRange.to, 'MMM d, yyyy')}`
    : CHART_DATE_PRESETS.find(p => p.value === chart.preset)?.label || dateRangeDisplayLabel

  // Track range selection state for calendar (need two clicks)
  const [isSelectingRange, setIsSelectingRange] = React.useState(false)

  // When custom dates are set, use a non-matching value so "Custom" can be re-clicked
  const chartSelectValue = chart.preset === 'custom' && chart.customRange?.from && chart.customRange?.to && !calendarOpen
    ? 'custom-active'
    : chart.preset

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {chart.isFetching && !hideLoader && <JetpackLoader size="sm" />}
      <Select value={chartSelectValue} onValueChange={(v) => {
        if (v === 'custom') {
          chart.setPreset('custom')
          setCalendarOpen(true)
        } else {
          chart.setPreset(v)
          setCalendarOpen(false)
        }
      }}>
        <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-background border-border">
          <SelectValue>{displayLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="font-roboto text-xs">
          {CHART_DATE_PRESETS.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {calendarOpen && chart.preset === 'custom' && chart.setCustomRange && (
        <Popover open={calendarOpen} onOpenChange={(open) => {
          setCalendarOpen(open)
          if (!open) setIsSelectingRange(false)
        }} modal>
          <PopoverTrigger asChild>
            <button
              className="h-[28px] flex items-center gap-1 px-2 rounded-md border border-input bg-background text-[11px] hover:bg-accent transition-colors"
            >
              <CalendarIcon className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              defaultMonth={chart.customRange?.from || new Date()}
              selected={chart.customRange?.from && chart.customRange?.to ? { from: chart.customRange.from, to: chart.customRange.to } : undefined}
              onSelect={(range) => {
                if (range?.from) {
                  chart.setCustomRange!({ from: range.from, to: range.to })
                  // v9: first click fires {from: date, to: date} (same date) — treat as incomplete
                  const isComplete = range.to && range.from.getTime() !== range.to.getTime()
                  if (!isSelectingRange) {
                    setIsSelectingRange(true)
                    return
                  }
                  if (isComplete) {
                    setCalendarOpen(false)
                    setIsSelectingRange(false)
                  }
                }
              }}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      )}
      {!hideCountry && availableCountries.length > 1 && (
        <Select value={chart.country} onValueChange={chart.setCountry}>
          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-background border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end" className="font-roboto text-xs">
            {!hideAllCountry && <SelectItem value="ALL">All Regions</SelectItem>}
            <SelectItem value="US">USA</SelectItem>
            {availableCountries.includes('CA') && <SelectItem value="CA">Canada</SelectItem>}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export default function AnalyticsContent() {
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
  // Controls whether the calendar picker is visible (hides after dates are picked)
  const [customPickerOpen, setCustomPickerOpen] = React.useState(false)

  const [selectedState, setSelectedState] = React.useState<string | null>(null)
  const [selectedCountry, setSelectedCountry] = React.useState('US')
  // Performance tab needs a specific country (map requires config) — fall back to US when ALL
  const perfCountry = selectedCountry === 'ALL' ? 'US' : selectedCountry
  const [selectedVolumeState, setSelectedVolumeState] = React.useState<string | null>(null)

  // Delay exclusion toggle — default: exclude delayed orders from averages
  const [includeDelayedOrders, setIncludeDelayedOrders] = React.useState(false)

  // Unified analytics filters — shared across Cost & Speed and Financials tabs
  // All options pre-checked by default (include everything)
  const [analyticsFilters, setAnalyticsFilters] = React.useState<string[]>(ALL_ANALYTICS_FILTERS)
  // Derive active order types from filter checkboxes: dtc→DTC, b2b→B2B, fba→FBA
  const activeOrderTypes = React.useMemo(() => {
    const types = (['dtc', 'b2b', 'fba'] as const).filter(t => analyticsFilters.includes(t)).map(t => t.toUpperCase())
    return types.length < ALL_ORDER_TYPES_LIST.length ? types : null // null = no filter
  }, [analyticsFilters])
  const filterDomesticOnly = !analyticsFilters.includes('international')
  const filterIncludeCredits = analyticsFilters.includes('credits')
  const [selectedServiceGroups, setSelectedServiceGroups] = React.useState<string[]>(ALL_SERVICE_GROUPS)
  const [selectedTrendSku, setSelectedTrendSku] = React.useState<string | null>(null)
  const [skuTrendData, setSkuTrendData] = React.useState<SkuCostTrendPoint[]>([])
  const [skuTrendLoading, setSkuTrendLoading] = React.useState(false)
  const [skuTrendPreset, setSkuTrendPreset] = React.useState<DateRangePreset>(dateRange)
  const [skuTrendCountry, setSkuTrendCountry] = React.useState<string>(selectedCountry)
  const [skuTrendCustomRange, setSkuTrendCustomRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined })
  // Sync with page date range
  React.useEffect(() => { setSkuTrendPreset(dateRange) }, [dateRange])

  const [includeIntlZones, setIncludeIntlZones] = React.useState(false)

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
    const params = new URLSearchParams({
      clientId: effectiveClientId,
      startDate,
      endDate,
      datePreset: dateRange,
      country: selectedCountry,
      timezone: settings.timezone,
      tab,
    })
    if (filterDomesticOnly && selectedCountry !== 'ALL') params.set('domesticOnly', 'true')
    if (activeOrderTypes) params.set('orderTypes', activeOrderTypes.join(','))
    return params
  }, [effectiveClientId, currentDateRange, dateRange, selectedCountry, settings.timezone, activeOrderTypes, filterDomesticOnly])

  // OTD percentiles — pre-loaded for all states in one query via tab-data route
  // Both clean and with-delayed variants fetched so the toggle switches instantly
  const buildOtdMap = React.useCallback((otdData: any) => {
    const map = new Map<string, OtdPercentiles>()
    if (!otdData) return map
    if (otdData.national) map.set('_NATIONAL_', otdData.national)
    if (otdData.by_state) {
      for (const s of otdData.by_state) {
        if (s.state) map.set(s.state, s)
      }
    }
    return map
  }, [])
  const otdMapClean = React.useMemo(() => buildOtdMap(analyticsData?.otdPercentilesByStateClean), [analyticsData?.otdPercentilesByStateClean, buildOtdMap])
  const otdMapDelayed = React.useMemo(() => buildOtdMap(analyticsData?.otdPercentilesByStateDelayed), [analyticsData?.otdPercentilesByStateDelayed, buildOtdMap])
  const otdMap = includeDelayedOrders ? otdMapDelayed : otdMapClean
  const nationalOtdPercentiles = otdMap.get('_NATIONAL_') || null
  const stateOtdPercentiles = selectedState ? (otdMap.get(selectedState) || nationalOtdPercentiles) : null

  // Prefetch tracking ref — declared early so invalidation effect below can reference it
  const prefetchedRef = React.useRef(false)
  // Generation counter — increments each prefetch cycle so stale responses from a previous
  // context (country/date/client change) are discarded instead of overwriting current data
  const prefetchGenRef = React.useRef(0)

  // Client-side cache for cost-speed filter variants — enables instant filter switching
  const csFilterCacheRef = React.useRef(new Map<string, any>())
  const buildCsFilterCacheKey = React.useCallback((ot: string[] | null, domestic: boolean) => {
    if (!effectiveClientId || !currentDateRange) return null
    const s = currentDateRange.from.toISOString().split('T')[0]
    const e = currentDateRange.to.toISOString().split('T')[0]
    return `${effectiveClientId}:${s}:${e}:${selectedCountry}:${settings.timezone}:${ot?.join(',') || 'all'}:${domestic}`
  }, [effectiveClientId, currentDateRange, selectedCountry, settings.timezone])

  // Whether cost-speed filters are active (different from defaults = all included)
  const hasActiveCostSpeedFilters = activeOrderTypes !== null || filterDomesticOnly
  // When filters are active, cost-speed reads from the filtered response stored in _csFiltered;
  // otherwise falls back to the standard analyticsData. This prevents contaminating other tabs.
  const csAnalyticsData = hasActiveCostSpeedFilters && analyticsData?._csFiltered
    ? analyticsData._csFiltered
    : analyticsData

  // Invalidate cost-speed data when server-affecting filters change (D2C-only, domestic-only)
  const costSpeedFilterKey = `${activeOrderTypes?.join(',') || 'all'}:${filterDomesticOnly}`
  const prevCostSpeedFilterRef = React.useRef(costSpeedFilterKey)
  React.useEffect(() => {
    if (prevCostSpeedFilterRef.current === costSpeedFilterKey) return
    prevCostSpeedFilterRef.current = costSpeedFilterKey

    // Check client-side cache for instant switching (preloaded in background)
    const cacheKey = buildCsFilterCacheKey(activeOrderTypes, filterDomesticOnly)
    const cached = cacheKey ? csFilterCacheRef.current.get(cacheKey) : null
    if (cached) {
      // Instant update — skip loading animation entirely
      loadedTabsRef.current.add('cost-speed')
      if (hasActiveCostSpeedFilters) {
        setAnalyticsData((prev: any) => prev ? { ...prev, _csFiltered: cached } : prev)
      } else {
        setAnalyticsData((prev: any) => prev ? { ...prev, ...cached, _csFiltered: null } : prev)
      }
      return
    }

    // Cache miss — trigger re-fetch
    loadedTabsRef.current.delete('cost-speed')
    prefetchedRef.current = false
    setAnalyticsData((prev: any) => prev ? { ...prev, _csFiltered: null } : prev)
  }, [costSpeedFilterKey, buildCsFilterCacheKey, hasActiveCostSpeedFilters, activeOrderTypes, filterDomesticOnly])

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
      prefetchedRef.current = false

      const params = buildFetchParams(activeTab)
      if (!params) {
        setIsLoadingData(false)
        return
      }

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
        // When loading cost-speed with active filters, also store in _csFiltered
        // so filtered data survives prefetch merges that overwrite core fields
        if (activeTab === 'cost-speed' && hasActiveCostSpeedFilters) {
          setAnalyticsData({ ...data, _csFiltered: data })
        } else {
          setAnalyticsData(data)
        }
        // Cache cost-speed response for instant filter switching
        if (activeTab === 'cost-speed') {
          const ck = buildCsFilterCacheKey(activeOrderTypes, filterDomesticOnly)
          if (ck) csFilterCacheRef.current.set(ck, data)
        }
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

    // Clear filter cache when context changes (new client/date/country)
    csFilterCacheRef.current.clear()
    csPreloadedRef.current = false

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
      if (!params) {
        setIsLoadingTabData(false)
        return
      }

      try {
        const res = await fetch(`/api/data/analytics/tab-data?${params}`)
        if (cancelled) return
        if (!res.ok) return

        const data = await res.json()
        if (cancelled) return

        loadedTabsRef.current.add(activeTab)
        // When cost-speed has active filters, store filtered response separately
        // to avoid overwriting unfiltered data that other tabs use (kpis, statePerformance, etc.)
        if (activeTab === 'cost-speed' && hasActiveCostSpeedFilters) {
          setAnalyticsData((prev: any) => prev ? { ...prev, _csFiltered: data } : data)
        } else {
          setAnalyticsData((prev: any) => {
            const merged = prev ? { ...prev, ...data } : data
            if (activeTab === 'cost-speed') merged._csFiltered = null
            return merged
          })
        }
        // Cache cost-speed response for instant filter switching
        if (activeTab === 'cost-speed') {
          const ck = buildCsFilterCacheKey(activeOrderTypes, filterDomesticOnly)
          if (ck) csFilterCacheRef.current.set(ck, data)
        }
      } catch {
        // Silently fail — user can retry by switching tabs again
      } finally {
        if (!cancelled) setIsLoadingTabData(false)
      }
    }

    fetchTabData()
    return () => { cancelled = true }
  }, [activeTab, analyticsData, effectiveClientId, buildFetchParams])

  // Prefetch other tabs in the background after initial data loads
  // This ensures maps and charts are ready when users switch tabs
  React.useEffect(() => {
    if (!analyticsData || !effectiveClientId || prefetchedRef.current) return
    prefetchedRef.current = true
    const gen = ++prefetchGenRef.current

    const allTabs = ['state-performance', 'cost-speed', 'order-volume', 'carriers-zones', 'financials']
    const remaining = allTabs.filter(t => !loadedTabsRef.current.has(t))
    if (remaining.length === 0) return

    // Stagger fetches to avoid overwhelming the DB
    let delay = 500
    for (const tab of remaining) {
      setTimeout(() => {
        if (prefetchGenRef.current !== gen) return
        const params = buildFetchParams(tab)
        if (!params) return
        fetch(`/api/data/analytics/tab-data?${params}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data && prefetchGenRef.current === gen) {
              loadedTabsRef.current.add(tab)
              if (tab === 'cost-speed' && hasActiveCostSpeedFilters) {
                setAnalyticsData((prev: any) => prev ? { ...prev, _csFiltered: data } : prev)
              } else {
                setAnalyticsData((prev: any) => prev ? { ...prev, ...data } : prev)
              }
              // Cache cost-speed response for instant filter switching
              if (tab === 'cost-speed') {
                const ck = buildCsFilterCacheKey(activeOrderTypes, filterDomesticOnly)
                if (ck) csFilterCacheRef.current.set(ck, data)
              }
            }
          })
          .catch(() => {})
      }, delay)
      delay += 1500
    }
  }, [analyticsData, effectiveClientId, buildFetchParams])

  // Preload cost-speed filter variants in background for instant switching
  // After cost-speed tab loads, preload the opposite domestic variant
  const csPreloadedRef = React.useRef(false)
  React.useEffect(() => {
    if (!analyticsData || !effectiveClientId || !loadedTabsRef.current.has('cost-speed')) return
    if (csPreloadedRef.current) return
    csPreloadedRef.current = true

    // Preload the opposite domestic toggle with current order types
    const oppDomestic = !filterDomesticOnly
    const ck = buildCsFilterCacheKey(activeOrderTypes, oppDomestic)
    if (!ck || csFilterCacheRef.current.has(ck)) return

    setTimeout(() => {
      if (!effectiveClientId || !currentDateRange) return
      const startDate = currentDateRange.from.toISOString().split('T')[0]
      const endDate = currentDateRange.to.toISOString().split('T')[0]
      const params = new URLSearchParams({
        clientId: effectiveClientId,
        startDate,
        endDate,
        datePreset: dateRange,
        country: selectedCountry,
        timezone: settings.timezone,
        tab: 'cost-speed',
      })
      if (oppDomestic && selectedCountry !== 'ALL') params.set('domesticOnly', 'true')
      if (activeOrderTypes) params.set('orderTypes', activeOrderTypes.join(','))

      fetch(`/api/data/analytics/tab-data?${params}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && ck) csFilterCacheRef.current.set(ck, data)
        })
        .catch(() => {})
    }, 2000)
  }, [analyticsData, effectiveClientId, buildCsFilterCacheKey, currentDateRange, dateRange, selectedCountry, settings.timezone, activeOrderTypes, filterDomesticOnly])

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

  // Unified performance panel props — computed once, same component always renders
  const perfPanelProps = React.useMemo(() => {
    const regionLabelPlural = COUNTRY_CONFIGS[perfCountry]?.regionLabelPlural || 'States'
    const regionLabel = COUNTRY_CONFIGS[perfCountry]?.regionLabel || 'State'
    const knownCodes = new Set(Object.keys(COUNTRY_CONFIGS[perfCountry]?.codeToName || {}))
    const filteredData = statePerformance.filter(s => knownCodes.has(s.state))
    const selectedStateData = selectedState ? statePerformance.find(s => s.state === selectedState) : null

    if (selectedStateData) {
      // State mode: direct values, top 5 cities
      const cityData = analyticsData?.perfCityData || []
      const topCities = cityData
        .filter((c: any) => c.state === selectedState && c.orderCount > 0)
        .sort((a: any, b: any) => b.orderCount - a.orderCount)
        .slice(0, 5)

      return {
        title: selectedStateData.stateName,
        orderCount: selectedStateData.orderCount,
        otdPercentiles: stateOtdPercentiles,
        fulfillTime: selectedStateData.avgFulfillTimeHours,
        middleMile: selectedStateData.avgRegionalMileDays,
        lastMile: selectedStateData.avgCarrierTransitDays,
        listTitle: 'Top 5 Cities',
        listItems: topCities.map((c: any) => ({
          key: c.city,
          label: c.city,
          value: c.orderCount.toLocaleString(),
        })),
        clickHint: undefined as string | undefined,
      }
    }

    // National mode: weighted averages, top 5 fastest states
    const totalShipped = filteredData.reduce((sum, s) => sum + s.shippedCount, 0)
    const totalDelivered = filteredData.reduce((sum, s) => sum + s.deliveredCount, 0)
    const avgFulfillTime = totalShipped > 0
      ? filteredData.reduce((sum, s) => sum + (s.avgFulfillTimeHours * s.shippedCount), 0) / totalShipped : 0
    const avgCarrierTransit = totalDelivered > 0
      ? filteredData.reduce((sum, s) => sum + (s.avgCarrierTransitDays * s.deliveredCount), 0) / totalDelivered : 0
    const avgRegionalMile = totalDelivered > 0
      ? filteredData.reduce((sum, s) => {
          const rm = s.avgDeliveryTimeDays > 0 ? Math.max(0, s.avgDeliveryTimeDays - s.avgFulfillTimeHours / 24 - s.avgCarrierTransitDays) : 0
          return sum + (rm * s.deliveredCount)
        }, 0) / totalDelivered : 0

    const eligible = filteredData.filter(s => s.avgDeliveryTimeDays > 0)
    const strict = eligible.filter(s => s.deliveredCount >= 10)
    const fastest = (strict.length >= 3 ? strict : eligible.filter(s => s.deliveredCount >= 1))
      .sort((a, b) => a.avgDeliveryTimeDays - b.avgDeliveryTimeDays)
      .slice(0, 5)

    const getBadge = (d: number) => {
      if (d < 3) return React.createElement(Badge, { className: 'bg-green-500 text-[10px] px-1.5 py-0' }, 'Fast')
      if (d < 5) return React.createElement(Badge, { className: 'bg-[hsl(203,61%,50%)] text-[10px] px-1.5 py-0' }, 'Good')
      return React.createElement(Badge, { className: 'bg-orange-500 text-[10px] px-1.5 py-0' }, 'Slow')
    }

    return {
      title: `${perfCountry === 'US' ? 'USA' : COUNTRY_CONFIGS[perfCountry]?.label} National Average`,
      orderCount: totalShipped,
      otdPercentiles: nationalOtdPercentiles,
      fulfillTime: avgFulfillTime,
      middleMile: avgRegionalMile,
      lastMile: avgCarrierTransit,
      listTitle: `Top 5 Fastest ${regionLabelPlural}`,
      listItems: fastest.map(s => ({
        key: s.state,
        label: s.stateName,
        value: `${s.avgDeliveryTimeDays.toFixed(1)}d`,
        badge: getBadge(s.avgDeliveryTimeDays),
      })),
      clickHint: `Click a ${regionLabel.toLowerCase()} on the map to view detailed metrics`,
    }
  }, [selectedState, statePerformance, analyticsData?.perfCityData, perfCountry, nationalOtdPercentiles, stateOtdPercentiles])

  const kpiData: KPIMetrics = analyticsData?.kpis || {
    totalCost: 0, orderCount: 0, avgTransitTime: 0, avgFulfillTime: 0, slaPercent: 0, lateOrders: 0,
    periodChange: { totalCost: 0, orderCount: 0, avgTransitTime: 0, slaPercent: 0, lateOrders: 0 }
  }

  // Shared axis tick style — Geist Sans, tabular nums, muted
  const axisTick = { fontSize: 11, fontFamily: 'var(--font-roboto), system-ui, sans-serif', fill: 'hsl(240 5% 55%)' }

  // === cost-speed tab (reads from csAnalyticsData when filters are active) ===
  const costTrendData: CostTrendData[] = csAnalyticsData?.costTrend || []

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

  const stateCostSpeedData: StateCostSpeedData[] = csAnalyticsData?.stateCostSpeed || []
  const zoneCostData: ZoneCostData[] = React.useMemo(() => {
    const raw: ZoneCostData[] = (csAnalyticsData?.zoneCost || []).filter((z: ZoneCostData) => z.avgTransitTime > 0)
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
  }, [csAnalyticsData?.zoneCost])
  const deliverySpeedTrendData: DeliverySpeedTrendData[] = React.useMemo(() => {
    const raw = csAnalyticsData?.deliverySpeedTrend || []
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
  }, [csAnalyticsData?.deliverySpeedTrend, includeDelayedOrders])
  const transitTimeDistributionData: TransitTimeDistributionData[] = csAnalyticsData?.transitDistribution || []
  const shipOptionPerformanceData: ShipOptionPerformanceData[] = csAnalyticsData?.shipOptionPerformance || []

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
  const dailyVolumeChart = useChartDateRange(dailyOrderVolume, 'dailyVolume', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL', undefined, 'order-volume')
  const hourChart = useChartDateRange(orderVolumeByHour, 'volumeByHour', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL', undefined, 'order-volume')
  const dowChart = useChartDateRange(orderVolumeByDayOfWeek, 'volumeByDayOfWeek', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL', undefined, 'order-volume')
  const fcChart = useChartDateRange(orderVolumeByFC, 'volumeByFC', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL', undefined, 'order-volume')
  const storeChart = useChartDateRange(orderVolumeByStore, 'volumeByStore', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, 'ALL', undefined, 'order-volume')

  // === Cost + Speed tab hooks ===
  // Page data includes all destinations. The "Include International" checkbox filters via
  // page-level re-fetch (buildFetchParams includes domesticOnly when needed).
  // All hooks use page data directly — no independent per-hook fetching.
  const costSpeedKpiSection = useChartSectionRange(csAnalyticsData, dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  // Map section now follows header selectors (costSpeedKpiSection) — no independent overrides
  const costTrendChart = useChartDateRange(costTrendData, 'costTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const deliverySpeedChart = useChartDateRange(csAnalyticsData?.deliverySpeedTrend || [], 'deliverySpeedTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const zoneCostChart = useChartDateRange(analyticsData?.zoneCost || [], 'zoneCost', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const shipOptionChart = useChartDateRange(shipOptionPerformanceData, 'shipOptionPerformance', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)

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
  // Financials now supports origin-country filtering (US/CA/ALL).
  // No lockedCountry — charts follow the page-level country selector and can be independently changed.
  const shipOptionExtraParams = React.useMemo(() => {
    const params: Record<string, string> = {}
    if (selectedServiceGroups.length < ALL_SERVICE_GROUPS.length) {
      params.shipOptionGroups = selectedServiceGroups.join(',')
    }
    if (filterDomesticOnly && selectedCountry !== 'ALL') {
      params.domesticOnly = 'true'
    }
    if (activeOrderTypes) {
      params.orderTypes = activeOrderTypes.join(',')
    }
    return Object.keys(params).length > 0 ? params : undefined
  }, [selectedServiceGroups, filterDomesticOnly, selectedCountry, activeOrderTypes])
  const financialsSection = useChartSectionRange(analyticsData, dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const billingTrendChart = useChartDateRange(billingTrendData, 'billingTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const costDistChart = useChartDateRange(billingCategoryBreakdown, 'billingCategoryBreakdown', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const feeBreakdownChart = useChartDateRange(analyticsData?.billingTrendWeekly || billingTrendData, 'billingTrendWeekly', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const pickPackChart = useChartDateRange(pickPackDistribution, 'pickPackDistribution', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const costPerOrderChart = useChartDateRange(costPerOrderTrend, 'costPerOrderTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const shippingByZoneChart = useChartDateRange(analyticsData?.shippingCostByZone || [], 'shippingCostByZone', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const additionalSvcChart = useChartDateRange(additionalServicesBreakdown, 'additionalServicesBreakdown', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, shipOptionExtraParams, 'financials')
  const skuCostChart = useChartDateRange(analyticsData?.skuCostBreakdown || [], 'skuCostBreakdown', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, undefined, 'cost-speed')
  const weightCostChart = useChartDateRange(analyticsData?.weightCostBreakdown || [], 'weightCostBreakdown', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache, undefined, undefined, 'cost-speed')

  // === SKU cost trend (fetched on-demand when a SKU is selected) ===
  const [skuTrendQtys, setSkuTrendQtys] = React.useState<{ qty: number; orders: number }[]>([])
  const [selectedTrendQty, setSelectedTrendQty] = React.useState<string>('all')
  // Raw data keyed by qty for filtering
  const [skuTrendRaw, setSkuTrendRaw] = React.useState<{ week: string; qty: number; orderCount: number; avgCostPerOrder: number }[]>([])
  React.useEffect(() => {
    if (!selectedTrendSku || !effectiveClientId || effectiveClientId === 'all') {
      setSkuTrendData([])
      setSkuTrendQtys([])
      setSkuTrendRaw([])
      return
    }
    if (skuTrendPreset === 'custom' && (!skuTrendCustomRange.from || !skuTrendCustomRange.to)) return
    const range = skuTrendPreset === 'custom' && skuTrendCustomRange.from && skuTrendCustomRange.to
      ? { from: skuTrendCustomRange.from, to: skuTrendCustomRange.to }
      : getDateRangeFromPreset(skuTrendPreset)
    const startDate = range.from.toISOString().split('T')[0]
    const endDate = range.to.toISOString().split('T')[0]
    let cancelled = false
    setSkuTrendLoading(true)
    fetch(`/api/data/analytics/sku-cost-trend?clientId=${effectiveClientId}&sku=${encodeURIComponent(selectedTrendSku)}&startDate=${startDate}&endDate=${endDate}&country=${skuTrendCountry}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          const raw = (d.data || []).map((p: any) => ({
            week: p.week as string,
            qty: Number(p.qty),
            orderCount: Number(p.order_count),
            avgCostPerOrder: Number(p.avg_cost_per_order),
          }))

          // Trim incomplete last week
          const allWeeks = [...new Set(raw.map((r: any) => r.week))].sort() as string[]
          if (allWeeks.length > 1) {
            const lastWeek = new Date(allWeeks[allWeeks.length - 1] + 'T00:00:00')
            const now = new Date()
            if ((now.getTime() - lastWeek.getTime()) / (1000 * 60 * 60 * 24) < 7) {
              const cutoff = allWeeks[allWeeks.length - 1]
              raw.splice(0, raw.length, ...raw.filter((r: any) => r.week !== cutoff))
            }
          }

          // Build qty options sorted by total orders
          const qtyOrders = new Map<number, number>()
          for (const r of raw) qtyOrders.set(r.qty, (qtyOrders.get(r.qty) || 0) + r.orderCount)
          const qtys = [...qtyOrders.entries()]
            .filter(([, orders]) => orders >= 5)
            .sort((a, b) => a[0] - b[0])
            .map(([qty, orders]) => ({ qty, orders }))

          setSkuTrendRaw(raw)
          setSkuTrendQtys(qtys)
          // Auto-select most common qty, or 'all' if only one option
          if (qtys.length <= 1) {
            setSelectedTrendQty('all')
          } else {
            const mostCommon = qtys.reduce((a, b) => b.orders > a.orders ? b : a)
            setSelectedTrendQty(String(mostCommon.qty))
          }
        }
      })
      .catch(() => { if (!cancelled) { setSkuTrendData([]); setSkuTrendQtys([]); setSkuTrendRaw([]) } })
      .finally(() => { if (!cancelled) setSkuTrendLoading(false) })
    return () => { cancelled = true }
  }, [selectedTrendSku, effectiveClientId, skuTrendPreset, skuTrendCountry, skuTrendCustomRange])

  // Derive chart data from raw + selected qty
  React.useEffect(() => {
    if (skuTrendRaw.length === 0) { setSkuTrendData([]); return }
    const filtered = selectedTrendQty === 'all'
      ? skuTrendRaw
      : skuTrendRaw.filter(r => r.qty === Number(selectedTrendQty))
    // Aggregate by week (for 'all', sum orders and compute weighted avg cost)
    const weekMap = new Map<string, { totalCost: number; orders: number }>()
    for (const r of filtered) {
      const existing = weekMap.get(r.week) || { totalCost: 0, orders: 0 }
      existing.totalCost += r.avgCostPerOrder * r.orderCount
      existing.orders += r.orderCount
      weekMap.set(r.week, existing)
    }
    const points: SkuCostTrendPoint[] = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, { totalCost, orders }]) => ({
        week,
        avgCostPerOrder: orders > 0 ? Math.round((totalCost / orders) * 100) / 100 : 0,
        orderCount: orders,
      }))
    setSkuTrendData(points)
  }, [skuTrendRaw, selectedTrendQty])

  // Cache SKU options so dropdown doesn't empty during refetches
  const [cachedSkuOptions, setCachedSkuOptions] = React.useState<SkuCostData[]>([])
  React.useEffect(() => {
    const skuData = (skuCostChart.data as SkuCostData[]) || []
    if (skuData.length > 0) {
      setCachedSkuOptions(skuData)
      if (!selectedTrendSku) setSelectedTrendSku(skuData[0].sku)
    }
  }, [skuCostChart.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // === SLA tab hooks ===
  const slaTrendChart = useChartDateRange(analyticsData?.onTimeTrend || [], 'onTimeTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const fulfillTrendChart = useChartDateRange(analyticsData?.fulfillmentTrend || [], 'fulfillmentTrend', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)
  const fcFulfillChart = useChartDateRange(fcFulfillmentMetrics, 'fcFulfillmentMetrics', dateRange, effectiveClientId, selectedCountry, settings.timezone, chartDataCache)

  // === Cost+Speed KPI section derived data ===
  const kpiSectionData = costSpeedKpiSection.data
  const kpiSectionKpis = kpiSectionData?.kpis || kpiData
  const kpiSectionAvgCost = React.useMemo(() => {
    // Use period-level totals from kpis (shipping-only, includes all days)
    // rather than reconstructing from costTrend (which filters out zero-cost days,
    // inflating the per-order average)
    const kpis = kpiSectionData?.kpis || kpiData
    if (!kpis || kpis.orderCount === 0) return null
    return kpis.totalCost / kpis.orderCount
  }, [kpiSectionData?.kpis, kpiData])
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

  // === Cost+Speed map section — follows header selectors ===
  const mapStateCostSpeedData = kpiSectionData?.stateCostSpeed || stateCostSpeedData

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
  const carrierZoneCostDataAll = React.useMemo(() => bucketZoneCost(carrierZoneChart.data as ZoneCostData[], carrierZoneChart.country), [carrierZoneChart.data, carrierZoneChart.country])
  const carrierZoneCostData = React.useMemo(() => includeIntlZones ? carrierZoneCostDataAll : carrierZoneCostDataAll.filter(z => z.zone !== 'Intl'), [carrierZoneCostDataAll, includeIntlZones])
  const zoneDeepDiveData = React.useMemo(() => bucketZoneCost(zoneDeepDiveChart.data as ZoneCostData[], zoneDeepDiveChart.country), [zoneDeepDiveChart.data, zoneDeepDiveChart.country])

  const carrierSectionData = carrierSection.data
  const [carrierShipOption, setCarrierShipOption] = React.useState<string>('Standard / Economy')
  const rawShipOptions: { name: string; count: number }[] = carrierSectionData?.availableShipOptions || analyticsData?.availableShipOptions || []
  // Only show ship options where at least one carrier has 50+ orders
  const availableShipOptions = React.useMemo(() => {
    const byShipOptionPerf = carrierSectionData?.carrierPerformanceByShipOption || analyticsData?.carrierPerformanceByShipOption || {}
    return rawShipOptions.filter(so => {
      const carriers: any[] = byShipOptionPerf[so.name] || []
      return carriers.some(c => c.orderCount >= 50)
    })
  }, [rawShipOptions, carrierSectionData, analyticsData])
  // Reset to Standard / Economy if current selection no longer available
  React.useEffect(() => {
    if (availableShipOptions.length > 0 && !availableShipOptions.some(so => so.name === carrierShipOption)) {
      setCarrierShipOption(availableShipOptions[0].name)
    }
  }, [availableShipOptions, carrierShipOption])
  const chartCarrierPerformance: CarrierPerformance[] = React.useMemo(() => {
    const allData = carrierSectionData?.carrierPerformance || carrierPerformance
    if (carrierShipOption === 'All') return allData
    const byShipOption = carrierSectionData?.carrierPerformanceByShipOption || analyticsData?.carrierPerformanceByShipOption || {}
    return byShipOption[carrierShipOption] || allData
  }, [carrierSectionData, carrierPerformance, analyticsData, carrierShipOption])
  const chartTransitDistribution: TransitTimeDistributionData[] = carrierSectionData?.transitDistribution || transitTimeDistributionData
  const chartCarrierZoneBreakdown: { carrier: string; zone: string; orderCount: number; avgTransitTime?: number }[] = React.useMemo(() => {
    const allData = carrierSectionData?.carrierZoneBreakdown || analyticsData?.carrierZoneBreakdown || []
    if (carrierShipOption === 'All') return allData
    const byShipOption = carrierSectionData?.carrierZoneByShipOption || analyticsData?.carrierZoneByShipOption || {}
    return byShipOption[carrierShipOption] || allData
  }, [carrierSectionData, analyticsData, carrierShipOption])
  const chartCarrierZoneCost: ZoneCostData[] = carrierSectionData?.zoneCost || analyticsData?.zoneCost || []


  // Background pre-fetch all presets so chart selector changes are instant
  // Fast presets first, then slower ones — all in background
  const PREFETCH_PRESETS = ['14d', '30d', '60d', '90d', '6mo', '1yr', 'mtd', 'ytd', 'all']
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
  const finBillingCategoryBreakdown: BillingCategoryBreakdown[] = finData?.billingCategoryBreakdown || billingCategoryBreakdown
  // Adjusted KPIs based on Period Summary toggles (Credits only — order type filtering is now server-side)
  const adjustedBillingSummary = React.useMemo(() => {
    let totalCost = finBillingSummary.totalCost
    const orderCount = finBillingSummary.orderCount

    // Credits are already subtracted from totalCost by the API.
    // When Include Credits is unchecked, add credits back to show gross cost.
    const creditAmount = finBillingEfficiency.totalCredits || 0
    if (!filterIncludeCredits && creditAmount > 0) {
      totalCost += creditAmount
    }

    const costPerOrder = orderCount > 0 ? totalCost / orderCount : 0
    return { totalCost, orderCount, costPerOrder, periodChange: finBillingSummary.periodChange }
  }, [finBillingSummary, finBillingEfficiency, filterIncludeCredits])

  const adjustedBillingEfficiency = React.useMemo(() => {
    const totalCost = adjustedBillingSummary.totalCost
    const orderCount = adjustedBillingSummary.orderCount
    const totalItems = finBillingEfficiency.avgItemsPerOrder * orderCount
    return {
      ...finBillingEfficiency,
      costPerItem: totalItems > 0 ? totalCost / totalItems : 0,
      fulfillmentAsPercentOfRevenue: finBillingEfficiency.avgRevenuePerOrder > 0 && orderCount > 0
        ? (totalCost / (finBillingEfficiency.avgRevenuePerOrder * orderCount)) * 100
        : finBillingEfficiency.fulfillmentAsPercentOfRevenue,
      surchargePercentOfCost: totalCost > 0
        ? finBillingEfficiency.surchargePercentOfCost * (finBillingSummary.totalCost / totalCost)
        : 0,
    }
  }, [adjustedBillingSummary, finBillingEfficiency, finBillingSummary])

  // Filtered billing trend data — respects Include Credits toggle
  // Order type filtering is handled server-side via p_order_types parameter
  const filteredBillingTrend = React.useMemo(() => {
    return finBillingTrend.map(d => ({
      ...d,
      credit: filterIncludeCredits ? d.credit : 0,
    }))
  }, [finBillingTrend, filterIncludeCredits])

  // Compute Y-axis domain for cost breakdown chart — zoom in so non-shipping fees are visible
  const billingChartYDomain = React.useMemo(() => {
    if (filteredBillingTrend.length === 0) return [0, 'auto'] as [number, string]
    // Stacked peak = sum of all positive categories
    const stackedTotals = filteredBillingTrend.map(d =>
      d.shipping + d.surcharges + d.extraPicks + d.warehousing + d.multiHubIQ + d.b2b + d.vasKitting + d.receiving + d.returns + d.dutyTax + d.other
    )
    const maxStacked = Math.max(...stackedTotals)
    const minStacked = Math.min(...stackedTotals)
    const step = maxStacked > 10000 ? 1000 : 500
    // Cut off 90% of the uniform baseline so chart focuses on the variation
    const floor = Math.max(0, Math.floor(minStacked * 0.9 / step) * step)
    const ceil = Math.ceil(maxStacked * 1.05 / step) * step
    return [floor, ceil] as [number, number]
  }, [filteredBillingTrend])

  // === sla tab ===
  const slaMetricsBase = React.useMemo(() => {
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

  // Compute SLA average from the chart's displayed trend data so KPI always matches chart
  const slaMetrics = React.useMemo(() => {
    const chartData = slaTrendChart.data as any[]
    if (!chartData || chartData.length === 0) return slaMetricsBase
    const valid = chartData.filter((d: any) => d.onTimePercent != null && d.onTimePercent >= 0)
    if (valid.length === 0) return slaMetricsBase
    const avg = valid.reduce((sum: number, d: any) => sum + d.onTimePercent, 0) / valid.length
    return { ...slaMetricsBase, onTimePercent: avg }
  }, [slaMetricsBase, slaTrendChart.data])

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
      'mtd': 'Month to Date',
      'ytd': 'Year to Date',
      'all': 'All Time',
    }
    return labels[dateRange] || 'Last 30 Days'
  }, [dateRange, customDateRange])

  // Handle date preset change from Select dropdown
  const handleDatePresetChange = (value: string) => {
    if (value === 'custom') {
      setDateRange('custom' as DateRangePreset)
      setCustomPickerOpen(true)
    } else {
      setDateRange(value as DateRangePreset)
      setCustomDateRange({ from: undefined, to: undefined })
      setCustomPickerOpen(false)
    }
  }

  // When custom is active with dates set, use a non-matching value so
  // "Custom" isn't highlighted and can be re-clicked to reopen the picker
  const dateRangeSelectValue = dateRange === 'custom' && customDateRange.from && customDateRange.to && !customPickerOpen
    ? 'custom-active'
    : dateRange

  // Volume data is always current since it comes pre-computed from the server
  // When no client is selected, treat as "current" so Loading indicator doesn't show forever
  const isVolumeDataCurrent = hasData || !effectiveClientId

  // Handle tab change and update URL
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    // Reset custom date range so it doesn't bleed across tabs
    if (dateRange === 'custom') {
      setDateRange('90d')
      setCustomDateRange({ from: undefined, to: undefined })
      setCustomPickerOpen(false)
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  return (
    <PermissionGuard permission="analytics">
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
      <div className="flex flex-1 flex-col overflow-hidden bg-background rounded-t-xl">
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

              {/* Tab content wrapper */}
              <div className="relative">
              <div className={isLoadingData ? "opacity-30 pointer-events-none transition-opacity duration-300" : "transition-opacity duration-150"}>

              {/* Tab 1: Financials */}
              <TabsContent value="financials" className="mt-0">
                <div className="-mx-4 lg:-mx-6 -mt-5 -mb-6 h-[calc(100vh-64px)] overflow-y-auto bg-zinc-50 dark:bg-zinc-900">
                  {/* Featured Row: Chart (2 cols) + Summary Sidebar (1 col) */}
                  <div className={`grid lg:grid-cols-3 transition-opacity duration-300 ${financialsSection.isFetching ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                    {/* Chart — 2 columns */}
                    <div className="lg:col-span-2 bg-muted dark:bg-zinc-900 relative flex flex-col after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[15%] after:bg-gradient-to-b after:from-transparent after:to-zinc-50 dark:after:to-zinc-900 after:pointer-events-none after:z-[1]">
                      {/* Header bar — inside chart column */}
                      <div className="flex items-start justify-between gap-4 px-4 lg:px-6 py-5">
                        <div>
                          <div className="text-lg font-semibold">Cost Breakdown</div>
                          <div className="text-xs text-muted-foreground mt-0.5">All fee categories over time</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {financialsSection.isFetching && <JetpackLoader size="sm" />}
                          <MultiSelectFilter
                            options={SERVICE_GROUP_OPTIONS}
                            selected={selectedServiceGroups}
                            onSelectionChange={setSelectedServiceGroups}
                            placeholder="Services"
                            showCount={false}
                          />
                          <MultiSelectFilter
                            options={FINANCIALS_FILTER_OPTIONS}
                            selected={analyticsFilters}
                            onSelectionChange={setAnalyticsFilters}
                            placeholder="Include"
                            showCount={false}
                          />
                          <ChartSelectors chart={financialsSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideLoader />
                        </div>
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
                        <AreaChart data={filteredBillingTrend} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fillShipping" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--color-shipping)" stopOpacity={0.6} />
                              <stop offset="95%" stopColor="var(--color-shipping)" stopOpacity={0.15} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                          <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} height={28} tick={{ fill: 'hsl(var(--foreground))' }} />
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
                        <div className="text-sm font-semibold whitespace-nowrap">Period Summary</div>
                      </div>
                      {/* Row 1: Total Cost — full width */}
                      <div className="flex flex-col items-center justify-center px-4 bg-sky-50/50 dark:bg-sky-950/20 border-b border-border flex-1">
                        <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Total Cost <KpiTooltip text={KPI_TOOLTIPS.totalCost} /></div>
                        <div className="text-3xl font-bold tabular-nums">
                          <AnimatedNumber value={adjustedBillingSummary.totalCost} prefix="$" decimals={2} locale />
                        </div>
                        <div className={cn(
                          "text-xs mt-1",
                          adjustedBillingSummary.periodChange.totalCost > 0 ? "text-red-500" : adjustedBillingSummary.periodChange.totalCost < 0 ? "text-green-500" : "text-zinc-400 dark:text-zinc-500"
                        )}>
                          {adjustedBillingSummary.periodChange.totalCost > 0 ? "+" : ""}{adjustedBillingSummary.periodChange.totalCost.toFixed(1)}% vs prev period
                        </div>
                      </div>
                      {/* Row 2: Orders | Cost per Order */}
                      <div className="grid grid-cols-2 border-b border-border flex-1">
                        <div className="flex flex-col items-center justify-center px-3 border-r border-border bg-emerald-50/50 dark:bg-emerald-950/20">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Orders <KpiTooltip text={KPI_TOOLTIPS.orders} /></div>
                          <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={adjustedBillingSummary.orderCount} locale /></div>
                          <div className={cn(
                            "text-[10px] mt-0.5",
                            adjustedBillingSummary.periodChange.orderCount > 0 ? "text-green-500" : adjustedBillingSummary.periodChange.orderCount < 0 ? "text-red-500" : "text-zinc-400 dark:text-zinc-500"
                          )}>
                            {adjustedBillingSummary.periodChange.orderCount > 0 ? "+" : ""}{adjustedBillingSummary.periodChange.orderCount.toFixed(1)}%
                          </div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-3 bg-amber-50/40 dark:bg-amber-950/15">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Cost / Order <KpiTooltip text={KPI_TOOLTIPS.costPerOrder} /></div>
                          <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={adjustedBillingSummary.costPerOrder} prefix="$" decimals={2} /></div>
                          <div className={cn(
                            "text-[10px] mt-0.5",
                            adjustedBillingSummary.periodChange.costPerOrder > 0 ? "text-red-500" : adjustedBillingSummary.periodChange.costPerOrder < 0 ? "text-green-500" : "text-zinc-400 dark:text-zinc-500"
                          )}>
                            {adjustedBillingSummary.periodChange.costPerOrder > 0 ? "+" : ""}{adjustedBillingSummary.periodChange.costPerOrder.toFixed(1)}%
                          </div>
                        </div>
                      </div>
                      {/* Row 3: Cost/Item | Items/Order | % of Revenue */}
                      <div className="grid grid-cols-3 border-b border-border flex-1">
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Cost / Item <KpiTooltip text={KPI_TOOLTIPS.costPerItem} /></div>
                          <div className="text-lg font-bold tabular-nums"><AnimatedNumber value={adjustedBillingEfficiency.costPerItem} prefix="$" decimals={2} /></div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Items / Order <KpiTooltip text={KPI_TOOLTIPS.itemsPerOrder} /></div>
                          <div className="text-lg font-bold tabular-nums"><AnimatedNumber value={adjustedBillingEfficiency.avgItemsPerOrder} decimals={1} /></div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">% of Revenue <KpiTooltip text={KPI_TOOLTIPS.pctOfRevenue} /></div>
                          <div className="text-lg font-bold tabular-nums"><AnimatedNumber value={adjustedBillingEfficiency.fulfillmentAsPercentOfRevenue} decimals={1} suffix="%" /></div>
                        </div>
                      </div>
                      {/* Row 4: Avg Rev/Order | Surcharge % | Credits */}
                      <div className="grid grid-cols-3 flex-1 border-b border-border">
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border bg-indigo-50/40 dark:bg-indigo-950/15">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Avg. Rev / Order <KpiTooltip text={KPI_TOOLTIPS.revPerOrder} /></div>
                          <div className="text-lg font-bold tabular-nums"><AnimatedNumber value={adjustedBillingEfficiency.avgRevenuePerOrder} prefix="$" decimals={2} /></div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 border-r border-border">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Surcharges <KpiTooltip text={KPI_TOOLTIPS.surcharges} /></div>
                          <div className="text-lg font-bold tabular-nums"><AnimatedNumber value={adjustedBillingEfficiency.surchargePercentOfCost} decimals={1} suffix="%" /></div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-2 bg-green-50/50 dark:bg-green-950/15">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Credits <KpiTooltip text={KPI_TOOLTIPS.credits} /></div>
                          <div className="text-lg font-bold tabular-nums text-green-600 dark:text-green-400"><AnimatedNumber value={adjustedBillingEfficiency.totalCredits} prefix="$" locale /></div>
                        </div>
                      </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 lg:px-8 py-8 space-y-12">
                {/* Row 2: Cost Distribution + Cost per Order Trend */}
                <div className="grid gap-[50px] md:grid-cols-2">
                  {/* Cost Distribution */}
                  <Card className="bg-transparent shadow-none min-h-[250px]">
                    <CardHeader className="pb-0">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm font-medium"><div>Cost Distribution</div></CardTitle>
                          <CardDescription className="text-xs">Breakdown by category</CardDescription>
                        </div>
                        <ChartSelectors chart={costDistChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                      </div>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {(() => {
                        const allCategories = costDistChart.data as BillingCategoryBreakdown[]
                        const categories = allCategories.filter(c => c.amount > 0)
                        const positiveCategories = categories
                        const positiveTotal = positiveCategories.reduce((s, c) => s + c.amount, 0)
                        const chartTotal = positiveTotal

                        return (
                          <div>
                            {/* Total */}
                            <div className="flex items-baseline gap-2 mb-4">
                              <span className="text-2xl font-bold tabular-nums">
                                ${chartTotal >= 1000 ? `${(chartTotal / 1000).toFixed(1)}k` : chartTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                              <span className="text-xs text-muted-foreground">total spend</span>
                            </div>

                            {/* Stacked proportion bar — cube-root scale so small categories are visible */}
                            <div className="h-3 rounded-full overflow-hidden flex mb-5 bg-muted/20">
                              {(() => {
                                const cbrtWidths = positiveCategories.map(c => Math.cbrt(c.amount))
                                const cbrtTotal = cbrtWidths.reduce((s, w) => s + w, 0)
                                return positiveCategories.map((cat, idx) => {
                                  const originalIdx = categories.indexOf(cat)
                                  const widthPct = cbrtTotal > 0 ? (cbrtWidths[idx] / cbrtTotal) * 100 : 0
                                  return (
                                    <div
                                      key={cat.category}
                                      className="h-full transition-all"
                                      style={{
                                        width: `${widthPct}%`,
                                        backgroundColor: COST_DIST_COLORS[originalIdx] || COST_DIST_COLORS[idx % COST_DIST_COLORS.length],
                                        opacity: 0.85,
                                      }}
                                    />
                                  )
                                })
                              })()}
                            </div>

                            {/* Category rows */}
                            <div className="space-y-1.5">
                              {categories.map((cat, idx) => (
                                  <div key={cat.category} className="flex items-center gap-2">
                                    <span
                                      className="w-2 h-2 rounded-sm flex-shrink-0"
                                      style={{ backgroundColor: COST_DIST_COLORS[idx % COST_DIST_COLORS.length] }}
                                    />
                                    <span className="text-xs flex-1 truncate">{cat.category}</span>
                                    <span className="text-xs font-medium tabular-nums text-right">
                                      ${cat.amount >= 1000
                                        ? `${(cat.amount / 1000).toFixed(1)}k`
                                        : cat.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                    <span className="text-[11px] tabular-nums text-right w-12 text-muted-foreground">
                                      {(positiveTotal > 0 ? (cat.amount / positiveTotal * 100) : 0).toFixed(1)}%
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )
                      })()}
                    </CardContent>
                  </Card>

                  {/* Cost per Order Trend */}
                  <Card className="bg-transparent shadow-none flex flex-col min-h-0 overflow-hidden">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-[15px]">
                      <div>
                        <div className="text-sm font-semibold">Cost per Order Trend</div>
                        <div className="text-xs text-muted-foreground mt-0.5">All fees per order over time</div>
                      </div>
                      <ChartSelectors chart={costPerOrderChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                    </div>
                    <CardContent className="flex-1 min-h-0 relative">
                      <div className="absolute inset-0">
                      <ChartContainer
                        config={{
                          costPerOrder: { label: "Cost per Order", color: "hsl(var(--chart-1))" },
                        }}
                        className="w-full h-full !aspect-auto"
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
                          <Customized component={(props: any) => {
                            const { width, height, offset } = props
                            if (!offset) return null
                            const pts = costPerOrderChart.data as CostPerOrderTrend[]
                            if (!pts || pts.length === 0) return null
                            const useAuthoritativeAvg = costPerOrderChart.preset === financialsSection.preset
                            const avg = useAuthoritativeAvg
                              ? adjustedBillingSummary.costPerOrder
                              : (() => { const tot = pts.reduce((s: number, d: any) => s + d.orderCount, 0); return tot > 0 ? pts.reduce((s: number, d: any) => s + d.costPerOrder * d.orderCount, 0) / tot : 0 })()
                            const plotLeft = offset.left
                            const plotRight = width - offset.right
                            const plotBottom = height - offset.bottom
                            const plotCenterX = (plotLeft + plotRight) / 2
                            const badgeH = 36
                            const badgeW = 72
                            return (
                              <g className="pointer-events-none">
                                <foreignObject x={plotLeft} y={plotBottom - badgeH} width={badgeW} height={badgeH}>
                                  <div className="px-2 py-1 bg-green-500/10 backdrop-blur-sm rounded-tr border border-green-500/20 border-l-0 border-b-0">
                                    <div className="text-[9px] text-muted-foreground leading-tight">Lowest</div>
                                    <div className="text-xs font-semibold text-green-600 tabular-nums">${Math.min(...pts.map((d: any) => d.costPerOrder)).toFixed(2)}</div>
                                  </div>
                                </foreignObject>
                                <foreignObject x={plotCenterX - badgeW / 2} y={plotBottom - badgeH} width={badgeW} height={badgeH}>
                                  <div className="px-2 py-1 bg-white/60 dark:bg-zinc-900/60 backdrop-blur-sm rounded-t border border-border/40 border-b-0">
                                    <div className="text-[9px] text-muted-foreground leading-tight">Average</div>
                                    <div className="text-xs font-semibold tabular-nums">${avg.toFixed(2)}</div>
                                  </div>
                                </foreignObject>
                                <foreignObject x={plotRight - badgeW} y={plotBottom - badgeH} width={badgeW} height={badgeH}>
                                  <div className="px-2 py-1 bg-red-500/10 backdrop-blur-sm rounded-tl border border-red-500/20 border-r-0 border-b-0">
                                    <div className="text-[9px] text-muted-foreground leading-tight">Highest</div>
                                    <div className="text-xs font-semibold text-red-600 tabular-nums">${Math.max(...pts.map((d: any) => d.costPerOrder)).toFixed(2)}</div>
                                  </div>
                                </foreignObject>
                              </g>
                            )
                          }} />
                        </AreaChart>
                      </ChartContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 3: Non-Shipping Cost Breakdown + Pick & Pack Distribution */}
                <div className="grid gap-[50px] md:grid-cols-2">
                  <Card className="bg-transparent shadow-none min-h-[250px]">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-[15px]">
                      <div>
                        <div className="text-sm font-semibold">Non-Shipping Cost Breakdown</div>
                        <div className="text-xs text-muted-foreground mt-0.5">All fulfillment fees excluding shipping and credits</div>
                      </div>
                      <ChartSelectors chart={additionalSvcChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                    </div>
                    <CardContent>
                      {(() => {
                        const svcData = (additionalSvcChart.data as AdditionalServicesBreakdown[]) || []
                        const totalAmount = svcData.reduce((s, d) => s + d.amount, 0)
                        const maxAmount = Math.max(...svcData.map(d => d.amount), 1)
                        // Cube-root scale: middle ground between sqrt and log compression
                        const cbrtMax = Math.cbrt(maxAmount)
                        return (
                          <div className="space-y-2.5">
                            {svcData.map((d, i) => {
                              const pct = totalAmount > 0 ? (d.amount / totalAmount * 100) : 0
                              // cube-root scale with 3% minimum so even tiny amounts show a sliver
                              const barWidth = Math.max(3, (Math.cbrt(d.amount) / cbrtMax) * 100)
                              const hue = 217
                              const lightness = 42 + i * (30 / Math.max(svcData.length - 1, 1))
                              return (
                                <div key={d.category} className="flex items-center gap-3">
                                  <div className="w-[130px] shrink-0 text-[11px] font-medium truncate">{d.category}</div>
                                  <div className="flex-1 min-w-0">
                                    <div
                                      className="h-[18px] rounded"
                                      style={{
                                        width: `${barWidth}%`,
                                        backgroundColor: `hsl(${hue}, 72%, ${lightness}%)`,
                                      }}
                                    />
                                  </div>
                                  <div className="shrink-0 text-[11px] font-medium tabular-nums text-right w-[140px]">
                                    ${d.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({pct.toFixed(1)}%)
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </CardContent>
                  </Card>

                  {/* Pick/Pack Distribution */}
                  <Card className="bg-transparent shadow-none flex flex-col min-h-0 overflow-hidden">
                    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-[15px]">
                      <div>
                        <div className="text-sm font-semibold">Pick &amp; Pack Distribution</div>
                        <div className="text-xs text-muted-foreground mt-0.5">Orders by item count</div>
                      </div>
                      <ChartSelectors chart={pickPackChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                    </div>
                    <CardContent className="flex-1 flex flex-col min-h-0">
                      <ChartContainer
                        config={{
                          orderCount: { label: "Orders", color: "hsl(var(--chart-1))" },
                        }}
                        className="w-full flex-1 min-h-0 !aspect-auto"
                      >
                        <BarChart data={(pickPackChart.data as PickPackDistribution[]) || []} margin={{ top: 10, right: 0, left: 0, bottom: 17 }}>
                          <XAxis type="category" dataKey="itemCount" tickLine={false} axisLine={false} fontSize={11} tick={(tickProps: any) => {
                            const { x, y, payload } = tickProps
                            const ppData = (pickPackChart.data as PickPackDistribution[]) || []
                            const pp = ppData.find(d => d.itemCount === payload.value)
                            if (!pp) return <g />
                            return (
                              <g transform={`translate(${x},${y + 8})`}>
                                <text textAnchor="middle" fontSize={12} fontWeight={600} fill="currentColor">{pp.percent.toFixed(1)}%</text>
                                <text textAnchor="middle" y={16} fontSize={10} fill="currentColor" opacity={0.5}>{pp.orderCount.toLocaleString()} orders</text>
                                <text textAnchor="middle" y={30} fontSize={11} fontWeight={500} fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>{pp.itemCount} {pp.itemCount === '1' ? 'item' : 'items'}</text>
                              </g>
                            )
                          }} />
                          <YAxis type="number" hide />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="dot" />}
                          />
                          <Bar dataKey="orderCount" radius={[4, 4, 0, 0]} barSize={48}>
                            {((pickPackChart.data as PickPackDistribution[]) || []).map((_, i, arr) => (
                              <Cell key={i} fill={`hsl(217, 72%, ${42 + i * (30 / Math.max(arr.length - 1, 1))}%)`} />
                            ))}
                            <LabelList dataKey="orderCount" position="top" fontSize={11} fontWeight={500} className="fill-muted-foreground" style={{ fontVariantNumeric: 'tabular-nums' }} formatter={(v: number) => v.toLocaleString()} />
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 4: Detailed Breakdown Table */}
                <Card className="bg-transparent shadow-none">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-sm font-medium"><div>Weekly Invoice Fee Breakdown</div></CardTitle>
                        <CardDescription className="text-xs">Detailed breakdown by category</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <ChartSelectors chart={feeBreakdownChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
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

                      const t = {
                        orders:      tintFn(224, 60, 55, Math.max(...feeData.map(m => m.orderCount), 1)),
                        shipping:    tintFn(215, 65, 55, Math.max(...feeData.map(m => m.shipping), 1)),
                        surcharges:  tintFn(200, 50, 45, Math.max(...feeData.map(m => m.surcharges), 1)),
                        extraPicks:  tintFn(25, 85, 55, Math.max(...feeData.map(m => m.extraPicks), 1)),
                        warehousing: tintFn(260, 55, 58, Math.max(...feeData.map(m => m.warehousing), 1)),
                        multiHubIQ:  tintFn(45, 80, 50, Math.max(...feeData.map(m => m.multiHubIQ), 1)),
                        b2b:         tintFn(340, 70, 55, Math.max(...feeData.map(m => m.b2b), 1)),
                        vasKitting:  tintFn(280, 60, 55, Math.max(...feeData.map(m => m.vasKitting), 1)),
                        receiving:   tintFn(160, 55, 42, Math.max(...feeData.map(m => m.receiving), 1)),
                        returns:     tintFn(0, 65, 52, Math.max(...feeData.map(m => m.returns), 1)),
                        dutyTax:     tintFn(195, 60, 40, Math.max(...feeData.map(m => m.dutyTax), 1)),
                        other:       tintFn(90, 45, 45, Math.max(...feeData.map(m => m.other), 1)),
                        credit:      tintFn(142, 55, 42, Math.max(...feeData.map(m => Math.abs(m.credit)), 1)),
                        total:       tintFn(220, 15, 50, Math.max(...feeData.map(m => m.total), 1)),
                        cpo:         tintFn(220, 15, 50, Math.max(...feeData.map(m => m.costPerOrder), 1)),
                      }

                      // Totals for footer
                      const totals = {
                        orders: feeData.reduce((s, m) => s + m.orderCount, 0),
                        shipping: feeData.reduce((s, m) => s + m.shipping, 0),
                        surcharges: feeData.reduce((s, m) => s + m.surcharges, 0),
                        extraPicks: feeData.reduce((s, m) => s + m.extraPicks, 0),
                        warehousing: feeData.reduce((s, m) => s + m.warehousing, 0),
                        multiHubIQ: feeData.reduce((s, m) => s + m.multiHubIQ, 0),
                        b2b: feeData.reduce((s, m) => s + m.b2b, 0),
                        vasKitting: feeData.reduce((s, m) => s + m.vasKitting, 0),
                        receiving: feeData.reduce((s, m) => s + m.receiving, 0),
                        returns: feeData.reduce((s, m) => s + m.returns, 0),
                        dutyTax: feeData.reduce((s, m) => s + m.dutyTax, 0),
                        other: feeData.reduce((s, m) => s + m.other, 0),
                        credit: feeData.reduce((s, m) => s + m.credit, 0),
                        total: feeData.reduce((s, m) => s + m.total, 0),
                      }
                      const totalCpo = totals.orders > 0 ? totals.total / totals.orders : 0

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
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.orders(month.orderCount) }}>{month.orderCount.toLocaleString()}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.shipping(month.shipping) }}>{fmtCurrency(month.shipping)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.surcharges(month.surcharges) }}>{fmtCurrency(month.surcharges)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.extraPicks(month.extraPicks) }}>{fmtCurrency(month.extraPicks)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.warehousing(month.warehousing) }}>{fmtCurrency(month.warehousing)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.multiHubIQ(month.multiHubIQ) }}>{fmtCurrency(month.multiHubIQ)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.b2b(month.b2b) }}>{fmtCurrency(month.b2b)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.vasKitting(month.vasKitting) }}>{fmtCurrency(month.vasKitting)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.receiving(month.receiving) }}>{fmtCurrency(month.receiving)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.returns(month.returns) }}>{fmtCurrency(month.returns)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.dutyTax(month.dutyTax) }}>{fmtCurrency(month.dutyTax)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums" style={{ backgroundColor: t.other(month.other) }}>{fmtCurrency(month.other)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-green-600" style={{ backgroundColor: t.credit(Math.abs(month.credit)) }}>
                                  {fmtCurrency(month.credit)}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ backgroundColor: t.total(month.total) }}>{fmtCurrency(month.total)}</td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground" style={{ backgroundColor: t.cpo(month.costPerOrder) }}>${month.costPerOrder.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bg-muted/60 font-semibold">
                              <td className="px-2 py-1.5">Total</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{totals.orders.toLocaleString()}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.shipping)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.surcharges)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.extraPicks)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.warehousing)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.multiHubIQ)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.b2b)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.vasKitting)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.receiving)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.returns)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.dutyTax)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.other)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-green-600">{fmtCurrency(totals.credit)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums">{fmtCurrency(totals.total)}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">${totalCpo.toFixed(2)}</td>
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
                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 px-5 lg:px-8 pt-8 pb-4">
                    <div>
                      <div className="text-lg font-semibold">Shipping Cost + Speed</div>
                      <div className="text-xs text-muted-foreground mt-1">Average shipping cost and transit time analysis</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <ChartSelectors chart={costSpeedKpiSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                      <MultiSelectFilter
                        options={COST_SPEED_FILTER_OPTIONS}
                        selected={analyticsFilters}
                        onSelectionChange={setAnalyticsFilters}
                        placeholder="Filters"
                        showCount={false}
                      />
                    </div>
                  </div>

                  {/* KPI strip: hero cost left + 2x2 speed grid right */}
                  <div className="border-y border-border mt-4">
                    <div className="flex items-stretch">
                      <div className="flex flex-col items-center justify-center px-8 py-6 border-r border-border bg-gradient-to-b from-white/60 to-indigo-100/50 dark:from-indigo-950/5 dark:to-indigo-950/20 w-[35%]">
                        <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Avg. Shipping Cost <KpiTooltip text={KPI_TOOLTIPS.avgShippingCost} /></div>
                        <div className="text-3xl font-bold tabular-nums">{kpiSectionAvgCost !== null ? <><AnimatedNumber value={kpiSectionAvgCost} prefix="$" decimals={2} /></> : '—'}</div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">per order</div>
                      </div>
                      <div className="grid grid-cols-2 flex-1">
                        <div className="flex flex-col items-center justify-center px-5 py-4 border-r border-b border-border bg-gradient-to-b from-white/50 to-emerald-100/40 dark:from-emerald-950/5 dark:to-emerald-950/15">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Fulfillment <KpiTooltip text={KPI_TOOLTIPS.fulfillTime} /></div>
                          <div className="text-xl font-bold tabular-nums">
                            {kpiSectionKpis.avgFulfillTime > 0 ? <AnimatedNumber value={kpiSectionKpis.avgFulfillTime} decimals={1} /> : '—'}
                          </div>
                          <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">operating hours</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-5 py-4 border-b border-border bg-gradient-to-b from-white/50 to-indigo-100/40 dark:from-indigo-950/5 dark:to-indigo-950/15">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Middle Mile <KpiTooltip text={KPI_TOOLTIPS.middleMile} /></div>
                          <div className="text-xl font-bold tabular-nums">
                            {kpiSectionMiddleMile > 0 ? <AnimatedNumber value={kpiSectionMiddleMile} decimals={1} /> : '—'}
                          </div>
                          <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-5 py-4 border-r border-border bg-gradient-to-b from-white/50 to-amber-100/40 dark:from-amber-950/5 dark:to-amber-950/15">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Last Mile <KpiTooltip text={KPI_TOOLTIPS.lastMile} /></div>
                          <div className="text-xl font-bold tabular-nums">
                            {kpiSectionKpis.avgTransitTime > 0 ? <AnimatedNumber value={kpiSectionKpis.avgTransitTime} decimals={1} /> : '—'}
                          </div>
                          <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
                        </div>
                        <div className="flex flex-col items-center justify-center px-5 py-4 bg-gradient-to-b from-white/40 to-zinc-100/50 dark:from-zinc-800/10 dark:to-zinc-800/20">
                          <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Orders</div>
                          <div className="text-xl font-bold tabular-nums">
                            {kpiSectionKpis.orderCount > 0 ? <AnimatedNumber value={kpiSectionKpis.orderCount} decimals={0} /> : '—'}
                          </div>
                          <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">in period</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Geography: Cost + Carrier Transit by State */}
                  {(() => {
                    const mapCountry = costSpeedKpiSection.country
                    const allData = mapStateCostSpeedData as StateCostSpeedData[]
                    const usConfig = COUNTRY_CONFIGS['US']
                    const caConfig = COUNTRY_CONFIGS['CA']
                    const usData = mapCountry === 'CA' ? [] : allData.filter(d => usConfig.codeToName[d.state])
                    const caData = mapCountry === 'US' ? [] : allData.filter(d => caConfig.codeToName[d.state])
                    const showUS = mapCountry === 'US' || (mapCountry === 'ALL' && usData.length > 0)
                    const showCA = mapCountry === 'CA' || (mapCountry === 'ALL' && caData.length > 0)
                    if (!showUS && !showCA) return null
                    return (
                      <div className="border-b border-border mt-6">
                        <div className="flex items-start justify-between gap-4 px-5 lg:px-8 pt-6 pb-3">
                          <div>
                            <div className="text-sm font-semibold">
                              Cost + Last Mile Transit Time by {mapCountry === 'CA' ? 'Province' : mapCountry === 'ALL' ? 'State / Province' : 'State'}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">Geographic distribution of shipping costs and carrier transit times</div>
                          </div>
                          <div className="shrink-0" />
                        </div>
                        <div className="px-5 lg:px-8 pt-5 pb-5">
                          <div className="grid gap-6 md:grid-cols-2">
                            <div>
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0 mt-3">Average Shipping Cost</div>
                              {showCA && (
                                <CostSpeedStateMap data={caData} metric="cost" title="" country="CA" />
                              )}
                              {showUS && (
                                <CostSpeedStateMap data={usData} metric="cost" title="" country="US" />
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0 mt-3">Average Last Mile Transit</div>
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
                            const date = parseLocalDate(value)
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
                              labelFormatter={(value) => parseLocalDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                            const date = parseLocalDate(value)
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
                              labelFormatter={(value) => parseLocalDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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

                    {/* Avg Cost/Order by Weight — full width column chart */}
                    {((weightCostChart.data as WeightCostData[]) || []).length > 0 && (() => {
                      const weightData = [...((weightCostChart.data as WeightCostData[]) || [])].sort((a, b) => a.sortOrder - b.sortOrder).filter(d => d.orderCount >= 3)
                      const totalOrders = weightData.reduce((s, d) => s + d.orderCount, 0)
                      void totalOrders

                      const wCosts = weightData.map(d => d.avgCostPerOrder).sort((a, b) => a - b)
                      const wQ1 = wCosts[Math.floor(wCosts.length * 0.25)] || 0
                      const wQ3 = wCosts[Math.floor(wCosts.length * 0.75)] || 0
                      const wIqr = wQ3 - wQ1
                      const getWeightBarColor = (cost: number) => {
                        if (wIqr <= 0) return 'hsl(215, 65%, 55%)'
                        if (cost > wQ3 + 1.5 * wIqr) return 'hsl(0, 65%, 55%)'
                        if (cost < wQ1 - 1.5 * wIqr) return 'hsl(145, 55%, 45%)'
                        if (cost > wQ3) return 'hsl(25, 75%, 55%)'
                        if (cost < wQ1) return 'hsl(195, 65%, 50%)'
                        return 'hsl(215, 65%, 55%)'
                      }

                      return (
                        <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                            <div>
                              <div className="text-sm font-semibold">Avg Shipping Cost / Order by Weight</div>
                              <div className="text-xs text-muted-foreground mt-0.5">Shipping cost grouped by actual package weight</div>
                            </div>
                            <ChartSelectors chart={weightCostChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} />
                          </div>
                          <div className="px-6 pb-6 pt-2">
                            <ChartContainer
                              config={{
                                avgCostPerOrder: { label: "Avg Cost/Order", color: "hsl(215, 65%, 55%)" },
                              }}
                              className="h-[360px] w-full [&_svg]:overflow-visible"
                            >
                              <BarChart data={weightData} margin={{ top: 20, right: 10, left: 10, bottom: 0 }} barCategoryGap="12%">
                                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: 'hsl(var(--foreground))' }} interval={0} angle={weightData.length > 15 ? -45 : 0} textAnchor={weightData.length > 15 ? 'end' : 'middle'} height={weightData.length > 15 ? 40 : 28} />
                                <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                                <ChartTooltip
                                  content={
                                    <ChartTooltipContent
                                      indicator="dot"
                                      formatter={(value, name, item) => (
                                        <>
                                          <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                          <div className="flex flex-col gap-0.5 leading-none">
                                            <div className="flex justify-between items-center gap-4">
                                              <span className="text-muted-foreground">Avg Cost/Order</span>
                                              <span className="font-mono font-medium tabular-nums text-foreground">${Number(value).toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between items-center gap-4">
                                              <span className="text-muted-foreground">Orders</span>
                                              <span className="font-mono font-medium tabular-nums text-foreground">{item.payload?.orderCount?.toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between items-center gap-4">
                                              <span className="text-muted-foreground">% of Volume</span>
                                              <span className="font-mono font-medium tabular-nums text-foreground">{totalOrders > 0 ? ((item.payload?.orderCount / totalOrders) * 100).toFixed(1) : '0'}%</span>
                                            </div>
                                          </div>
                                        </>
                                      )}
                                    />
                                  }
                                />
                                <Bar dataKey="avgCostPerOrder" radius={[4, 4, 0, 0]} maxBarSize={36}>
                                  {weightData.map((d, i) => (
                                    <Cell key={i} fill={getWeightBarColor(d.avgCostPerOrder)} />
                                  ))}
                                  <LabelList dataKey="avgCostPerOrder" position="top" content={(props: any) => {
                                    const { x, y, width, value } = props
                                    return <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight={600} fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>${Number(value).toFixed(2)}</text>
                                  }} />
                                </Bar>
                              </BarChart>
                            </ChartContainer>
                          </div>
                        </div>
                      )
                    })()}

                    {/* Product Shipping Cost Over Time — area chart for selected product */}
                    {(selectedTrendSku || cachedSkuOptions.length > 0) && (() => {
                      const skuOptions = cachedSkuOptions
                      const nameCount = new Map<string, number>()
                      skuOptions.forEach(d => nameCount.set(d.productName || d.sku, (nameCount.get(d.productName || d.sku) || 0) + 1))
                      const getDisplayLabel = (d: SkuCostData) => {
                        const name = d.productName || d.sku
                        return (nameCount.get(name) || 0) > 1 ? `${name} (${d.sku})` : name
                      }
                      const selectedProduct = skuOptions.find(d => d.sku === selectedTrendSku)
                      const displayName = selectedProduct ? getDisplayLabel(selectedProduct) : selectedTrendSku || ''

                      return (
                        <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                            <div>
                              <div className="text-sm font-semibold">Product Shipping Cost Over Time</div>
                              <div className="text-xs text-muted-foreground mt-0.5">Avg shipping cost for orders containing this product, grouped by quantity</div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Select value={selectedTrendSku || ''} onValueChange={(v) => setSelectedTrendSku(v)}>
                                <SelectTrigger className="h-[28px] w-auto max-w-[280px] gap-1 text-[11px] text-foreground bg-background border-border">
                                  <SelectValue placeholder="Select product">{displayName.length > 45 ? displayName.slice(0, 45) + '…' : displayName}</SelectValue>
                                </SelectTrigger>
                                <SelectContent align="end" className="font-roboto text-xs max-h-[300px]">
                                  {skuOptions.map(d => {
                                    const label = getDisplayLabel(d)
                                    return (
                                      <SelectItem key={d.sku} value={d.sku}>
                                        {label.length > 55 ? label.slice(0, 55) + '…' : label}
                                      </SelectItem>
                                    )
                                  })}
                                </SelectContent>
                              </Select>
                              {skuTrendQtys.length > 1 && (
                                <Select value={selectedTrendQty} onValueChange={setSelectedTrendQty}>
                                  <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-background border-border">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent align="end" className="font-roboto text-xs">
                                    <SelectItem value="all">All Quantities</SelectItem>
                                    {skuTrendQtys.map(({ qty, orders }) => (
                                      <SelectItem key={qty} value={String(qty)}>
                                        {qty} unit{qty > 1 ? 's' : ''} ({orders.toLocaleString()})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              <ChartSelectors
                                chart={{
                                  data: skuTrendData,
                                  preset: skuTrendPreset,
                                  country: skuTrendCountry,
                                  customRange: skuTrendCustomRange,
                                  isFetching: skuTrendLoading,
                                  setPreset: (v: string) => {
                                    setSkuTrendPreset(v as DateRangePreset)
                                    if (v !== 'custom') setSkuTrendCustomRange({ from: undefined, to: undefined })
                                  },
                                  setCountry: (v: string) => setSkuTrendCountry(v),
                                  setCustomRange: setSkuTrendCustomRange,
                                }}
                                availableCountries={analyticsData?.availableCountries || []}
                                dateRangeDisplayLabel={dateRangeDisplayLabel}
                              />
                            </div>
                          </div>
                          <div className="px-6 pb-6 pt-2">
                            {skuTrendLoading ? (
                              <div className="flex items-center justify-center h-[240px] text-xs text-muted-foreground">Loading…</div>
                            ) : skuTrendData.length < 2 ? (
                              <div className="flex items-center justify-center h-[240px] text-xs text-muted-foreground">Not enough data points for this time range</div>
                            ) : (
                              <ChartContainer
                                config={{
                                  avgCostPerOrder: { label: "Avg Cost/Order", color: "hsl(215, 65%, 55%)" },
                                }}
                                className="h-[240px] w-full"
                              >
                                <AreaChart data={skuTrendData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                  <defs>
                                    <linearGradient id="skuTrendGradient" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="hsl(215, 65%, 55%)" stopOpacity={0.3} />
                                      <stop offset="95%" stopColor="hsl(215, 65%, 55%)" stopOpacity={0.05} />
                                    </linearGradient>
                                  </defs>
                                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                                  <XAxis
                                    dataKey="week"
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                    tick={{ fill: 'hsl(var(--foreground))' }}
                                    tickFormatter={(v) => {
                                      const d = new Date(v + 'T00:00:00')
                                      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                    }}
                                    interval="preserveStartEnd"
                                  />
                                  <YAxis
                                    tickLine={false}
                                    axisLine={false}
                                    fontSize={11}
                                    tickFormatter={(v) => `$${v.toFixed(2)}`}
                                    domain={[(dataMin: number) => Math.max(0, Math.floor(dataMin) - 1), (dataMax: number) => Math.ceil(dataMax) + 1]}
                                  />
                                  <ChartTooltip
                                    content={
                                      <ChartTooltipContent
                                        indicator="dot"
                                        labelFormatter={(label) => {
                                          const d = new Date(label + 'T00:00:00')
                                          return `Week of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                        }}
                                        formatter={(value, name, item) => (
                                          <>
                                            <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: 'hsl(215, 65%, 55%)' }} />
                                            <div className="flex flex-col gap-0.5 leading-none">
                                              <div className="flex justify-between items-center gap-4">
                                                <span className="text-muted-foreground">Avg Cost/Order</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">${Number(value).toFixed(2)}</span>
                                              </div>
                                              <div className="flex justify-between items-center gap-4">
                                                <span className="text-muted-foreground">Orders</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">{item.payload?.orderCount?.toLocaleString()}</span>
                                              </div>
                                            </div>
                                          </>
                                        )}
                                      />
                                    }
                                  />
                                  <Area
                                    type="monotone"
                                    dataKey="avgCostPerOrder"
                                    stroke="hsl(215, 65%, 55%)"
                                    strokeWidth={2}
                                    fill="url(#skuTrendGradient)"
                                    dot={{ r: 3, fill: 'hsl(215, 65%, 55%)', strokeWidth: 0 }}
                                    activeDot={{ r: 5, strokeWidth: 2, stroke: 'hsl(var(--background))' }}
                                  />
                                </AreaChart>
                              </ChartContainer>
                            )}
                          </div>
                        </div>
                      )
                    })()}

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
                            <Select value={dateRangeSelectValue} onValueChange={handleDatePresetChange}>
                              <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                                <SelectValue>
                                  {dateRange === 'custom' && customDateRange.from && customDateRange.to
                                    ? dateRangeDisplayLabel
                                    : DATE_RANGE_PRESETS.find(p => p.value === dateRange)?.label || '90D'}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent align="end" className="font-roboto text-xs">
                                {DATE_RANGE_PRESETS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {customPickerOpen && dateRange === 'custom' && (
                              <InlineDateRangePicker
                                dateRange={customDateRange.from && customDateRange.to ? { from: customDateRange.from, to: customDateRange.to } : undefined}
                                onDateRangeChange={(range) => {
                                  if (range?.from && range?.to) {
                                    setCustomDateRange({ from: range.from, to: range.to })
                                    setCustomPickerOpen(false)
                                  }
                                }}
                                autoOpen
                              />
                            )}
                            {(analyticsData?.availableCountries || []).length > 1 && (
                              <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v); setSelectedState(null) }}>
                                <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent align="end">
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
                      <Select value={chartSelectVal(dailyVolumeChart)} onValueChange={dailyVolumeChart.setPreset}>
                        <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                          <SelectValue>{chartPresetLabel(dailyVolumeChart, dateRangeDisplayLabel)}</SelectValue>
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
                            <SelectItem value="ALL">All Regions</SelectItem>
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
                          interval={getXAxisInterval((dailyVolumeChart.data as DailyOrderVolume[]).length)}
                          tickFormatter={(value) => {
                            const date = parseLocalDate(value)
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
                              labelFormatter={(value) => parseLocalDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                        <Select value={chartSelectVal(hourChart)} onValueChange={hourChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{chartPresetLabel(hourChart, dateRangeDisplayLabel)}</SelectValue>
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
                              <SelectItem value="ALL">All Regions</SelectItem>
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
                        <Select value={chartSelectVal(dowChart)} onValueChange={dowChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{chartPresetLabel(dowChart, dateRangeDisplayLabel)}</SelectValue>
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
                              <SelectItem value="ALL">All Regions</SelectItem>
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
                        <Select value={chartSelectVal(fcChart)} onValueChange={fcChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{chartPresetLabel(fcChart, dateRangeDisplayLabel)}</SelectValue>
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
                              <SelectItem value="ALL">All Regions</SelectItem>
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
                        <Select value={chartSelectVal(storeChart)} onValueChange={storeChart.setPreset}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-muted/50 border-border/50">
                            <SelectValue>{chartPresetLabel(storeChart, dateRangeDisplayLabel)}</SelectValue>
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
                              <SelectItem value="ALL">All Regions</SelectItem>
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
                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 px-5 lg:px-8 pt-8 pb-4">
                    <div>
                      <div className="text-lg font-semibold">Carriers + Zones</div>
                      <div className="text-xs text-muted-foreground mt-1">Carrier performance and zone-level cost analysis</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <ChartSelectors chart={carrierZoneChart} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideAllCountry />
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <Checkbox
                          checked={includeIntlZones}
                          onCheckedChange={(checked) => setIncludeIntlZones(checked === true)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">Include International</span>
                      </label>
                    </div>
                  </div>

                  {/* KPI strip: hero avg zone + 2x2 grid */}
                  <div className="border-y border-border mt-4">
                    <div className="flex items-stretch">
                      {(() => {
                        const zoneData = carrierZoneCostData
                        const totalOrders = zoneData.reduce((sum, z) => sum + z.orderCount, 0)
                        const avgTransit = totalOrders > 0
                          ? zoneData.reduce((sum, z) => sum + (z.avgTransitTime * z.orderCount), 0) / totalOrders
                          : 0
                        const avgCost = totalOrders > 0
                          ? zoneData.reduce((sum, z) => sum + (z.avgCost * z.orderCount), 0) / totalOrders
                          : 0
                        const numericZones = zoneData.filter(z => !isNaN(Number(z.zone)))
                        const numericTotal = numericZones.reduce((sum, z) => sum + z.orderCount, 0)
                        const avgZone = numericTotal > 0
                          ? numericZones.reduce((sum, z) => sum + Number(z.zone) * z.orderCount, 0) / numericTotal
                          : 0
                        return (
                          <>
                            <div className="flex flex-col items-center justify-center px-8 py-6 border-r border-border bg-gradient-to-b from-white/60 to-indigo-100/50 dark:from-indigo-950/5 dark:to-indigo-950/20 w-[35%]">
                              <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Average Zone</div>
                              <div className="text-3xl font-bold tabular-nums">{avgZone > 0 ? <AnimatedNumber value={avgZone} decimals={1} /> : '—'}</div>
                              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">weighted by volume</div>
                            </div>
                            <div className="grid grid-cols-2 flex-1">
                              <div className="flex flex-col items-center justify-center px-5 py-4 border-r border-b border-border bg-gradient-to-b from-white/50 to-emerald-100/40 dark:from-emerald-950/5 dark:to-emerald-950/15">
                                <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Shipments</div>
                                <div className="text-xl font-bold tabular-nums"><AnimatedNumber value={totalOrders} locale /></div>
                                <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">in period</div>
                              </div>
                              <div className="flex flex-col items-center justify-center px-5 py-4 border-b border-border bg-gradient-to-b from-white/50 to-indigo-100/40 dark:from-indigo-950/5 dark:to-indigo-950/15">
                                <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Avg. Cost</div>
                                <div className="text-xl font-bold tabular-nums"><AnimatedNumber value={avgCost} prefix="$" decimals={2} /></div>
                                <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">per shipment</div>
                              </div>
                              <div className="flex flex-col items-center justify-center px-5 py-4 border-r border-border bg-gradient-to-b from-white/50 to-amber-100/40 dark:from-amber-950/5 dark:to-amber-950/15">
                                <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Avg. Last Mile</div>
                                <div className="text-xl font-bold tabular-nums"><AnimatedNumber value={avgTransit} decimals={1} /></div>
                                <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
                              </div>
                              <div className="flex flex-col items-center justify-center px-5 py-4 bg-gradient-to-b from-white/40 to-zinc-100/50 dark:from-zinc-800/10 dark:to-zinc-800/20">
                                <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Zones</div>
                                <div className="text-xl font-bold tabular-nums"><AnimatedNumber value={zoneData.length} decimals={0} /></div>
                                <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">active</div>
                              </div>
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </div>

                  <div className="px-5 lg:px-8 py-5 space-y-5">
                {/* Zone Performance Landscape - Feature Chart */}
                <div>
                  <div className="flex items-start justify-between gap-4 px-1 pt-4 pb-2">
                    <div>
                      <div className="text-sm font-semibold">Zone Performance Landscape</div>
                      <div className="text-xs text-muted-foreground mt-0.5">How shipping cost and transit time scale with distance</div>
                    </div>
                  </div>
                  <div className="pb-6 pt-2">
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-stretch">
                      {/* Main Chart */}
                      <div className="lg:col-span-3">
                        <ChartContainer
                          config={{
                            avgCost: { label: "Avg Cost", color: "hsl(var(--chart-1))" },
                            avgTransitTime: { label: "Avg Transit", color: "hsl(var(--chart-2))" },
                            orderCount: { label: "Orders", color: "hsl(var(--chart-3))" },
                          }}
                          style={{ height: `clamp(250px, calc(100vh - 520px), 520px)` }}
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
                      <div className="space-y-3 overflow-y-auto pr-2">
                        <div className="text-sm font-medium text-muted-foreground">Zone Distribution</div>
                        {carrierZoneCostData.map((zone) => {
                          const totalOrders = carrierZoneCostData.reduce((sum, z) => sum + z.orderCount, 0)
                          const percent = totalOrders > 0 ? (zone.orderCount / totalOrders * 100) : 0
                          return (
                            <div key={zone.zone} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium">{zone.zone === 'Intl' ? 'International' : `Zone ${zone.zone}`}</span>
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


                {/* Your Carrier Network Section */}
                <div className="rounded-xl border border-border/60 overflow-hidden bg-background">
                  <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
                    <div>
                      <div className="text-sm font-semibold">Your Carrier Network</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Distributed across {chartCarrierPerformance.filter(cp => cp.orderCount >= 50).length} carriers for optimal coverage</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <ChartSelectors chart={carrierSection} availableCountries={analyticsData?.availableCountries || []} dateRangeDisplayLabel={dateRangeDisplayLabel} hideAllCountry />
                      {availableShipOptions.length > 0 && (
                        <Select value={carrierShipOption} onValueChange={setCarrierShipOption}>
                          <SelectTrigger className="h-[28px] w-auto gap-1 text-[11px] text-foreground bg-background border-border">
                            <SelectValue>{carrierShipOption}</SelectValue>
                          </SelectTrigger>
                          <SelectContent align="end" className="font-roboto text-xs">
                            {availableShipOptions.map(so => (
                              <SelectItem key={so.name} value={so.name}>
                                {so.name} ({so.count.toLocaleString()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
                  <div className="px-6 pb-6 pt-2">
                    {(() => {
                      const totalOrders = chartCarrierPerformance.reduce((sum, c) => sum + c.orderCount, 0)
                      // Build carrier → zone → volume percentage matrix
                      const carrierZoneVolume = new Map<string, Map<string, number>>()
                      for (const row of chartCarrierZoneBreakdown) {
                        if (!carrierZoneVolume.has(row.carrier)) carrierZoneVolume.set(row.carrier, new Map())
                        const zoneMap = carrierZoneVolume.get(row.carrier)!
                        zoneMap.set(row.zone, (zoneMap.get(row.zone) || 0) + row.orderCount)
                      }
                      // Convert to percentages
                      for (const [, zoneMap] of carrierZoneVolume) {
                        const total = Array.from(zoneMap.values()).reduce((s, v) => s + v, 0)
                        for (const [zone, count] of zoneMap) {
                          zoneMap.set(zone, total > 0 ? (count / total) * 100 : 0)
                        }
                      }
                      // Get all zones sorted, only from carriers that pass the 50-order filter
                      const filteredCarriers = new Set(chartCarrierPerformance.filter(cp => cp.orderCount >= 50).map(cp => cp.carrier))
                      const allZones = Array.from(new Set(
                        Array.from(carrierZoneVolume.entries())
                          .filter(([carrier]) => filteredCarriers.has(carrier))
                          .flatMap(([, zoneMap]) => Array.from(zoneMap.keys()))
                      )).sort((a, b) => (parseInt(a) || 99) - (parseInt(b) || 99))

                      // Find max percentage for color scaling
                      let maxPct = 0
                      for (const [carrier, zoneMap] of carrierZoneVolume) {
                        if (!filteredCarriers.has(carrier)) continue
                        for (const pct of zoneMap.values()) maxPct = Math.max(maxPct, pct)
                      }
                      maxPct = Math.max(maxPct, 1)

                      // Cell background: transparent (0%) → emerald (high %)
                      const cellBg = (pct: number): string => {
                        if (pct <= 0) return 'transparent'
                        const t = Math.min(1, pct / maxPct)
                        const opacity = 0.08 + t * 0.42 // 0.08 → 0.50
                        return `hsla(152, 55%, 48%, ${opacity.toFixed(2)})`
                      }

                      // Metric column tints (computed from filtered carriers)
                      const filtered = chartCarrierPerformance.filter(cp => cp.orderCount >= 50)
                      const maxOrders = Math.max(...filtered.map(c => c.orderCount), 1)
                      const maxCost = Math.max(...filtered.map(c => c.avgCost), 1)
                      const minCost = Math.min(...filtered.map(c => c.avgCost))
                      const maxTransit = Math.max(...filtered.map(c => c.avgTransitTime), 1)
                      const minTransit = Math.min(...filtered.map(c => c.avgTransitTime))
                      const costRange = maxCost - minCost || 1
                      const transitRange = maxTransit - minTransit || 1
                      // Indigo tint for volume (higher = more prominent)
                      const ordersBg = (v: number) => `hsla(224, 60%, 55%, ${(0.04 + (v / maxOrders) * 0.14).toFixed(2)})`
                      // Amber tint for cost (higher = warmer)
                      const costBg = (v: number) => `hsla(35, 70%, 50%, ${(0.04 + ((v - minCost) / costRange) * 0.14).toFixed(2)})`
                      // Sky tint for transit (lower = cooler/better, but no judgment — just visual interest)
                      const transitBg = (v: number) => `hsla(200, 60%, 50%, ${(0.04 + ((v - minTransit) / transitRange) * 0.14).toFixed(2)})`

                      return (
                        <div className="rounded-md border overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted">
                              <tr className="border-b text-xs">
                                <th className="py-2.5 px-3 text-left font-semibold w-[140px] sticky left-0 bg-muted z-10">Carrier</th>
                                <th className="py-2.5 px-2 text-right font-semibold w-[70px]">Orders</th>
                                <th className="py-2.5 px-2 text-right font-semibold w-[50px]">Vol %</th>
                                <th className="py-2.5 px-2 text-right font-semibold w-[70px]">Avg Cost</th>
                                <th className="py-2.5 px-2 text-right font-semibold whitespace-nowrap w-[65px]">Transit</th>
                                {allZones.map(zone => (
                                  <th key={zone} className="py-2.5 px-1 text-center font-semibold w-[52px] text-[10px] text-muted-foreground">
                                    Z{zone}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {chartCarrierPerformance.filter(cp => cp.orderCount >= 50).map((cp, idx) => {
                                const volumePercent = totalOrders > 0 ? (cp.orderCount / totalOrders * 100) : 0
                                const zoneMap = carrierZoneVolume.get(cp.carrier)
                                return (
                                  <tr key={cp.carrier} className={cn("border-b text-xs", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                    <td className={cn("py-2.5 px-3 font-medium sticky left-0 z-10", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>{cp.carrier}</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums" style={{ backgroundColor: ordersBg(cp.orderCount) }}>{cp.orderCount.toLocaleString()}</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums text-muted-foreground" style={{ backgroundColor: `hsla(220, 10%, 50%, ${(0.04 + (volumePercent / 100) * 0.14).toFixed(2)})` }}>{volumePercent.toFixed(1)}%</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums" style={{ backgroundColor: costBg(cp.avgCost) }}>${cp.avgCost.toFixed(2)}</td>
                                    <td className="py-2.5 px-2 text-right tabular-nums" style={{ backgroundColor: transitBg(cp.avgTransitTime) }}>{cp.avgTransitTime.toFixed(1)}d</td>
                                    {allZones.map(zone => {
                                      const pct = zoneMap?.get(zone) || 0
                                      return (
                                        <td
                                          key={zone}
                                          className="py-2.5 px-1 text-center tabular-nums text-[10px]"
                                          style={{ backgroundColor: cellBg(pct) }}
                                        >
                                          {pct > 0 ? (
                                            <span className={pct >= 10 ? 'font-medium text-emerald-900 dark:text-emerald-100' : 'text-muted-foreground'}>
                                              {pct < 1 ? '<1' : Math.round(pct)}%
                                            </span>
                                          ) : (
                                            <span className="text-zinc-300 dark:text-zinc-700">—</span>
                                          )}
                                        </td>
                                      )
                                    })}
                                  </tr>
                                )
                              })}
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
                    {(() => {
                      const totalOrders = zoneDeepDiveData.reduce((sum, z) => sum + z.orderCount, 0)
                      const maxZoneOrders = Math.max(...zoneDeepDiveData.map(z => z.orderCount), 1)
                      const costs = zoneDeepDiveData.map(z => z.avgCost)
                      const transits = zoneDeepDiveData.filter(z => z.avgTransitTime > 0).map(z => z.avgTransitTime)
                      const minZoneCost = Math.min(...costs)
                      const maxZoneCost = Math.max(...costs)
                      const zoneCostRange = maxZoneCost - minZoneCost || 1
                      const minZoneTransit = transits.length > 0 ? Math.min(...transits) : 0
                      const maxZoneTransit = transits.length > 0 ? Math.max(...transits) : 1
                      const zoneTransitRange = maxZoneTransit - minZoneTransit || 1

                      // Color functions matching the carrier table above
                      const zoneOrdersBg = (v: number) => `hsla(224, 60%, 55%, ${(0.04 + (v / maxZoneOrders) * 0.16).toFixed(2)})`
                      const zoneVolBg = (pct: number) => `hsla(152, 55%, 48%, ${(0.04 + (pct / 100) * 0.20).toFixed(2)})`
                      const zoneCostBg = (v: number) => `hsla(35, 70%, 50%, ${(0.04 + ((v - minZoneCost) / zoneCostRange) * 0.16).toFixed(2)})`
                      const zoneTransitBg = (v: number) => v > 0 ? `hsla(200, 60%, 50%, ${(0.04 + ((v - minZoneTransit) / zoneTransitRange) * 0.16).toFixed(2)})` : 'transparent'

                      return (
                        <div className="rounded-md border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted">
                              <tr className="border-b text-xs">
                                <th className="py-2.5 px-3 text-left font-semibold w-[140px]">Zone</th>
                                <th className="py-2.5 px-3 text-right font-semibold w-[90px]">Orders</th>
                                <th className="py-2.5 px-3 text-right font-semibold w-[80px]">% of Total</th>
                                <th className="py-2.5 px-3 text-right font-semibold w-[90px]">Avg Cost</th>
                                <th className="py-2.5 px-3 text-right font-semibold w-[90px]">Avg Transit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {zoneDeepDiveData.map((zone, idx) => {
                                const percent = totalOrders > 0 ? (zone.orderCount / totalOrders * 100) : 0
                                return (
                                  <tr key={zone.zone} className={cn("border-b text-xs", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                    <td className={cn("py-2.5 px-3 font-medium", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                      {zone.zone === 'Intl' ? 'International' : `Zone ${zone.zone}`}
                                    </td>
                                    <td className="py-2.5 px-3 text-right tabular-nums" style={{ backgroundColor: zoneOrdersBg(zone.orderCount) }}>
                                      {zone.orderCount.toLocaleString()}
                                    </td>
                                    <td className="py-2.5 px-3 text-right tabular-nums" style={{ backgroundColor: zoneVolBg(percent) }}>
                                      {percent.toFixed(1)}%
                                    </td>
                                    <td className="py-2.5 px-3 text-right tabular-nums" style={{ backgroundColor: zoneCostBg(zone.avgCost) }}>
                                      ${zone.avgCost.toFixed(2)}
                                    </td>
                                    <td className="py-2.5 px-3 text-right tabular-nums" style={{ backgroundColor: zoneTransitBg(zone.avgTransitTime) }}>
                                      {zone.avgTransitTime > 0 ? `${zone.avgTransitTime.toFixed(1)}d` : '—'}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
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
                            const date = parseLocalDate(value)
                            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          }}
                        />
                        <YAxis
                          type="number"
                          domain={[0, 100]}
                          allowDataOverflow
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}%`}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              indicator="dot"
                              labelFormatter={(value) => parseLocalDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
                        <div className="text-xs text-muted-foreground mt-0.5">Operating hours from order import to carrier sortation (7-day avg)</div>
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
                            interval={getXAxisInterval((fulfillTrendChart.data as FulfillmentTrendData[]).length)}
                            tickFormatter={(value) => {
                              const date = parseLocalDate(value)
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
                                labelFormatter={(value) => parseLocalDate(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                formatter={(value, name, item) => (
                                  <>
                                    <div className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                                    <div className="flex flex-1 justify-between items-center leading-none">
                                      <span className="text-muted-foreground">Avg Fulfill Time</span>
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
                            value={dateRangeSelectValue}
                            onValueChange={handleDatePresetChange}
                          >
                            <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                              <SelectValue>
                                {dateRange === 'custom' && customDateRange.from && customDateRange.to
                                  ? dateRangeDisplayLabel
                                  : DATE_RANGE_PRESETS.find(p => p.value === dateRange)?.label || '90D'}
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
                          {customPickerOpen && dateRange === 'custom' && (
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
                                      setCustomPickerOpen(false)
                                      return
                                    }
                                  }
                                  setCustomDateRange({ from: range.from, to: range.to })
                                  setCustomPickerOpen(false)
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
                      {perfCountry !== 'US' && (analyticsData?.countryDataDays?.[perfCountry] ?? 999) < 10 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <div className="text-sm font-medium text-muted-foreground mb-2">Not Enough Data Yet</div>
                          <div className="text-xs text-muted-foreground max-w-sm">
                            {perfCountry === 'CA' ? 'Canada' : perfCountry === 'AU' ? 'Australia' : perfCountry} has only {analyticsData?.countryDataDays?.[perfCountry] ?? 999} {(analyticsData?.countryDataDays?.[perfCountry] ?? 999) === 1 ? 'day' : 'days'} of shipping data in this period.
                            At least 10 days of data is needed for meaningful performance metrics.
                          </div>
                        </div>
                      ) : (
                        <PerformanceMap
                          key={perfCountry}
                          config={COUNTRY_CONFIGS[perfCountry]}
                          regionData={statePerformance}
                          onRegionSelect={setSelectedState}
                        />
                      )}
                    </div>

                    {/* Details panel - 1 column, border-left divider */}
                    <div className="lg:col-span-1 border-t lg:border-t-0 lg:border-l border-border bg-gradient-to-b from-zinc-100 via-zinc-50 to-zinc-100 dark:from-zinc-800 dark:via-zinc-900 dark:to-zinc-900">
                      {(perfCountry !== 'US' && (analyticsData?.countryDataDays?.[perfCountry] ?? 999) < 14) ? (
                        <div className="h-full flex items-center justify-center">
                          <div className="text-xs text-muted-foreground py-16">Check back once more data has accumulated</div>
                        </div>
                      ) : (
                        <PerformanceDetailsPanel
                          {...perfPanelProps}
                          delayImpact={delayImpact}
                          includeDelayed={includeDelayedOrders}
                          onToggleDelayed={setIncludeDelayedOrders}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>

              </div>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
    </PermissionGuard>
  )
}
